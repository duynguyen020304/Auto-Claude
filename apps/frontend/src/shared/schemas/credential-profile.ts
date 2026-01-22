import { z } from 'zod';

/**
 * Zod schemas for credential profile validation
 *
 * Uses .safeParse() pattern (Zod v4.x) for validation without throwing errors.
 * These schemas validate form data and configuration objects for credential profiles
 * and pools, ensuring type safety and data integrity.
 */

/**
 * Base enums matching backend Python enums
 */
export const CredentialTypeSchema = z.enum(['api_key', 'oauth']);
export const CredentialStatusSchema = z.enum(['active', 'rate_limited', 'disabled']);
export const RotationModeSchema = z.enum(['manual', 'round_robin', 'usage_based', 'rate_limit_aware']);

/**
 * Usage metrics schema for tracking credential consumption
 */
export const UsageMetricsSchema = z.object({
  total_requests: z.number().int().min(0),
  total_tokens: z.number().int().min(0),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cache_read_tokens: z.number().int().min(0),
  cache_creation_tokens: z.number().int().min(0),
  last_used: z.number().int().nullable().default(null),
});

/**
 * Rate limit information schema
 */
export const RateLimitInfoSchema = z.object({
  requests_per_minute: z.number().int().positive().nullable(),
  tokens_per_minute: z.number().int().positive().nullable(),
  remaining_requests: z.number().int().min(0).nullable(),
  remaining_tokens: z.number().int().min(0).nullable(),
  reset_at: z.number().int().nullable(),
});

/**
 * Rotation configuration schema
 */
export const RotationConfigSchema = z.object({
  mode: RotationModeSchema,
  credential_pool: z.array(z.string().uuid()).default([]),
  rate_limit_threshold: z.number().min(0).max(1).default(0.8),
  max_retries: z.number().int().min(0).default(3),
  retry_delay_seconds: z.number().int().min(0).default(1),
});

/**
 * Credential profile form data schema
 *
 * Used for creating and editing credential profiles.
 * API profiles require usage_limit, OAuth profiles don't.
 */
export const CredentialProfileFormDataSchema = z
  .object({
    type: CredentialTypeSchema,
    name: z
      .string()
      .min(1, 'Profile name is required')
      .max(100, 'Profile name must be less than 100 characters'),
    credential_value: z.string().min(1, 'Credential value is required'),
    usage_limit: z.number().int().min(0).optional(),
    rotation_mode: RotationModeSchema.optional(),
    rate_limit_threshold: z.number().min(0, 'Must be at least 0').max(1, 'Must be at most 1').optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .refine(
    (data) => {
      // API profiles require usage_limit
      if (data.type === 'api_key') {
        return data.usage_limit !== undefined && data.usage_limit !== null;
      }
      return true;
    },
    {
      message: 'Usage limit is required for API profiles',
      path: ['usage_limit'],
    }
  )
  .refine(
    (data) => {
      // rate_limit_threshold is required when rotation_mode is 'rate_limit_aware'
      if (data.rotation_mode === 'rate_limit_aware') {
        return data.rate_limit_threshold !== undefined && data.rate_limit_threshold !== null;
      }
      return true;
    },
    {
      message: 'Rate limit threshold is required for rate-limit-aware rotation mode',
      path: ['rate_limit_threshold'],
    }
  );

/**
 * Full credential profile schema (matches backend dataclass)
 */
export const CredentialProfileSchema = z.object({
  id: z.string().uuid(),
  type: CredentialTypeSchema,
  name: z.string().min(1).max(100),
  status: CredentialStatusSchema,
  credential_value: z.string().min(1),
  usage_metrics: UsageMetricsSchema,
  rate_limit_info: RateLimitInfoSchema.nullable(),
  last_validated: z.number().int().nullable(),
  created_at: z.number().int(),
  metadata: z.record(z.string(), z.string()).nullable(),
});

/**
 * Pool form data schema
 */
export const PoolFormDataSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Pool name is required')
      .max(100, 'Pool name must be less than 100 characters'),
    profile_ids: z
      .array(z.string().uuid())
      .min(1, 'At least one profile is required')
      .default([]),
    limit: z.number().int().min(0, 'Limit must be a non-negative number').default(0),
    rotation_config: RotationConfigSchema,
  })
  .refine(
    (data) => {
      // If limit is 0, it means no limit (unlimited)
      // If limit > 0, ensure it's reasonable
      return data.limit === 0 || data.limit > 0;
    },
    {
      message: 'Pool limit must be 0 (unlimited) or a positive number',
      path: ['limit'],
    }
  );

/**
 * Full pool schema (matches backend dataclass)
 */
export const PoolSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  profile_ids: z.array(z.string().uuid()),
  limit: z.number().int().min(0),
  rotation_config: RotationConfigSchema,
});

// Type exports using z.infer
export type CredentialType = z.infer<typeof CredentialTypeSchema>;
export type CredentialStatus = z.infer<typeof CredentialStatusSchema>;
export type RotationMode = z.infer<typeof RotationModeSchema>;
export type UsageMetrics = z.infer<typeof UsageMetricsSchema>;
export type RateLimitInfo = z.infer<typeof RateLimitInfoSchema>;
export type RotationConfig = z.infer<typeof RotationConfigSchema>;
export type CredentialProfileFormData = z.infer<typeof CredentialProfileFormDataSchema>;
export type CredentialProfile = z.infer<typeof CredentialProfileSchema>;
export type PoolFormData = z.infer<typeof PoolFormDataSchema>;
export type Pool = z.infer<typeof PoolSchema>;

/**
 * Validation result types
 */
export interface ValidationResult<T> {
  success: true;
  data: T;
}

export interface ValidationError {
  success: false;
  error: z.ZodError;
}

export type ParseResult<T> = ValidationResult<T> | ValidationError;

/**
 * Helper functions for validation using .safeParse() pattern
 */

/**
 * Validate credential profile form data
 */
export function validateCredentialProfileFormData(data: unknown): ParseResult<CredentialProfileFormData> {
  const result = CredentialProfileFormDataSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validate credential profile (full object)
 */
export function validateCredentialProfile(data: unknown): ParseResult<CredentialProfile> {
  const result = CredentialProfileSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validate pool form data
 */
export function validatePoolFormData(data: unknown): ParseResult<PoolFormData> {
  const result = PoolFormDataSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validate pool (full object)
 */
export function validatePool(data: unknown): ParseResult<Pool> {
  const result = PoolSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Type guard functions for runtime type checking
 */
export function isValidCredentialProfileFormData(data: unknown): data is CredentialProfileFormData {
  return CredentialProfileFormDataSchema.safeParse(data).success;
}

export function isValidCredentialProfile(data: unknown): data is CredentialProfile {
  return CredentialProfileSchema.safeParse(data).success;
}

export function isValidPoolFormData(data: unknown): data is PoolFormData {
  return PoolFormDataSchema.safeParse(data).success;
}

export function isValidPool(data: unknown): data is Pool {
  return PoolSchema.safeParse(data).success;
}

/**
 * Helper function to format Zod errors for display in UI
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((e) => {
      const path = e.path.length > 0 ? e.path.join('.') : 'field';
      return `${path}: ${e.message}`;
    })
    .join(', ');
}
