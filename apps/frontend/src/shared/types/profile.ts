/**
 * API Profile Management Types
 *
 * Users can configure custom Anthropic-compatible API endpoints with profiles.
 * Each profile contains name, base URL, API key, and optional model mappings.
 *
 * NOTE: These types are intentionally duplicated from libs/profile-service/src/types/profile.ts
 * because the frontend build (Electron + Vite) doesn't consume the workspace library types directly.
 * Keep these definitions in sync with the library types when making changes.
 */

/**
 * API Profile - represents a custom API endpoint configuration
 * IMPORTANT: Named APIProfile (not Profile) to avoid conflicts with user profiles
 */
export interface APIProfile {
  id: string; // UUID v4
  name: string; // User-friendly name
  baseUrl: string; // API endpoint URL (e.g., https://api.anthropic.com)
  apiKey: string; // Full API key (never display in UI - use maskApiKey())
  models?: {
    // OPTIONAL - only specify models to override
    default?: string; // Maps to ANTHROPIC_MODEL
    haiku?: string; // Maps to ANTHROPIC_DEFAULT_HAIKU_MODEL
    sonnet?: string; // Maps to ANTHROPIC_DEFAULT_SONNET_MODEL
    opus?: string; // Maps to ANTHROPIC_DEFAULT_OPUS_MODEL
  };
  createdAt: number; // Unix timestamp (ms)
  updatedAt: number; // Unix timestamp (ms)
}

/**
 * Profile file structure - stored in profiles.json
 */
export interface ProfilesFile {
  profiles: APIProfile[];
  activeProfileId: string | null;
  version: number;
}

/**
 * Form data type for creating/editing profiles (without id, models optional)
 */
export interface ProfileFormData {
  name: string;
  baseUrl: string;
  apiKey: string;
  models?: {
    default?: string;
    haiku?: string;
    sonnet?: string;
    opus?: string;
  };
}

/**
 * Shared error type for connection-related errors
 * Used by both TestConnectionResult and DiscoverModelsError
 */
export type ConnectionErrorType = 'auth' | 'network' | 'endpoint' | 'timeout' | 'not_supported' | 'unknown';

/**
 * Test connection result - returned by profile:test-connection
 */
export interface TestConnectionResult {
  success: boolean;
  errorType?: ConnectionErrorType;
  message: string;
}

/**
 * Model information from /v1/models endpoint
 */
export interface ModelInfo {
  id: string; // Model ID (e.g., "claude-sonnet-4-5-20250929")
  display_name: string; // Human-readable name (e.g., "Claude Sonnet 4")
}

/**
 * Result from discoverModels operation
 */
export interface DiscoverModelsResult {
  models: ModelInfo[];
}

/**
 * Error from discoverModels operation
 */
export interface DiscoverModelsError {
  errorType: ConnectionErrorType;
  message: string;
}

/**
 * API Profile Usage - tracks usage data for API profiles
 * Used for rotation strategy and quota management
 */
export interface APIProfileUsage {
  profileId: string; // UUID of the API profile
  requestCount: number; // Total requests made
  tokenUsage: number; // Total tokens consumed
  lastRequestTime: number; // Unix timestamp (ms) of last request
  rateLimitResetTime?: number; // Unix timestamp (ms) when rate limit resets (if rate limited)
  isRateLimited: boolean; // Currently rate limited
  quotaLimit?: number; // Optional quota limit (user-configured)
  quotaWindow?: number; // Quota time window in seconds
}

/**
 * API Profile Rotation Strategy Type
 * Determines how API profiles are selected when rotation is enabled
 */
export type APIProfileRotationStrategyType =
  | 'priority'      // Use priority order (default, existing behavior)
  | 'round-robin'   // Cycle through profiles sequentially
  | 'least-used'    // Select profile with lowest usage (tokens + requests)
  | 'random'        // Random selection with uniform distribution
  | 'weighted'      // Weighted distribution based on profile weights
  | 'time-based';   // Rotate at configured time intervals

/**
 * API Profile Rotation Strategy - configuration for automatic API profile rotation
 */
export interface APIProfileRotationStrategy {
  enabled: boolean; // Whether rotation is enabled
  strategy?: APIProfileRotationStrategyType; // Strategy for automatic profile selection (default: 'priority')
  priorityOrder: string[]; // API profile IDs in priority order
  fallbackToOAuth: boolean; // Allow fallback to OAuth profiles
  thresholds: {
    maxUsagePercent: number; // Switch profile at X% of quota (0-100)
    rateLimitBackoff: number; // Seconds to wait after rate limit
  };
  rotationInterval?: number; // Time-based rotation interval in seconds (default: 300 = 5 minutes)
  weights?: Record<string, number>; // Weighted distribution weights per profile ID (format: { "profileId": weight })
  rotationIndex?: number; // Round-robin state tracking - last used profile index
  /** Time-based state tracking - current profile ID */
  timeBasedCurrentProfile?: string;
  /** Time-based state tracking - ISO timestamp of last rotation */
  timeBasedLastRotationTime?: string;
  /** Time-based state tracking - index of current profile in available profiles list */
  timeBasedProfileIndex?: number;
}
