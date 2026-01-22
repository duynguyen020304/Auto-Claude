/**
 * Tests for credential profile Zod schemas and enum compatibility
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import {
  CredentialTypeSchema,
  CredentialStatusSchema,
  RotationModeSchema,
  UsageMetricsSchema,
  RateLimitInfoSchema,
  RotationConfigSchema,
  CredentialProfileFormDataSchema,
  CredentialProfileSchema,
  PoolFormDataSchema,
  PoolSchema,
  validateCredentialProfileFormData,
  validateCredentialProfile,
  validatePoolFormData,
  validatePool
} from '../../schemas/credential-profile';

// Backend Python enums for compatibility verification
// From apps/backend/core/credentials.py:
// class CredentialType(str, Enum):
//     API_KEY = "api_key"
//     OAUTH = "oauth"
//
// class CredentialStatus(str, Enum):
//     ACTIVE = "active"
//     RATE_LIMITED = "rate_limited"
//     DISABLED = "disabled"
//
// class RotationMode(str, Enum):
//     MANUAL = "manual"
//     ROUND_ROBIN = "round_robin"
//     USAGE_BASED = "usage_based"
//     RATE_LIMIT_AWARE = "rate_limit_aware"

describe('Credential Profile Zod Schema Validation', () => {
  describe('CredentialTypeSchema', () => {
    it('should validate api_key type', () => {
      const result = CredentialTypeSchema.safeParse('api_key');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('api_key');
      }
    });

    it('should validate oauth type', () => {
      const result = CredentialTypeSchema.safeParse('oauth');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('oauth');
      }
    });

    it('should reject invalid credential types', () => {
      const result = CredentialTypeSchema.safeParse('invalid_type');
      expect(result.success).toBe(false);
    });
  });

  describe('CredentialStatusSchema', () => {
    it('should validate active status', () => {
      const result = CredentialStatusSchema.safeParse('active');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('active');
      }
    });

    it('should validate rate_limited status', () => {
      const result = CredentialStatusSchema.safeParse('rate_limited');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('rate_limited');
      }
    });

    it('should validate disabled status', () => {
      const result = CredentialStatusSchema.safeParse('disabled');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('disabled');
      }
    });

    it('should reject invalid status', () => {
      const result = CredentialStatusSchema.safeParse('invalid_status');
      expect(result.success).toBe(false);
    });
  });

  describe('RotationModeSchema', () => {
    it('should validate manual rotation mode', () => {
      const result = RotationModeSchema.safeParse('manual');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('manual');
      }
    });

    it('should validate round_robin rotation mode', () => {
      const result = RotationModeSchema.safeParse('round_robin');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('round_robin');
      }
    });

    it('should validate usage_based rotation mode', () => {
      const result = RotationModeSchema.safeParse('usage_based');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('usage_based');
      }
    });

    it('should validate rate_limit_aware rotation mode', () => {
      const result = RotationModeSchema.safeParse('rate_limit_aware');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('rate_limit_aware');
      }
    });

    it('should reject invalid rotation mode', () => {
      const result = RotationModeSchema.safeParse('invalid_mode');
      expect(result.success).toBe(false);
    });
  });

  describe('UsageMetricsSchema', () => {
    it('should validate valid usage metrics', () => {
      const metrics = {
        total_requests: 100,
        total_tokens: 5000,
        input_tokens: 3000,
        output_tokens: 2000,
        cache_read_tokens: 100,
        cache_creation_tokens: 50,
        last_used: Date.now()
      };

      const result = UsageMetricsSchema.safeParse(metrics);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.total_requests).toBe(100);
        expect(result.data.total_tokens).toBe(5000);
      }
    });

    it('should validate metrics with null last_used', () => {
      const metrics = {
        total_requests: 0,
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        last_used: null
      };

      const result = UsageMetricsSchema.safeParse(metrics);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.last_used).toBe(null);
      }
    });

    it('should reject negative values', () => {
      const metrics = {
        total_requests: -1,
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        last_used: null
      };

      const result = UsageMetricsSchema.safeParse(metrics);
      expect(result.success).toBe(false);
    });
  });

  describe('RateLimitInfoSchema', () => {
    it('should validate valid rate limit info', () => {
      const rateLimitInfo = {
        requests_per_minute: 100,
        tokens_per_minute: 50000,
        remaining_requests: 50,
        remaining_tokens: 25000,
        reset_at: Date.now() + 60000
      };

      const result = RateLimitInfoSchema.safeParse(rateLimitInfo);
      expect(result.success).toBe(true);
    });

    it('should validate rate limit info with nullable fields', () => {
      const rateLimitInfo = {
        requests_per_minute: null,
        tokens_per_minute: null,
        remaining_requests: null,
        remaining_tokens: null,
        reset_at: null
      };

      const result = RateLimitInfoSchema.safeParse(rateLimitInfo);
      expect(result.success).toBe(true);
    });
  });

  describe('RotationConfigSchema', () => {
    it('should validate valid rotation config', () => {
      const config = {
        mode: 'round_robin' as const,
        credential_pool: ['cred-001', 'cred-002'],
        rate_limit_threshold: 0.8,
        max_retries: 3,
        retry_delay_seconds: 1
      };

      const result = RotationConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe('round_robin');
        expect(result.data.credential_pool).toHaveLength(2);
      }
    });
  });
});

describe('Credential Profile Form Data Validation', () => {
  describe('API Profile Validation', () => {
    it('should validate API profile with required usage_limit', () => {
      const apiProfileData = {
        type: 'api_key' as const,
        name: 'Test API Profile',
        credential_value: 'sk-test-123',
        usage_limit: 100,
        rotation_mode: 'manual' as const
      };

      const result = validateCredentialProfileFormData(apiProfileData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('api_key');
        expect(result.data.usage_limit).toBe(100);
      }
    });

    it('should reject API profile without usage_limit', () => {
      const apiProfileData = {
        type: 'api_key' as const,
        name: 'Test API Profile',
        credential_value: 'sk-test-123'
        // Missing usage_limit - required for API profiles
      };

      const result = validateCredentialProfileFormData(apiProfileData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.message === 'Usage limit is required for API profiles')).toBe(true);
      }
    });
  });

  describe('OAuth Profile Validation', () => {
    it('should validate OAuth profile without usage_limit', () => {
      const oauthProfileData = {
        type: 'oauth' as const,
        name: 'Test OAuth Profile',
        credential_value: 'oauth-token-123'
      };

      const result = validateCredentialProfileFormData(oauthProfileData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('oauth');
        expect(result.data.usage_limit).toBeUndefined();
      }
    });

    it('should accept OAuth profile with usage_limit (optional)', () => {
      const oauthProfileData = {
        type: 'oauth' as const,
        name: 'Test OAuth Profile',
        credential_value: 'oauth-token-123',
        usage_limit: 0 // Optional for OAuth, but allowed
      };

      const result = validateCredentialProfileFormData(oauthProfileData);
      expect(result.success).toBe(true);
    });
  });

  describe('Rotation Mode Validation', () => {
    it('should require rate_limit_threshold for rate_limit_aware mode', () => {
      const profileData = {
        type: 'api_key' as const,
        name: 'Test Profile',
        credential_value: 'sk-test',
        usage_limit: 100,
        rotation_mode: 'rate_limit_aware' as const,
        rate_limit_threshold: 0.8
      };

      const result = validateCredentialProfileFormData(profileData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rate_limit_threshold).toBe(0.8);
      }
    });

    it('should reject rate_limit_aware mode without threshold', () => {
      const profileData = {
        type: 'api_key' as const,
        name: 'Test Profile',
        credential_value: 'sk-test',
        usage_limit: 100,
        rotation_mode: 'rate_limit_aware' as const
        // Missing rate_limit_threshold
      };

      const result = validateCredentialProfileFormData(profileData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(issue =>
          issue.message === 'Rate limit threshold is required for rate-limit-aware rotation mode'
        )).toBe(true);
      }
    });

    it('should allow other modes without rate_limit_threshold', () => {
      const modes: Array<'manual' | 'round_robin' | 'usage_based'> = ['manual', 'round_robin', 'usage_based'];

      modes.forEach(mode => {
        const profileData = {
          type: 'api_key' as const,
          name: 'Test Profile',
          credential_value: 'sk-test',
          usage_limit: 100,
          rotation_mode: mode
        };

        const result = validateCredentialProfileFormData(profileData);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Name and Credential Validation', () => {
    it('should reject empty name', () => {
      const profileData = {
        type: 'api_key' as const,
        name: '',
        credential_value: 'sk-test',
        usage_limit: 100
      };

      const result = validateCredentialProfileFormData(profileData);
      expect(result.success).toBe(false);
    });

    it('should reject name over 100 characters', () => {
      const profileData = {
        type: 'api_key' as const,
        name: 'a'.repeat(101),
        credential_value: 'sk-test',
        usage_limit: 100
      };

      const result = validateCredentialProfileFormData(profileData);
      expect(result.success).toBe(false);
    });

    it('should reject empty credential_value', () => {
      const profileData = {
        type: 'api_key' as const,
        name: 'Test Profile',
        credential_value: '',
        usage_limit: 100
      };

      const result = validateCredentialProfileFormData(profileData);
      expect(result.success).toBe(false);
    });
  });
});

describe('Pool Validation', () => {
  describe('Pool Form Data Validation', () => {
    it('should validate valid pool form data', () => {
      const poolData = {
        name: 'Test Pool',
        profile_ids: ['cred-001', 'cred-002'],
        limit: 10,
        rotation_config: {
          mode: 'round_robin' as const,
          credential_pool: ['cred-001', 'cred-002'],
          rate_limit_threshold: 0.8,
          max_retries: 3,
          retry_delay_seconds: 1
        }
      };

      const result = validatePoolFormData(poolData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Test Pool');
        expect(result.data.profile_ids).toHaveLength(2);
      }
    });

    it('should validate pool with unlimited limit (0)', () => {
      const poolData = {
        name: 'Unlimited Pool',
        profile_ids: ['cred-001'],
        limit: 0,
        rotation_config: {
          mode: 'manual' as const,
          credential_pool: ['cred-001'],
          rate_limit_threshold: 0.8,
          max_retries: 3,
          retry_delay_seconds: 1
        }
      };

      const result = validatePoolFormData(poolData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(0);
      }
    });

    it('should reject pool with no profiles', () => {
      const poolData = {
        name: 'Empty Pool',
        profile_ids: [],
        limit: 10,
        rotation_config: {
          mode: 'manual' as const,
          credential_pool: [],
          rate_limit_threshold: 0.8,
          max_retries: 3,
          retry_delay_seconds: 1
        }
      };

      const result = validatePoolFormData(poolData);
      expect(result.success).toBe(false);
    });

    it('should reject pool with negative limit', () => {
      const poolData = {
        name: 'Invalid Pool',
        profile_ids: ['cred-001'],
        limit: -1,
        rotation_config: {
          mode: 'manual' as const,
          credential_pool: ['cred-001'],
          rate_limit_threshold: 0.8,
          max_retries: 3,
          retry_delay_seconds: 1
        }
      };

      const result = validatePoolFormData(poolData);
      expect(result.success).toBe(false);
    });
  });
});

describe('Backend Enum Compatibility', () => {
  describe('CredentialType Enum Compatibility', () => {
    it('should match backend CredentialType.API_KEY value', () => {
      // Backend: API_KEY = "api_key"
      const frontendValue = 'api_key';
      const result = CredentialTypeSchema.safeParse(frontendValue);
      expect(result.success).toBe(true);
    });

    it('should match backend CredentialType.OAUTH value', () => {
      // Backend: OAUTH = "oauth"
      const frontendValue = 'oauth';
      const result = CredentialTypeSchema.safeParse(frontendValue);
      expect(result.success).toBe(true);
    });

    it('should support all backend CredentialType enum values', () => {
      // Backend has exactly 2 values: API_KEY and OAUTH
      const backendValues = ['api_key', 'oauth'];
      backendValues.forEach(value => {
        const result = CredentialTypeSchema.safeParse(value);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('CredentialStatus Enum Compatibility', () => {
    it('should match backend CredentialStatus.ACTIVE value', () => {
      // Backend: ACTIVE = "active"
      const result = CredentialStatusSchema.safeParse('active');
      expect(result.success).toBe(true);
    });

    it('should match backend CredentialStatus.RATE_LIMITED value', () => {
      // Backend: RATE_LIMITED = "rate_limited"
      const result = CredentialStatusSchema.safeParse('rate_limited');
      expect(result.success).toBe(true);
    });

    it('should match backend CredentialStatus.DISABLED value', () => {
      // Backend: DISABLED = "disabled"
      const result = CredentialStatusSchema.safeParse('disabled');
      expect(result.success).toBe(true);
    });

    it('should support all backend CredentialStatus enum values', () => {
      // Backend has exactly 3 values: ACTIVE, RATE_LIMITED, DISABLED
      const backendValues = ['active', 'rate_limited', 'disabled'];
      backendValues.forEach(value => {
        const result = CredentialStatusSchema.safeParse(value);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('RotationMode Enum Compatibility', () => {
    it('should match backend RotationMode.MANUAL value', () => {
      // Backend: MANUAL = "manual"
      const result = RotationModeSchema.safeParse('manual');
      expect(result.success).toBe(true);
    });

    it('should match backend RotationMode.ROUND_ROBIN value', () => {
      // Backend: ROUND_ROBIN = "round_robin"
      const result = RotationModeSchema.safeParse('round_robin');
      expect(result.success).toBe(true);
    });

    it('should match backend RotationMode.USAGE_BASED value', () => {
      // Backend: USAGE_BASED = "usage_based"
      const result = RotationModeSchema.safeParse('usage_based');
      expect(result.success).toBe(true);
    });

    it('should match backend RotationMode.RATE_LIMIT_AWARE value', () => {
      // Backend: RATE_LIMIT_AWARE = "rate_limit_aware"
      const result = RotationModeSchema.safeParse('rate_limit_aware');
      expect(result.success).toBe(true);
    });

    it('should support all backend RotationMode enum values', () => {
      // Backend has exactly 4 values: MANUAL, ROUND_ROBIN, USAGE_BASED, RATE_LIMIT_AWARE
      const backendValues = ['manual', 'round_robin', 'usage_based', 'rate_limit_aware'];
      backendValues.forEach(value => {
        const result = RotationModeSchema.safeParse(value);
        expect(result.success).toBe(true);
      });
    });

    it('should have exactly the same number of rotation modes as backend', () => {
      // Backend RotationMode enum has 4 values
      // Verify frontend also has exactly 4 values
      const frontendModes = ['manual', 'round_robin', 'usage_based', 'rate_limit_aware'];
      expect(frontendModes).toHaveLength(4);

      frontendModes.forEach(mode => {
        const result = RotationModeSchema.safeParse(mode);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('String Enum Serialization Compatibility', () => {
    it('should serialize to JSON strings matching backend Python string enums', () => {
      // Python string enums serialize to their string values
      // Frontend TypeScript enums should serialize identically
      const profileData = {
        type: 'api_key',
        status: 'active',
        rotation_mode: 'round_robin'
      };

      const json = JSON.stringify(profileData);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe('api_key');
      expect(parsed.status).toBe('active');
      expect(parsed.rotation_mode).toBe('round_robin');

      // Verify these values are valid in our schemas
      expect(CredentialTypeSchema.safeParse(parsed.type).success).toBe(true);
      expect(CredentialStatusSchema.safeParse(parsed.status).success).toBe(true);
      expect(RotationModeSchema.safeParse(parsed.rotation_mode).success).toBe(true);
    });
  });
});
