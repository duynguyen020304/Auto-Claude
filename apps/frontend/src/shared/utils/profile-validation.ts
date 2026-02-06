/**
 * Profile Validation Utilities
 *
 * Provides utility functions for validating and resolving API profiles.
 * Handles graceful fallback to active profile when selected profile is invalid.
 *
 * Used by Insights, Roadmap, and Ideation features to safely resolve profile
 * selections with proper error handling and fallback behavior.
 */

import type { APIProfile } from '../types/profile';

/**
 * Profile validation result
 * Contains the resolved profile and any validation issues
 */
export interface ProfileValidationResult {
  profile: APIProfile | null;
  isValid: boolean;
  reason?: 'not_found' | 'missing_credentials' | 'invalid_url' | 'fallback_to_active';
}

/**
 * Validate and resolve a profile selection
 *
 * Returns the profile if valid, null otherwise. Handles graceful fallback
 * to the active profile when the selected profile is invalid.
 *
 * @param selectedProfileId - The selected profile ID (undefined = use active profile)
 * @param availableProfiles - List of all available profiles
 * @param activeProfileId - The currently active profile ID
 * @returns Profile validation result with the resolved profile or null
 *
 * @example
 * const result = validateProfileSelection('profile-123', profiles, 'profile-456');
 * if (!result.isValid) {
 *   console.warn(`Profile validation failed: ${result.reason}`);
 * }
 */
export function validateProfileSelection(
  selectedProfileId: string | undefined | null,
  availableProfiles: readonly APIProfile[],
  _activeProfileId: string | null
): ProfileValidationResult {
  // If no profile selected, this means "Use Active Profile"
  // Return null to indicate the caller should use the active profile
  if (!selectedProfileId) {
    return {
      profile: null,
      isValid: true,
      reason: undefined
    };
  }

  // Find the selected profile
  const profile = availableProfiles.find((p) => p.id === selectedProfileId);

  if (!profile) {
    // Profile not found - log warning and fall back to active
    console.warn(
      `[profile-validation] Selected profile '${selectedProfileId}' not found in available profiles. ` +
        `Falling back to active profile.`
    );
    return {
      profile: null,
      isValid: true,
      reason: 'fallback_to_active'
    };
  }

  // Validate profile has required fields
  if (!profile.baseUrl || !profile.apiKey) {
    console.warn(
      `[profile-validation] Profile '${profile.name}' (${profile.id}) is missing required fields. ` +
        `Falling back to active profile.`
    );
    return {
      profile: null,
      isValid: true,
      reason: 'fallback_to_active'
    };
  }

  // Validate URL format
  try {
    new URL(profile.baseUrl);
  } catch {
    console.warn(
      `[profile-validation] Profile '${profile.name}' (${profile.id}) has invalid URL: ${profile.baseUrl}. ` +
        `Falling back to active profile.`
    );
    return {
      profile: null,
      isValid: true,
      reason: 'fallback_to_active'
    };
  }

  // Profile is valid
  return {
    profile,
    isValid: true
  };
}

/**
 * Get the effective profile ID to use
 *
 * Returns the profile ID that should be used, accounting for the special
 * "Use Active Profile" case (represented by undefined or null).
 *
 * @param selectedProfileId - The selected profile ID (undefined/null = use active)
 * @param availableProfiles - List of all available profiles
 * @param activeProfileId - The currently active profile ID
 * @returns The effective profile ID to use (undefined means use active profile)
 *
 * @example
 * const effectiveId = getEffectiveProfileId(undefined, profiles, 'profile-123');
 * // Returns: undefined (use active profile)
 *
 * const effectiveId = getEffectiveProfileId('profile-456', profiles, 'profile-123');
 * // Returns: 'profile-456' (if valid) or undefined (if invalid)
 */
export function getEffectiveProfileId(
  selectedProfileId: string | undefined | null,
  availableProfiles: readonly APIProfile[],
  activeProfileId: string | null
): string | undefined {
  // No profile selected means "Use Active Profile"
  if (!selectedProfileId) {
    return undefined;
  }

  // Validate the selection
  const result = validateProfileSelection(selectedProfileId, availableProfiles, activeProfileId);

  // Return profile ID if valid, otherwise undefined (fallback to active)
  return result.profile ? result.profile.id : undefined;
}

