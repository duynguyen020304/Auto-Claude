/**
 * Profile Service - Validation and profile creation
 *
 * Provides validation functions for URL, API key, and profile name uniqueness.
 * Handles creating new profiles with validation.
 * Tracks API profile usage for rotation strategies.
 */

import { loadProfilesFile, saveProfilesFile, generateProfileId } from '../utils/profile-manager';
import { updateProfileUsage, getProfileUsage, getRotationStrategyOrDefault } from '../utils/api-usage-storage';
import { getBestAvailableAPIProfile } from '../claude-profile/profile-scorer';
import { debugWarn } from '../../shared/utils/debug-logger';
import type { APIProfile, TestConnectionResult, APIProfileUsage, APIProfileRotationStrategy } from '../../shared/types/profile';

/**
 * Validate base URL format
 * Accepts HTTP(S) URLs with valid endpoints
 */
export function validateBaseUrl(baseUrl: string): boolean {
  if (!baseUrl || baseUrl.trim() === '') {
    return false;
  }

  try {
    const url = new URL(baseUrl);
    // Only allow http and https protocols
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate API key format
 * Accepts various API key formats (Anthropic, OpenAI, custom)
 */
export function validateApiKey(apiKey: string): boolean {
  if (!apiKey || apiKey.trim() === '') {
    return false;
  }

  const trimmed = apiKey.trim();

  // Too short to be a real API key
  if (trimmed.length < 12) {
    return false;
  }

  // Accept common API key formats
  // Anthropic: sk-ant-...
  // OpenAI: sk-proj-... or sk-...
  // Custom: any reasonable length key with alphanumeric chars
  const hasValidChars = /^[a-zA-Z0-9\-_+.]+$/.test(trimmed);

  return hasValidChars;
}

/**
 * Validate that profile name is unique (case-insensitive, trimmed)
 */
export async function validateProfileNameUnique(name: string): Promise<boolean> {
  const trimmed = name.trim().toLowerCase();

  const file = await loadProfilesFile();

  // Check if any profile has the same name (case-insensitive)
  const exists = file.profiles.some(
    (p) => p.name.trim().toLowerCase() === trimmed
  );

  return !exists;
}

/**
 * Input type for creating a profile (without id, createdAt, updatedAt)
 */
export type CreateProfileInput = Omit<APIProfile, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Input type for updating a profile (with id, without createdAt, updatedAt)
 */
export type UpdateProfileInput = Pick<APIProfile, 'id'> & CreateProfileInput;

/**
 * Delete a profile with validation
 * Throws errors for validation failures
 */
export async function deleteProfile(id: string): Promise<void> {
  const file = await loadProfilesFile();

  // Find the profile
  const profileIndex = file.profiles.findIndex((p) => p.id === id);
  if (profileIndex === -1) {
    throw new Error('Profile not found');
  }

  // Active Profile Check: Cannot delete active profile (AC3)
  if (file.activeProfileId === id) {
    throw new Error('Cannot delete active profile. Please switch to another profile or OAuth first.');
  }

  // Remove profile
  file.profiles.splice(profileIndex, 1);

  // Last Profile Fallback: If no profiles remain, set activeProfileId to null (AC4)
  if (file.profiles.length === 0) {
    file.activeProfileId = null;
  }

  // Save to disk
  await saveProfilesFile(file);
}

/**
 * Create a new profile with validation
 * Throws errors for validation failures
 */
export async function createProfile(input: CreateProfileInput): Promise<APIProfile> {
  // Validate base URL
  if (!validateBaseUrl(input.baseUrl)) {
    throw new Error('Invalid base URL');
  }

  // Validate API key
  if (!validateApiKey(input.apiKey)) {
    throw new Error('Invalid API key');
  }

  // Validate profile name uniqueness
  const isUnique = await validateProfileNameUnique(input.name);
  if (!isUnique) {
    throw new Error('A profile with this name already exists');
  }

  // Load existing profiles
  const file = await loadProfilesFile();

  // Create new profile
  const now = Date.now();
  const newProfile: APIProfile = {
    id: generateProfileId(),
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim(),
    apiKey: input.apiKey.trim(),
    models: input.models,
    createdAt: now,
    updatedAt: now
  };

  // Add to profiles list
  file.profiles.push(newProfile);

  // Set as active if it's the first profile
  if (file.profiles.length === 1) {
    file.activeProfileId = newProfile.id;
  }

  // Save to disk
  await saveProfilesFile(file);

  return newProfile;
}

/**
 * Update an existing profile with validation
 * Throws errors for validation failures
 */
export async function updateProfile(input: UpdateProfileInput): Promise<APIProfile> {
  // Validate base URL
  if (!validateBaseUrl(input.baseUrl)) {
    throw new Error('Invalid base URL');
  }

  // Validate API key
  if (!validateApiKey(input.apiKey)) {
    throw new Error('Invalid API key');
  }

  // Load existing profiles
  const file = await loadProfilesFile();

  // Find the profile
  const profileIndex = file.profiles.findIndex((p) => p.id === input.id);
  if (profileIndex === -1) {
    throw new Error('Profile not found');
  }

  const existingProfile = file.profiles[profileIndex];

  // Validate profile name uniqueness (exclude current profile from check)
  if (input.name.trim().toLowerCase() !== existingProfile.name.trim().toLowerCase()) {
    const trimmed = input.name.trim().toLowerCase();
    const nameExists = file.profiles.some(
      (p) => p.id !== input.id && p.name.trim().toLowerCase() === trimmed
    );
    if (nameExists) {
      throw new Error('A profile with this name already exists');
    }
  }

  // Update profile (including name)
  const updatedProfile: APIProfile = {
    ...existingProfile,
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim(),
    apiKey: input.apiKey.trim(),
    models: input.models,
    updatedAt: Date.now()
  };

  // Replace in profiles list
  file.profiles[profileIndex] = updatedProfile;

  // Save to disk
  await saveProfilesFile(file);

  return updatedProfile;
}

/**
 * Get environment variables for the active API profile
 *
 * Maps the active API profile to SDK environment variables for injection
 * into Python subprocess. Returns empty object when no profile is active
 * (OAuth mode), allowing CLAUDE_CODE_OAUTH_TOKEN to be used instead.
 *
 * Environment Variable Mapping:
 * - profile.baseUrl → ANTHROPIC_BASE_URL
 * - profile.apiKey → ANTHROPIC_AUTH_TOKEN
 * - profile.models.default → ANTHROPIC_MODEL
 * - profile.models.haiku → ANTHROPIC_DEFAULT_HAIKU_MODEL
 * - profile.models.sonnet → ANTHROPIC_DEFAULT_SONNET_MODEL
 * - profile.models.opus → ANTHROPIC_DEFAULT_OPUS_MODEL
 *
 * Empty string values are filtered out (not set as env vars).
 *
 * @returns Promise<Record<string, string>> Environment variables for active profile
 */
export async function getAPIProfileEnv(): Promise<Record<string, string>> {
  // Load profiles.json
  const file = await loadProfilesFile();

  // If no active profile (null/empty), return empty object (OAuth mode)
  if (!file.activeProfileId || file.activeProfileId === '') {
    return {};
  }

  // Find active profile by activeProfileId
  const profile = file.profiles.find((p) => p.id === file.activeProfileId);

  // If profile not found, return empty object (shouldn't happen with valid data)
  if (!profile) {
    return {};
  }

  // Map profile fields to SDK env vars
  const envVars: Record<string, string> = {
    ANTHROPIC_BASE_URL: profile.baseUrl || '',
    ANTHROPIC_AUTH_TOKEN: profile.apiKey || '',
    ANTHROPIC_MODEL: profile.models?.default || '',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.models?.haiku || '',
    ANTHROPIC_DEFAULT_SONNET_MODEL: profile.models?.sonnet || '',
    ANTHROPIC_DEFAULT_OPUS_MODEL: profile.models?.opus || '',
  };

  // Filter out empty/whitespace string values (only set env vars that have values)
  // This handles empty strings, null, undefined, and whitespace-only values
  const filteredEnvVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    const trimmedValue = value?.trim();
    if (trimmedValue && trimmedValue !== '') {
      filteredEnvVars[key] = trimmedValue;
    }
  }

  return filteredEnvVars;
}

/**
 * Get environment variables for a specific API profile by ID
 *
 * Maps a specific API profile (by ID) to SDK environment variables for injection
 * into Python subprocess. If the profile is not found or invalid, falls back
 * to the active profile with a console warning.
 *
 * Environment Variable Mapping:
 * - profile.baseUrl → ANTHROPIC_BASE_URL
 * - profile.apiKey → ANTHROPIC_AUTH_TOKEN
 * - profile.models.default → ANTHROPIC_MODEL
 * - profile.models.haiku → ANTHROPIC_DEFAULT_HAIKU_MODEL
 * - profile.models.sonnet → ANTHROPIC_DEFAULT_SONNET_MODEL
 * - profile.models.opus → ANTHROPIC_DEFAULT_OPUS_MODEL
 *
 * Empty string values are filtered out (not set as env vars).
 *
 * @param profileId - Optional profile ID to use (undefined/null = use active profile)
 * @returns Promise<Record<string, string>> Environment variables for the specified or active profile
 */
export async function getAPIProfileEnvById(profileId: string | null | undefined): Promise<Record<string, string>> {
  // If no profile specified, use active profile (backward compatible)
  if (!profileId) {
    return getAPIProfileEnv();
  }

  // Load profiles.json
  const file = await loadProfilesFile();

  // Find the specified profile
  const profile = file.profiles.find((p) => p.id === profileId);

  // If profile not found, log warning and fall back to active profile
  if (!profile) {
    debugWarn(
      `[profile-service] Profile '${profileId}' not found. ` +
      `Falling back to active profile.`
    );
    return getAPIProfileEnv();
  }

  // Validate profile has required fields
  if (!profile.baseUrl || !profile.apiKey) {
    debugWarn(
      `[profile-service] Profile '${profile.name}' (${profile.id}) is missing required fields. ` +
      `Falling back to active profile.`
    );
    return getAPIProfileEnv();
  }

  // Map profile fields to SDK env vars
  const envVars: Record<string, string> = {
    ANTHROPIC_BASE_URL: profile.baseUrl || '',
    ANTHROPIC_AUTH_TOKEN: profile.apiKey || '',
    ANTHROPIC_MODEL: profile.models?.default || '',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.models?.haiku || '',
    ANTHROPIC_DEFAULT_SONNET_MODEL: profile.models?.sonnet || '',
    ANTHROPIC_DEFAULT_OPUS_MODEL: profile.models?.opus || '',
  };

  // Filter out empty/whitespace string values
  const filteredEnvVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    const trimmedValue = value?.trim();
    if (trimmedValue && trimmedValue !== '') {
      filteredEnvVars[key] = trimmedValue;
    }
  }

  return filteredEnvVars;
}

