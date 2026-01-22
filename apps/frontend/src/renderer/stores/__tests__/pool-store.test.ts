/**
 * Tests for pool store SYNC actions (CRUD)
 * @vitest-environment jsdom
 *
 * Note: Async operations (savePool, updatePoolAsync, deletePool)
 * are tested in integration tests with actual IPC handlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettingsStore } from '../settings-store';
import type { Pool } from '../../../shared/types/credential-profile';

describe('pool-store - SYNC CRUD operations', () => {
  beforeEach(() => {
    // Reset store state before each test
    useSettingsStore.getState().setPools([]);
  });

  describe('setPools', () => {
    it('should set pools in store', () => {
      const store = useSettingsStore.getState();
      const mockPools: Pool[] = [
        {
          id: 'pool-001',
          name: 'Test Pool',
          profile_ids: ['cred-001', 'cred-002'],
          limit: 10,
          rotation_config: {
            mode: 'round_robin',
            credential_pool: ['cred-001', 'cred-002'],
            rate_limit_threshold: 0.8,
            max_retries: 3,
            retry_delay_seconds: 1
          }
        }
      ];

      store.setPools(mockPools);

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.pools).toEqual(mockPools);
      expect(updatedStore.pools).toHaveLength(1);
    });
  });

  describe('addPool', () => {
    it('should add a pool to existing list', () => {
      const store = useSettingsStore.getState();

      const initialPools: Pool[] = [
        {
          id: 'pool-001',
          name: 'First Pool',
          profile_ids: ['cred-001'],
          limit: 10,
          rotation_config: {
            mode: 'manual',
            credential_pool: ['cred-001'],
            rate_limit_threshold: 0.8,
            max_retries: 3,
            retry_delay_seconds: 1
          }
        }
      ];
      store.setPools(initialPools);

      const newPool: Pool = {
        id: 'pool-002',
        name: 'Second Pool',
        profile_ids: ['cred-002', 'cred-003'],
        limit: 15,
        rotation_config: {
          mode: 'round_robin',
          credential_pool: ['cred-002', 'cred-003'],
          rate_limit_threshold: 0.8,
          max_retries: 3,
          retry_delay_seconds: 1
        }
      };
      store.addPool(newPool);

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.pools).toHaveLength(2);
      expect(updatedStore.pools[1]).toEqual(newPool);
    });
  });

  describe('updatePool', () => {
    it('should update existing pool by ID', () => {
      const store = useSettingsStore.getState();

      const initialPools: Pool[] = [
        {
          id: 'pool-001',
          name: 'Original Name',
          profile_ids: ['cred-001'],
          limit: 10,
          rotation_config: {
            mode: 'manual',
            credential_pool: ['cred-001'],
            rate_limit_threshold: 0.8,
            max_retries: 3,
            retry_delay_seconds: 1
          }
        }
      ];
      store.setPools(initialPools);

      const updatedPool: Pool = {
        id: 'pool-001',
        name: 'Updated Name',
        profile_ids: ['cred-001', 'cred-002'],
        limit: 20,
        rotation_config: {
          mode: 'round_robin',
          credential_pool: ['cred-001', 'cred-002'],
          rate_limit_threshold: 0.9,
          max_retries: 5,
          retry_delay_seconds: 2
        }
      };
      store.updatePool(updatedPool);

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.pools).toHaveLength(1);
      expect(updatedStore.pools[0].name).toBe('Updated Name');
      expect(updatedStore.pools[0].limit).toBe(20);
    });
  });

  describe('removePool', () => {
    it('should remove pool by ID', () => {
      const store = useSettingsStore.getState();

      const pool1: Pool = {
        id: 'pool-001',
        name: 'Pool 1',
        profile_ids: ['cred-001'],
        limit: 10,
        rotation_config: {
          mode: 'manual',
          credential_pool: ['cred-001'],
          rate_limit_threshold: 0.8,
          max_retries: 3,
          retry_delay_seconds: 1
        }
      };

      const pool2: Pool = {
        id: 'pool-002',
        name: 'Pool 2',
        profile_ids: ['cred-002'],
        limit: 15,
        rotation_config: {
          mode: 'round_robin',
          credential_pool: ['cred-002'],
          rate_limit_threshold: 0.8,
          max_retries: 3,
          retry_delay_seconds: 1
        }
      };

      store.setPools([pool1, pool2]);
      expect(useSettingsStore.getState().pools).toHaveLength(2);

      store.removePool('pool-001');

      const updatedStore = useSettingsStore.getState();
      expect(updatedStore.pools).toHaveLength(1);
      expect(updatedStore.pools[0].id).toBe('pool-002');
    });
  });

  describe('Loading and Error States', () => {
    it('should set loading state correctly', () => {
      const store = useSettingsStore.getState();

      expect(store.poolsLoading).toBe(false);

      store.setPoolsLoading(true);
      expect(useSettingsStore.getState().poolsLoading).toBe(true);

      store.setPoolsLoading(false);
      expect(useSettingsStore.getState().poolsLoading).toBe(false);
    });

    it('should set error state correctly', () => {
      const store = useSettingsStore.getState();

      expect(store.poolsError).toBe(null);

      store.setPoolsError('Test error');
      expect(useSettingsStore.getState().poolsError).toBe('Test error');

      store.setPoolsError(null);
      expect(useSettingsStore.getState().poolsError).toBe(null);
    });
  });
});
