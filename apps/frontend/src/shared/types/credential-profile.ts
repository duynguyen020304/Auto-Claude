/**
 * Credential Profile Management Types
 *
 * Users can configure credential profiles with two types: OAuth (no usage limits) and
 * API Key (requires numeric usage limits). Each profile contains name, credential value,
 * usage metrics, rate limit information, and metadata for rotation strategies.
 *
 * NOTE: These types are intentionally duplicated from apps/backend/core/credentials.py
 * because the frontend build (Electron + Vite) doesn't consume the backend types directly.
 * Keep these definitions in sync with the backend types when making changes.
 */

/**
 * Credential type - distinguishes between OAuth tokens and API keys
 */
export type CredentialType = 'api_key' | 'oauth';

/**
 * Credential status - reflects the current state of the credential
 */
export type CredentialStatus = 'active' | 'rate_limited' | 'disabled';

/**
 * Rotation mode - determines how credentials are rotated in a pool
 */
export type RotationMode = 'manual' | 'round_robin' | 'usage_based' | 'rate_limit_aware';

/**
 * Usage metrics for tracking credential consumption
 */
export interface UsageMetrics {
  total_requests: number; // Total number of API requests made
  total_tokens: number; // Total tokens consumed (input + output)
  input_tokens: number; // Total input tokens
  output_tokens: number; // Total output tokens
  cache_read_tokens: number; // Total cache read tokens
  cache_creation_tokens: number; // Total cache creation tokens
  last_used: number | null; // Unix timestamp (ms) of last usage
}

/**
 * Rate limit information for a credential
 */
export interface RateLimitInfo {
  requests_per_minute: number | null; // Maximum requests per minute allowed
  tokens_per_minute: number | null; // Maximum tokens per minute allowed
  remaining_requests: number | null; // Remaining requests in current window
  remaining_tokens: number | null; // Remaining tokens in current window
  reset_at: number | null; // Unix timestamp (ms) when rate limit window resets
}

/**
 * Rotation configuration for credential pools
 */
export interface RotationConfig {
  mode: RotationMode; // Rotation strategy to use
  credential_pool: string[]; // List of credential IDs to rotate through
  rate_limit_threshold: number; // Threshold (0.0-1.0) for rate_limit_aware mode
  max_retries: number; // Maximum number of retry attempts when swapping credentials
  retry_delay_seconds: number; // Delay between retry attempts
}

/**
 * Credential Profile - represents a unified credential abstraction
 *
 * Normalizes API keys and OAuth tokens into a single interface with support for
 * usage tracking, rate limit handling, and rotation strategies.
 */
export interface CredentialProfile {
  id: string; // Unique identifier (e.g., "cred-001")
  type: CredentialType; // api_key or oauth
  name: string; // Human-readable name
  status: CredentialStatus; // active, rate_limited, or disabled
  credential_value: string; // The actual credential (never display in UI - use maskCredential())
  usage_metrics: UsageMetrics; // Token usage tracking data
  rate_limit_info: RateLimitInfo | null; // Rate limit information (if known)
  last_validated: number | null; // Unix timestamp (ms) of last validation check
  created_at: number; // Unix timestamp (ms) when profile was created
  metadata: Record<string, string> | null; // Additional metadata (optional)
}

/**
 * Pool - groups multiple credential profiles with rotation configuration
 */
export interface Pool {
  id: string; // Unique identifier (e.g., "pool-001")
  name: string; // Human-readable name
  profile_ids: string[]; // List of credential profile IDs in this pool
  limit: number; // Maximum number of profiles to use (0 = no limit)
  rotation_config: RotationConfig; // Configuration for credential rotation strategy
}

/**
 * Form data type for creating/editing credential profiles (without id, timestamps)
 */
export interface CredentialProfileFormData {
  type: CredentialType;
  name: string;
  credential_value: string;
  usage_limit?: number; // Optional usage limit (required for API profiles)
  rotation_mode?: RotationMode;
  rate_limit_threshold?: number;
  metadata?: Record<string, string>;
}