/**
 * Get environment variables for API profile with rotation strategy
 *
 * Extends getAPIProfileEnv() to support automatic profile rotation based on
 * usage quotas, rate limits, and priority order. Uses rotation strategy
 * configuration to select the best available API profile.
 *
 * Selection Logic:
 * 1. Load rotation strategy configuration from storage
 * 2. If rotation is enabled:
 *    - Use getBestAvailableAPIProfile() to select best profile based on:
 *      - Priority order (user-configured)
 *      - Rate limit status (excludes rate-limited profiles)
 *      - Usage thresholds (excludes profiles at/near quota)
 *    - Falls back to active profile if no profiles pass availability checks
 * 3. If rotation is disabled:
 *    - Use active profile (same as getAPIProfileEnv())
 * 4. Map selected profile to SDK environment variables
 *
 * Environment Variable Mapping:
 * - profile.baseUrl → ANTHROPIC_BASE_URL
 * - profile.apiKey → ANTHROPIC_AUTH_TOKEN
 * - profile.models.default → ANTHROPIC_MODEL
 * - profile.models.haiku → ANTHROPIC_DEFAULT_HAIKU_MODEL
 * - profile.models.sonnet → ANTHROPIC_DEFAULT_SONNET_MODEL
 * - profile.models.opus → ANTHROPIC_DEFAULT_OPUS_MODEL
 *
 * Empty string values are filtered out (not set as env vars).
 *
 * @returns Promise<Record<string, string>> Environment variables for selected profile
 */
