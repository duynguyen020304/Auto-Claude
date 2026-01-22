/**
 * @vitest-environment jsdom
 */
/**
 * Tests for TaskProfileSelector component
 * Tests mutual exclusivity between API profile and pool selection (XOR logic)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TaskProfileSelector } from '../credential-profiles/TaskProfileSelector';
import type { CredentialProfile, Pool } from '@shared/types/credential-profile';

// Mock the settings-store
const mockCredentialProfiles: CredentialProfile[] = [
  {
    id: 'cred-api-001',
    type: 'api_key',
    name: 'API Profile 1',
    status: 'active',
    credential_value: 'sk-test-1',
    usage_metrics: {
      total_requests: 0,
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      last_used: null
    },
    rate_limit_info: null,
    last_validated: null,
    created_at: Date.now(),
    metadata: { usage_limit: '100' }
  },
  {
    id: 'cred-api-002',
    type: 'api_key',
    name: 'API Profile 2',
    status: 'active',
    credential_value: 'sk-test-2',
    usage_metrics: {
      total_requests: 0,
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      last_used: null
    },
    rate_limit_info: null,
    last_validated: null,
    created_at: Date.now(),
    metadata: { usage_limit: '200' }
  },
  {
    id: 'cred-oauth-001',
    type: 'oauth',
    name: 'OAuth Profile',
    status: 'active',
    credential_value: 'oauth-token',
    usage_metrics: {
      total_requests: 0,
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      last_used: null
    },
    rate_limit_info: null,
    last_validated: null,
    created_at: Date.now(),
    metadata: null
  }
];

const mockPools: Pool[] = [
  {
    id: 'pool-001',
    name: 'Pool 1',
    profile_ids: ['cred-api-001', 'cred-oauth-001'],
    limit: 10,
    rotation_config: {
      mode: 'round_robin',
      credential_pool: ['cred-api-001', 'cred-oauth-001'],
      rate_limit_threshold: 0.8,
      max_retries: 3,
      retry_delay_seconds: 1
    }
  },
  {
    id: 'pool-002',
    name: 'Pool 2',
    profile_ids: ['cred-api-002'],
    limit: 20,
    rotation_config: {
      mode: 'usage_based',
      credential_pool: ['cred-api-002'],
      rate_limit_threshold: 0.7,
      max_retries: 5,
      retry_delay_seconds: 2
    }
  }
];

vi.mock('../../stores/settings-store', () => ({
  useSettingsStore: vi.fn(() => ({
    credentialProfiles: mockCredentialProfiles,
    pools: mockPools
  }))
}));

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string) => key
  }))
}));

describe('TaskProfileSelector - Mutual Exclusivity Validation', () => {
  const mockOnProfileChange = vi.fn();
  const mockOnPoolChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should render both selectors enabled initially', () => {
      render(
        <TaskProfileSelector
          profileId=""
          poolId=""
          onProfileChange={mockOnProfileChange}
          onPoolChange={mockOnPoolChange}
        />
      );

      // Both selectors should be present
      expect(screen.getByText('tasks:taskProfile.apiProfile.label')).toBeInTheDocument();
      expect(screen.getByText('tasks:taskProfile.pool.label')).toBeInTheDocument();
    });

    it('should display empty states when no selections made', () => {
      render(
        <TaskProfileSelector
          profileId=""
          poolId=""
          onProfileChange={mockOnProfileChange}
          onPoolChange={mockOnPoolChange}
        />
      );

      // Check that placeholder text is visible
      expect(screen.getByText('tasks:taskProfile.apiProfile.placeholder')).toBeInTheDocument();
      expect(screen.getByText('tasks:taskProfile.pool.placeholder')).toBeInTheDocument();
    });
  });

  describe('Mutual Exclusivity - API Profile Disables Pool', () => {
    it('should disable pool selector when API profile is selected', () => {
      render(
        <TaskProfileSelector
          profileId="cred-api-001"
          poolId=""
          onProfileChange={mockOnProfileChange}
          onPoolChange={mockOnPoolChange}
        />
      );

      // Pool selector should be disabled when API profile is selected
      const poolSelect = screen.getByLabelText('tasks:taskProfile.pool.label');
      expect(poolSelect).toBeDisabled();

      // Should show helper message explaining why pool is disabled
      expect(screen.getByText('tasks:taskProfile.pool.disabledBecauseProfile')).toBeInTheDocument();
    });
  });

  describe('Mutual Exclusivity - Pool Disables API Profile', () => {
    it('should disable API profile selector when pool is selected', () => {
      render(
        <TaskProfileSelector
          profileId=""
          poolId="pool-001"
          onProfileChange={mockOnProfileChange}
          onPoolChange={mockOnPoolChange}
        />
      );

      // API profile selector should be disabled when pool is selected
      const apiProfileSelect = screen.getByLabelText('tasks:taskProfile.apiProfile.label');
      expect(apiProfileSelect).toBeDisabled();

      // Should show helper message explaining why API profile is disabled
      expect(screen.getByText('tasks:taskProfile.apiProfile.disabledBecausePool')).toBeInTheDocument();
    });
  });

  describe('Defensive Validation - Both Selected', () => {
    it('should show validation error when both are somehow selected', () => {
      // This is a defensive programming scenario - should not happen in normal use
      // because the mutual exclusivity logic prevents it, but we handle it anyway
      render(
        <TaskProfileSelector
          profileId="cred-api-001"
          poolId="pool-001"
          onProfileChange={mockOnProfileChange}
          onPoolChange={mockOnPoolChange}
        />
      );

      // Should show validation error
      expect(screen.getByText('tasks:taskProfile.validation.bothSelected')).toBeInTheDocument();
    });
  });

  describe('Disabled Component', () => {
    it('should disable both selectors when disabled prop is true', () => {
      render(
        <TaskProfileSelector
          profileId=""
          poolId=""
          onProfileChange={mockOnProfileChange}
          onPoolChange={mockOnPoolChange}
          disabled={true}
        />
      );

      const apiProfileSelect = screen.getByLabelText('tasks:taskProfile.apiProfile.label');
      const poolSelect = screen.getByLabelText('tasks:taskProfile.pool.label');

      expect(apiProfileSelect).toBeDisabled();
      expect(poolSelect).toBeDisabled();
    });
  });

  describe('XOR Logic Verification', () => {
    it('should enforce XOR: not (profile AND pool)', () => {
      const { rerender } = render(
        <TaskProfileSelector
          profileId="cred-api-001"
          poolId=""
          onProfileChange={mockOnProfileChange}
          onPoolChange={mockOnPoolChange}
        />
      );

      // State 1: profile selected, pool not selected (valid XOR)
      expect(screen.getByText('API Profile 1')).toBeInTheDocument();
      expect(screen.getByText('tasks:taskProfile.pool.disabledBecauseProfile')).toBeInTheDocument();
      expect(screen.getByLabelText('tasks:taskProfile.pool.label')).toBeDisabled();

      // Rerender with opposite state
      rerender(
        <TaskProfileSelector
          profileId=""
          poolId="pool-001"
          onProfileChange={mockOnProfileChange}
          onPoolChange={mockOnPoolChange}
        />
      );

      // State 2: profile not selected, pool selected (valid XOR)
      expect(screen.getByText('Pool 1')).toBeInTheDocument();
      expect(screen.getByText('tasks:taskProfile.apiProfile.disabledBecausePool')).toBeInTheDocument();
      expect(screen.getByLabelText('tasks:taskProfile.apiProfile.label')).toBeDisabled();

      // Rerender with both not selected (valid XOR - both false)
      rerender(
        <TaskProfileSelector
          profileId=""
          poolId=""
          onProfileChange={mockOnProfileChange}
          onPoolChange={mockOnPoolChange}
        />
      );

      // State 3: neither selected (valid XOR - both false)
      expect(screen.getByText('tasks:taskProfile.apiProfile.placeholder')).toBeInTheDocument();
      expect(screen.getByText('tasks:taskProfile.pool.placeholder')).toBeInTheDocument();
    });
  });
});