/**
 * Check if a profile is the active profile
 *
 * @param profileId - The profile ID to check
 * @param activeProfileId - The currently active profile ID
 * @returns true if the profile is the active profile
 */
export function isActiveProfile(profileId: string | undefined | null, activeProfileId: string | null): boolean {
  return profileId !== undefined && profileId !== null && profileId === activeProfileId;
}

/**
 * Find a profile by ID with safe null handling
 *
 * @param profileId - The profile ID to find (undefined/null returns null)
 * @param availableProfiles - List of all available profiles
 * @returns The profile if found, null otherwise
 */
export function findProfileById(
  profileId: string | undefined | null,
  availableProfiles: readonly APIProfile[]
): APIProfile | null {
  if (!profileId) {
    return null;
  }
  return availableProfiles.find((p) => p.id === profileId) ?? null;
}

/**
 * Get profile display name with fallback
 *
 * Returns a human-readable name for the profile, with special handling
 * for "Use Active Profile" and missing profiles.
 *
 * @param profileId - The profile ID (undefined = use active profile)
 * @param availableProfiles - List of all available profiles
 * @param activeProfileId - The currently active profile ID
 * @param useActiveProfileLabel - Label for "Use Active Profile" option
 * @returns Human-readable profile name
 *
 * @example
 * const name = getProfileDisplayName(undefined, profiles, 'profile-123', 'Use Active Profile');
 * // Returns: 'Use Active Profile'
 *
 * const name = getProfileDisplayName('profile-456', profiles, 'profile-123', 'Use Active Profile');
 * // Returns: 'My Custom Profile' or 'Unknown Profile'
 */
export function getProfileDisplayName(
  profileId: string | undefined | null,
  availableProfiles: readonly APIProfile[],
  activeProfileId: string | null,
  useActiveProfileLabel: string = 'Use Active Profile'
): string {
  // No profile selected = "Use Active Profile"
  if (!profileId) {
    return useActiveProfileLabel;
  }

  // Check if this is the active profile
  if (isActiveProfile(profileId, activeProfileId)) {
    const activeProfile = findProfileById(activeProfileId, availableProfiles);
    if (activeProfile) {
      return `${activeProfile.name} (Active)`;
    }
  }

  // Find the profile
  const profile = findProfileById(profileId, availableProfiles);
  if (profile) {
    return profile.name;
  }

  // Profile not found
  return 'Unknown Profile';
}

/**
 * Mask API key for safe display
 *
 * Returns a safe representation of an API key for logging or UI display.
 * Shows first 8 and last 4 characters, hiding the sensitive middle portion.
 *
 * @param apiKey - The API key to mask
 * @returns A safe fingerprint like 'sk-ant-oa...xyz9'
 *
 * @example
 * const masked = maskApiKey('sk-ant-api03-1234567890abcdef');
 * // Returns: 'sk-ant-...cdef'
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return '';
  }
  if (apiKey.length <= 16) {
    return `${apiKey.slice(0, 4)}...${apiKey.slice(-2)}`;
  }
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

/**
 * Check if profile selection should be disabled
 *
 * Profiles are disabled when there are no profiles available other than
 * the active profile (if any).
 *
 * @param availableProfiles - List of all available profiles
 * @param activeProfileId - The currently active profile ID
 * @returns true if profile selection should be disabled
 */
export function isProfileSelectionDisabled(
  _availableProfiles: readonly APIProfile[],
  _activeProfileId: string | null
): boolean {
  // Always allow selection if there's at least one profile
  // Even if only the active profile exists, user can still choose "Use Active Profile"
  return false;
}

/**
 * Get all valid profiles for selection dropdown
 *
 * Filters out profiles with missing or invalid credentials.
 *
 * @param availableProfiles - List of all available profiles
 * @returns Array of valid profiles for selection
 */
export function getValidProfiles(availableProfiles: readonly APIProfile[]): APIProfile[] {
  return availableProfiles.filter((profile) => {
    // Check required fields
    if (!profile.baseUrl || !profile.apiKey) {
      return false;
    }

    // Validate URL format
    try {
      new URL(profile.baseUrl);
      return true;
    } catch {
      return false;
    }
  });
}