export async function getRotatedAPIProfileEnv(): Promise<Record<string, string>> {
  // Load profiles.json
  const file = await loadProfilesFile();

  // If no API profiles configured, return empty object (OAuth mode)
  if (file.profiles.length === 0) {
    return {};
  }

  // Load rotation strategy configuration
  const rotationStrategy: APIProfileRotationStrategy = getRotationStrategyOrDefault();

  let selectedProfile: APIProfile | null = null;

  // Check if rotation is enabled
  if (rotationStrategy.enabled) {
    // Use rotation logic to select best available profile
    const selectionResult = getBestAvailableAPIProfile(
      file.profiles,
      rotationStrategy,
      undefined // No excludeProfileId - consider all profiles
    );
    selectedProfile = selectionResult.profile;

    // If rotation didn't select a profile (all unavailable), fall back to active profile
    if (!selectedProfile && file.activeProfileId) {
      const activeProfile = file.profiles.find((p) => p.id === file.activeProfileId);
      if (activeProfile) {
        console.warn('[ProfileService] Rotation: All profiles unavailable, falling back to active profile:', activeProfile.name);
        selectedProfile = activeProfile;
      }
    }
  } else {
    // Rotation disabled - use active profile (same as getAPIProfileEnv())
    if (!file.activeProfileId || file.activeProfileId === '') {
      return {};
    }

    selectedProfile = file.profiles.find((p) => p.id === file.activeProfileId) || null;
  }

  // If no profile selected (no active profile or rotation failed), return empty object
  if (!selectedProfile) {
    return {};
  }

  // Map profile fields to SDK env vars
  const envVars: Record<string, string> = {
    ANTHROPIC_BASE_URL: selectedProfile.baseUrl || '',
    ANTHROPIC_AUTH_TOKEN: selectedProfile.apiKey || '',
    ANTHROPIC_MODEL: selectedProfile.models?.default || '',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: selectedProfile.models?.haiku || '',
    ANTHROPIC_DEFAULT_SONNET_MODEL: selectedProfile.models?.sonnet || '',
    ANTHROPIC_DEFAULT_OPUS_MODEL: selectedProfile.models?.opus || '',
  };

  // Filter out empty/whitespace string values (only set env vars that have values)
  // This handles empty strings, null, undefined, and whitespace-only values
  const filteredEnvVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    const trimmedValue = value?.trim();
    if (trimmedValue && trimmedValue !== '') {
      filteredEnvVars[key] = trimmedValue;
    }
  }

  return filteredEnvVars;
}

