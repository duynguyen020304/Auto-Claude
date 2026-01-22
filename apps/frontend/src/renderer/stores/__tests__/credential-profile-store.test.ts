/**
 * Tests for credential profile store SYNC actions (CRUD)
 * @vitest-environment jsdom
 *
 * Note: Async operations (saveCredentialProfile, updateCredentialProfileAsync, deleteCredentialProfile)
 * are tested in integration tests with actual IPC handlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettingsStore } from '../settings-store';
import type { CredentialProfile } from '../../../shared/types/credential-profile';

describe('credential-profile-store - SYNC CRUD operations', () => {
  beforeEach(() => {
    // Reset store state before each test
    useSettingsStore.getState().setCredentialProfiles([]);
  });

  describe('setCredentialProfiles', () => {
    it('should set credential profiles in store', () => {
      const store = useSettingsStore.getState();
      const mockProfiles: CredentialProfile[] = [
        {
          id: 'cred-001',
          type: 'api_key',
          name: 'Test API Profile',
          status: 'active',
          credential_value: 'sk-test-123',
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
        }
      ];

      store.setCredentialProfiles(mockProfiles);

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.credentialProfiles).toEqual(mockProfiles);
      expect(updatedStore.credentialProfiles).toHaveLength(1);
    });

    it('should replace existing profiles with new ones', () => {
      const store = useSettingsStore.getState();

      const initialProfiles: CredentialProfile[] = [
        {
          id: 'cred-001',
          type: 'api_key',
          name: 'Initial Profile',
          status: 'active',
          credential_value: 'sk-initial',
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
      store.setCredentialProfiles(initialProfiles);
      expect(useSettingsStore.getState().credentialProfiles).toHaveLength(1);

      const newProfiles: CredentialProfile[] = [
        {
          id: 'cred-002',
          type: 'oauth',
          name: 'OAuth Profile',
          status: 'active',
          credential_value: 'oauth-token',
          usage_metrics: {
            total_requests: 5,
            total_tokens: 1000,
            input_tokens: 500,
            output_tokens: 500,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            last_used: Date.now()
          },
          rate_limit_info: null,
          last_validated: Date.now(),
          created_at: Date.now(),
          metadata: null
        }
      ];
      store.setCredentialProfiles(newProfiles);

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.credentialProfiles).toEqual(newProfiles);
      expect(updatedStore.credentialProfiles).toHaveLength(1);
      expect(updatedStore.credentialProfiles[0].id).toBe('cred-002');
    });
  });

  describe('addCredentialProfile', () => {
    it('should add a profile to existing list', () => {
      const store = useSettingsStore.getState();

      const initialProfiles: CredentialProfile[] = [
        {
          id: 'cred-001',
          type: 'api_key',
          name: 'First Profile',
          status: 'active',
          credential_value: 'sk-first',
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
          metadata: { usage_limit: '50' }
        }
      ];
      store.setCredentialProfiles(initialProfiles);

      const newProfile: CredentialProfile = {
        id: 'cred-002',
        type: 'oauth',
        name: 'Second Profile',
        status: 'active',
        credential_value: 'oauth-second',
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
      };
      store.addCredentialProfile(newProfile);

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.credentialProfiles).toHaveLength(2);
      expect(updatedStore.credentialProfiles[1]).toEqual(newProfile);
    });

    it('should add profile to empty list', () => {
      const store = useSettingsStore.getState();

      const newProfile: CredentialProfile = {
        id: 'cred-001',
        type: 'api_key',
        name: 'First Profile',
        status: 'active',
        credential_value: 'sk-test',
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
      };
      store.addCredentialProfile(newProfile);

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.credentialProfiles).toHaveLength(1);
      expect(updatedStore.credentialProfiles[0]).toEqual(newProfile);
    });
  });

  describe('updateCredentialProfile', () => {
    it('should update existing profile by ID', () => {
      const store = useSettingsStore.getState();

      const initialProfiles: CredentialProfile[] = [
        {
          id: 'cred-001',
          type: 'api_key',
          name: 'Original Name',
          status: 'active',
          credential_value: 'sk-original',
          usage_metrics: {
            total_requests: 10,
            total_tokens: 500,
            input_tokens: 300,
            output_tokens: 200,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            last_used: Date.now()
          },
          rate_limit_info: null,
          last_validated: null,
          created_at: Date.now(),
          metadata: { usage_limit: '100' }
        }
      ];
      store.setCredentialProfiles(initialProfiles);

      const updatedProfile: CredentialProfile = {
        id: 'cred-001',
        type: 'api_key',
        name: 'Updated Name',
        status: 'active',
        credential_value: 'sk-updated',
        usage_metrics: {
          total_requests: 20,
          total_tokens: 1000,
          input_tokens: 600,
          output_tokens: 400,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          last_used: Date.now()
        },
        rate_limit_info: null,
        last_validated: Date.now(),
        created_at: initialProfiles[0].created_at,
        metadata: { usage_limit: '200' }
      };
      store.updateCredentialProfile(updatedProfile);

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.credentialProfiles).toHaveLength(1);
      expect(updatedStore.credentialProfiles[0].name).toBe('Updated Name');
      expect(updatedStore.credentialProfiles[0].credential_value).toBe('sk-updated');
      expect(updatedStore.credentialProfiles[0].metadata?.usage_limit).toBe('200');
    });

    it('should not update other profiles in list', () => {
      const store = useSettingsStore.getState();

      const profile1: CredentialProfile = {
        id: 'cred-001',
        type: 'api_key',
        name: 'Profile 1',
        status: 'active',
        credential_value: 'sk-1',
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
      };

      const profile2: CredentialProfile = {
        id: 'cred-002',
        type: 'oauth',
        name: 'Profile 2',
        status: 'active',
        credential_value: 'oauth-2',
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
      };

      store.setCredentialProfiles([profile1, profile2]);

      const updatedProfile1: CredentialProfile = {
        ...profile1,
        name: 'Updated Profile 1'
      };
      store.updateCredentialProfile(updatedProfile1);

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.credentialProfiles).toHaveLength(2);
      expect(updatedStore.credentialProfiles[0].name).toBe('Updated Profile 1');
      expect(updatedStore.credentialProfiles[1].name).toBe('Profile 2');
    });

    it('should handle update of non-existent profile gracefully', () => {
      const store = useSettingsStore.getState();

      const initialProfiles: CredentialProfile[] = [
        {
          id: 'cred-001',
          type: 'api_key',
          name: 'Profile 1',
          status: 'active',
          credential_value: 'sk-1',
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
        }
      ];
      store.setCredentialProfiles(initialProfiles);

      const nonExistentProfile: CredentialProfile = {
        id: 'cred-999',
        type: 'oauth',
        name: 'Non-existent',
        status: 'active',
        credential_value: 'oauth-999',
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
      };
      store.updateCredentialProfile(nonExistentProfile);

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.credentialProfiles).toHaveLength(1);
      expect(updatedStore.credentialProfiles[0].id).toBe('cred-001');
    });
  });

  describe('removeCredentialProfile', () => {
    it('should remove profile by ID', () => {
      const store = useSettingsStore.getState();

      const profile1: CredentialProfile = {
        id: 'cred-001',
        type: 'api_key',
        name: 'Profile 1',
        status: 'active',
        credential_value: 'sk-1',
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
      };

      const profile2: CredentialProfile = {
        id: 'cred-002',
        type: 'oauth',
        name: 'Profile 2',
        status: 'active',
        credential_value: 'oauth-2',
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
      };

      store.setCredentialProfiles([profile1, profile2]);
      expect(useSettingsStore.getState().credentialProfiles).toHaveLength(2);

      store.removeCredentialProfile('cred-001');

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.credentialProfiles).toHaveLength(1);
      expect(updatedStore.credentialProfiles[0].id).toBe('cred-002');
    });

    it('should handle removal of non-existent profile gracefully', () => {
      const store = useSettingsStore.getState();

      const profile: CredentialProfile = {
        id: 'cred-001',
        type: 'api_key',
        name: 'Profile 1',
        status: 'active',
        credential_value: 'sk-1',
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
      };

      store.setCredentialProfiles([profile]);
      expect(useSettingsStore.getState().credentialProfiles).toHaveLength(1);

      store.removeCredentialProfile('cred-999');

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.credentialProfiles).toHaveLength(1);
      expect(updatedStore.credentialProfiles[0].id).toBe('cred-001');
    });

    it('should handle removal from empty list', () => {
      const store = useSettingsStore.getState();

      store.setCredentialProfiles([]);
      expect(useSettingsStore.getState().credentialProfiles).toHaveLength(0);

      store.removeCredentialProfile('cred-001');

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.credentialProfiles).toHaveLength(0);
    });
  });

  describe('Loading and Error States', () => {
    it('should set loading state correctly', () => {
      const store = useSettingsStore.getState();

      expect(store.credentialProfilesLoading).toBe(false);

      store.setCredentialProfilesLoading(true);
      expect(useSettingsStore.getState().credentialProfilesLoading).toBe(true);

      store.setCredentialProfilesLoading(false);
      expect(useSettingsStore.getState().credentialProfilesLoading).toBe(false);
    });

    it('should set error state correctly', () => {
      const store = useSettingsStore.getState();

      expect(store.credentialProfilesError).toBe(null);

      store.setCredentialProfilesError('Test error');
      expect(useSettingsStore.getState().credentialProfilesError).toBe('Test error');

      store.setCredentialProfilesError(null);
      expect(useSettingsStore.getState().credentialProfilesError).toBe(null);
    });
  });
});