/**
 * Test API profile connection
 *
 * Validates credentials by making a minimal API request to the /v1/models endpoint.
 * Returns detailed error information for different failure types.
 *
 * @param baseUrl - API base URL (will be normalized)
 * @param apiKey - API key for authentication
 * @param signal - Optional AbortSignal for cancelling the request
 * @returns Promise<TestConnectionResult> Result of connection test
 */
export async function testConnection(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<TestConnectionResult> {
  // Validate API key first (key format doesn't depend on URL normalization)
  if (!validateApiKey(apiKey)) {
    return {
      success: false,
      errorType: 'auth',
      message: 'Authentication failed. Please check your API key.'
    };
  }

  // Normalize baseUrl BEFORE validation (allows auto-prepending https://)
  let normalizedUrl = baseUrl.trim();

  // Store original URL for error suggestions
  const originalUrl = normalizedUrl;

  // If empty, return error
  if (!normalizedUrl) {
    return {
      success: false,
      errorType: 'endpoint',
      message: 'Invalid endpoint. Please check the Base URL.'
    };
  }

  // Ensure https:// prefix (auto-prepend if NO protocol exists)
  // Check if URL already has a protocol (contains ://)
  if (!normalizedUrl.includes('://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  // Remove trailing slash
  normalizedUrl = normalizedUrl.replace(/\/+$/, '');

  // Helper function to generate URL suggestions
  const getUrlSuggestions = (url: string): string[] => {
    const suggestions: string[] = [];

    // Check if URL lacks https://
    if (!url.includes('://')) {
      suggestions.push('Ensure URL starts with https://');
    }

    // Check for trailing slash
    if (url.endsWith('/')) {
      suggestions.push('Remove trailing slashes from URL');
    }

    // Check for suspicious domain patterns (common typos)
    const domainMatch = url.match(/:\/\/([^/]+)/);
    if (domainMatch) {
      const domain = domainMatch[1];
      // Check for common typos like anthropiic, ap, etc.
      if (domain.includes('anthropiic') || domain.includes('anthhropic') ||
          domain.includes('anhtropic') || domain.length < 10) {
        suggestions.push('Check for typos in domain name');
      }
    }

    return suggestions;
  };

  // Validate the normalized baseUrl
  if (!validateBaseUrl(normalizedUrl)) {
    // Generate suggestions based on original URL
    const suggestions = getUrlSuggestions(originalUrl);
    const message = suggestions.length > 0
      ? `Invalid endpoint. Please check the Base URL.${suggestions.map(s => ' ' + s).join('')}`
      : 'Invalid endpoint. Please check the Base URL.';

    return {
      success: false,
      errorType: 'endpoint',
      message
    };
  }

  // Set timeout to 10 seconds (NFR-P3 compliance)
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 10000);

  // Create a combined controller that aborts when either timeout or external signal aborts
  const combinedController = new AbortController();

  // Cleanup function for event listeners
  const cleanup = () => {
    clearTimeout(timeoutId);
  };

  // Listen to timeout abort
  const onTimeoutAbort = () => {
    cleanup();
    combinedController.abort();
  };
  timeoutController.signal.addEventListener('abort', onTimeoutAbort);

  // Listen to external signal abort (if provided)
  let onExternalAbort: (() => void) | undefined;
  if (signal) {
    // If external signal already aborted, abort immediately
    if (signal.aborted) {
      cleanup();
      timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
      return {
        success: false,
        errorType: 'timeout',
        message: 'Connection timeout. The endpoint did not respond.'
      };
    }

    // Listen to external signal abort
    onExternalAbort = () => {
      cleanup();
      timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
      combinedController.abort();
    };
    signal.addEventListener('abort', onExternalAbort);
  }

  const combinedSignal = combinedController.signal;

  try {
    // Make minimal API request
    const response = await fetch(`${normalizedUrl}/v1/models`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      signal: combinedSignal
    });

    // Clear timeout on successful response
    cleanup();
    if (onTimeoutAbort) {
      timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
    }
    if (signal && onExternalAbort) {
      signal.removeEventListener('abort', onExternalAbort);
    }

    // Parse response and determine error type
    if (response.status === 200 || response.status === 201) {
      return {
        success: true,
        message: 'Connection successful'
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        errorType: 'auth',
        message: 'Authentication failed. Please check your API key.'
      };
    }

    if (response.status === 404) {
      // Generate URL suggestions for 404 errors
      const suggestions = getUrlSuggestions(baseUrl.trim());
      const message = suggestions.length > 0
        ? `Invalid endpoint. Please check the Base URL.${suggestions.map(s => ' ' + s).join('')}`
        : 'Invalid endpoint. Please check the Base URL.';

      return {
        success: false,
        errorType: 'endpoint',
        message
      };
    }

    // Other HTTP errors
    return {
      success: false,
      errorType: 'unknown',
      message: 'Connection test failed. Please try again.'
    };
  } catch (error) {
    // Cleanup event listeners and timeout
    cleanup();
    if (onTimeoutAbort) {
      timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
    }
    if (signal && onExternalAbort) {
      signal.removeEventListener('abort', onExternalAbort);
    }

    // Determine error type from error object
    if (error instanceof Error) {
      // AbortError → timeout
      if (error.name === 'AbortError') {
        return {
          success: false,
          errorType: 'timeout',
          message: 'Connection timeout. The endpoint did not respond.'
        };
      }

      // TypeError with ECONNREFUSED/ENOTFOUND → network error
      if (error instanceof TypeError) {
        const errorCode = (error as any).code;
        if (errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND') {
          return {
            success: false,
            errorType: 'network',
            message: 'Network error. Please check your internet connection.'
          };
        }
      }
    }

    // Other errors
    return {
      success: false,
      errorType: 'unknown',
      message: 'Connection test failed. Please try again.'
    };
  }
}

/**
 * Track API profile usage after a request
 *
 * Updates request count, token usage, and last request time for rotation strategies.
 * Persists data to disk for recovery across app restarts.
 *
 * @param profileId - UUID of the API profile that was used
 * @param requestCount - Number of requests made (default: 1)
 * @param tokenUsage - Number of tokens consumed (default: 0)
 */
export function trackAPIProfileUsage(
  profileId: string,
  requestCount: number = 1,
  tokenUsage: number = 0
): void {
  // Get current usage data
  const currentUsage = getProfileUsage(profileId);

  // Calculate new totals
  const newRequestCount = (currentUsage?.requestCount || 0) + requestCount;
  const newTokenUsage = (currentUsage?.tokenUsage || 0) + tokenUsage;

  // Log usage tracking update (when DEBUG=true)
  debugWarn(
    `[profile-service] Usage tracking update: ` +
    `profileId=${profileId}, ` +
    `requestCount=${newRequestCount} (+${requestCount}), ` +
    `tokenUsage=${newTokenUsage} (+${tokenUsage})`
  );

  // Update usage data
  updateProfileUsage(profileId, {
    profileId,
    requestCount: newRequestCount,
    tokenUsage: newTokenUsage,
    lastRequestTime: Date.now(),
    isRateLimited: currentUsage?.isRateLimited || false,
    rateLimitResetTime: currentUsage?.rateLimitResetTime,
    quotaLimit: currentUsage?.quotaLimit,
    quotaWindow: currentUsage?.quotaWindow
  });
}

/**
 * Get API profile usage data
 *
 * Returns usage statistics for a specific API profile including request count,
 * token usage, last request time, and rate limit status. Returns null if the
 * profile has no usage data yet.
 *
 * @param profileId - UUID of the API profile
 * @returns Usage data or null if not found
 */
export function getAPIProfileUsage(profileId: string): APIProfileUsage | null {
  return getProfileUsage(profileId);
}

/**
 * Check if an API profile is available for use
 *
 * Determines availability based on rate limit status and quota constraints.
 * A profile is unavailable if:
 * - It is currently rate limited (and rate limit reset time has not passed)
 * - It has exceeded its quota limit (if configured)
 *
 * This function also clears expired rate limits automatically. If the rate limit
 * reset time has passed, the profile is marked as available again.
 *
 * @param profileId - UUID of the API profile
 * @returns true if profile is available, false otherwise
 */
export function isAPIProfileAvailable(profileId: string): boolean {
  const usage = getProfileUsage(profileId);

  // No usage data means profile has never been used - available
  if (!usage) {
    return true;
  }

  // Check if currently rate limited
  if (usage.isRateLimited) {
    // If rate limit reset time is set, check if it has expired
    if (usage.rateLimitResetTime) {
      const now = Date.now();
      if (now >= usage.rateLimitResetTime) {
        // Rate limit has expired - clear the flag and mark as available
        updateProfileUsage(profileId, {
          isRateLimited: false,
          rateLimitResetTime: undefined
        });
        return true;
      }
      // Still within rate limit backoff period
      return false;
    }
    // Rate limited but no reset time - should be cleared manually
    // Conservatively return false to avoid hitting rate limits
    return false;
  }

  // Check quota limits (if configured)
  if (usage.quotaLimit && usage.quotaWindow) {
    // Quota is configured - check if usage exceeds limit
    // Note: This is a simple check. A more sophisticated implementation would
    // check usage within the quota window (sliding window or token bucket).
    // For now, we just check total request count against quota.
    if (usage.requestCount >= usage.quotaLimit) {
      return false;
    }
  }

  // Profile is available
  return true;
}

/**
 * Result of parsing rate limit information from API response headers
 */
export interface RateLimitInfo {
  /** Whether the response indicates rate limiting */
  isRateLimited: boolean;
  /** Remaining requests before rate limit */
  remainingRequests?: number;
  /** Total request limit */
  requestLimit?: number;
  /** Unix timestamp (ms) when the rate limit resets */
  resetTime?: number;
  /** Whether a 429 status was received */
  is429: boolean;
}

/**
 * Parse rate limit headers from an API response
 *
 * Handles multiple header formats:
 * - Anthropic-specific: anthropic-ratelimit-requests-*
 * - Standard: RateLimit-* (used by some proxies)
 * - Retry-After: HTTP-date or seconds (for 429 responses)
 *
 * @param response - Fetch Response object from API call
 * @returns Parsed rate limit information
 */
export function parseRateLimitHeaders(response: Response): RateLimitInfo {
  const headers = response.headers;
  const result: RateLimitInfo = {
    isRateLimited: false,
    is429: response.status === 429
  };

  // Check Anthropic-specific rate limit headers
  const requestsRemaining = headers.get('anthropic-ratelimit-requests-remaining');
  const requestsLimit = headers.get('anthropic-ratelimit-requests-limit');
  const requestsReset = headers.get('anthropic-ratelimit-requests-reset');

  // Parse remaining requests
  if (requestsRemaining !== null) {
    const parsed = parseInt(requestsRemaining, 10);
    if (!isNaN(parsed)) {
      result.remainingRequests = parsed;
    }
  }

  // Parse request limit
  if (requestsLimit !== null) {
    const parsed = parseInt(requestsLimit, 10);
    if (!isNaN(parsed)) {
      result.requestLimit = parsed;
    }
  }

  // Parse reset time (Anthropic returns Unix timestamp in seconds)
  if (requestsReset !== null) {
    const parsed = parseInt(requestsReset, 10);
    if (!isNaN(parsed)) {
      // Convert to milliseconds
      result.resetTime = parsed * 1000;
    }
  }

  // Check standard RateLimit headers (used by some proxies/compatible APIs)
  if (result.remainingRequests === undefined) {
    const rateLimitRemaining = headers.get('ratelimit-remaining') || headers.get('x-ratelimit-remaining');
    if (rateLimitRemaining !== null) {
      const parsed = parseInt(rateLimitRemaining, 10);
      if (!isNaN(parsed)) {
        result.remainingRequests = parsed;
      }
    }
  }

  if (result.requestLimit === undefined) {
    const rateLimitLimit = headers.get('ratelimit-limit') || headers.get('x-ratelimit-limit');
    if (rateLimitLimit !== null) {
      const parsed = parseInt(rateLimitLimit, 10);
      if (!isNaN(parsed)) {
        result.requestLimit = parsed;
      }
    }
  }

  if (result.resetTime === undefined) {
    const rateLimitReset = headers.get('ratelimit-reset') || headers.get('x-ratelimit-reset');
    if (rateLimitReset !== null) {
      const parsed = parseInt(rateLimitReset, 10);
      if (!isNaN(parsed)) {
        // Some APIs return seconds, some return milliseconds
        // If less than 10000000000 (year 2286), assume seconds
        result.resetTime = parsed < 10000000000 ? parsed * 1000 : parsed;
      }
    }
  }

  // Handle 429 Too Many Requests with Retry-After header
  if (result.is429) {
    const retryAfter = headers.get('retry-after');
    if (retryAfter !== null && result.resetTime === undefined) {
      // Retry-After can be HTTP-date or seconds
      // Try parsing as seconds first
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        result.resetTime = Date.now() + (seconds * 1000);
      } else {
        // Try parsing as HTTP-date (e.g., "Fri, 31 Dec 2024 23:59:59 GMT")
        const date = new Date(retryAfter);
        if (!isNaN(date.getTime())) {
          result.resetTime = date.getTime();
        }
      }
    }
  }

  // Determine if rate limited
  // Either: 429 status, or remaining requests is 0, or we're near the limit
  if (result.is429) {
    result.isRateLimited = true;
  } else if (result.remainingRequests !== undefined && result.remainingRequests <= 0) {
    result.isRateLimited = true;
  }

  return result;
}

/**
 * Update API profile rate limit status from API response
 *
 * Parses rate limit headers from the response and updates the profile's
 * usage data with the latest rate limit information. Marks the profile
 * as rate limited if necessary.
 *
 * This should be called after every API request to track rate limit status.
 *
 * @param profileId - UUID of the API profile that was used
 * @param response - Fetch Response object from the API call
 * @returns Rate limit information parsed from headers
 */
export function updateAPIProfileRateLimit(
  profileId: string,
  response: Response
): RateLimitInfo {
  const rateLimitInfo = parseRateLimitHeaders(response);

  // Update profile usage with rate limit information
  updateProfileUsage(profileId, {
    isRateLimited: rateLimitInfo.isRateLimited,
    rateLimitResetTime: rateLimitInfo.resetTime
  });

  return rateLimitInfo;
}
