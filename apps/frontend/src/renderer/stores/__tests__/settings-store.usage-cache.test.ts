/**
 * Tests for usage cache TTL expiration in settings store
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSettingsStore } from '../settings-store';
import type { ClaudeUsageSnapshot } from '../../../shared/types/agent';

describe('settings-store - Usage Cache TTL', () => {
  // Mock usage snapshot for testing
  const createMockSnapshot = (profileId: string, profileName: string): ClaudeUsageSnapshot => ({
    profileId,
    profileName,
    profileEmail: `${profileName.toLowerCase()}@example.com`,
    sessionPercent: 45,
    weeklyPercent: 72,
    sessionResetTime: 'Resets in 2 hours',
    weeklyResetTime: 'Jan 1 at midnight',
    sessionResetTimestamp: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    weeklyResetTimestamp: new Date('2025-01-01T00:00:00Z').toISOString(),
    fetchedAt: new Date(),
    limitType: 'session',
    usageWindows: {
      sessionWindowLabel: '5-hour window',
      weeklyWindowLabel: '7-day'
    },
    sessionUsageValue: 45000,
    sessionUsageLimit: 100000,
    weeklyUsageValue: 72,
    weeklyUsageLimit: 100
  });

  beforeEach(() => {
    // Reset store state before each test
    useSettingsStore.getState().invalidateUsageCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setCachedUsage', () => {
    it('should store usage data with timestamp', () => {
      const store = useSettingsStore.getState();
      const mockSnapshot = createMockSnapshot('profile-1', 'Test Profile');

      store.setCachedUsage('profile-1', mockSnapshot);

      const cached = useSettingsStore.getState().cachedUsage.get('profile-1');
      expect(cached).toBeDefined();
      expect(cached?.data).toEqual(mockSnapshot);
      expect(cached?.fetchedAt).toBeDefined();
      expect(cached?.fetchedAt).toBeLessThanOrEqual(Date.now());
      expect(cached?.fetchedAt).toBeGreaterThan(Date.now() - 1000); // Within last second
    });

    it('should store separate cache entries for different profiles', () => {
      const store = useSettingsStore.getState();
      const snapshot1 = createMockSnapshot('profile-1', 'Profile One');
      const snapshot2 = createMockSnapshot('profile-2', 'Profile Two');

      store.setCachedUsage('profile-1', snapshot1);
      store.setCachedUsage('profile-2', snapshot2);

      const cache = useSettingsStore.getState().cachedUsage;
      expect(cache.size).toBe(2);
      expect(cache.get('profile-1')?.data.profileName).toBe('Profile One');
      expect(cache.get('profile-2')?.data.profileName).toBe('Profile Two');
    });

    it('should overwrite existing cache entry for same profile', () => {
      const store = useSettingsStore.getState();
      const snapshot1 = createMockSnapshot('profile-1', 'Original Name');
      const snapshot2 = createMockSnapshot('profile-1', 'Updated Name');

      store.setCachedUsage('profile-1', snapshot1);

      // Overwrite with new data
      store.setCachedUsage('profile-1', snapshot2);

      const cached = useSettingsStore.getState().cachedUsage.get('profile-1');
      expect(cached?.data.profileName).toBe('Updated Name');
      expect(useSettingsStore.getState().cachedUsage.size).toBe(1);
    });
  });

  describe('getCachedUsage', () => {
    it('should return cached data if not expired', () => {
      const store = useSettingsStore.getState();
      const mockSnapshot = createMockSnapshot('profile-1', 'Test Profile');

      store.setCachedUsage('profile-1', mockSnapshot);

      const retrieved = store.getCachedUsage('profile-1');
      expect(retrieved).toEqual(mockSnapshot);
    });

    it('should return null for non-existent profile', () => {
      const store = useSettingsStore.getState();

      const retrieved = store.getCachedUsage('non-existent-profile');
      expect(retrieved).toBeNull();
    });

    it('should return null for empty cache', () => {
      const store = useSettingsStore.getState();

      const retrieved = store.getCachedUsage('any-profile');
      expect(retrieved).toBeNull();
    });
  });

  describe('TTL Expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return cached data before TTL expires', () => {
      const store = useSettingsStore.getState();
      const mockSnapshot = createMockSnapshot('profile-1', 'Test Profile');

      store.setCachedUsage('profile-1', mockSnapshot);

      // Advance time by 5 minutes (less than 10 minute TTL)
      vi.advanceTimersByTime(5 * 60 * 1000);

      const retrieved = store.getCachedUsage('profile-1');
      expect(retrieved).toEqual(mockSnapshot);
    });

    it('should return null after TTL expires', () => {
      const store = useSettingsStore.getState();
      const mockSnapshot = createMockSnapshot('profile-1', 'Test Profile');

      store.setCachedUsage('profile-1', mockSnapshot);

      // Advance time by 10 minutes + 1 second (past TTL)
      vi.advanceTimersByTime(10 * 60 * 1000 + 1000);

      const retrieved = store.getCachedUsage('profile-1');
      expect(retrieved).toBeNull();
    });

    it('should return cached data exactly at TTL boundary (before expiration)', () => {
      const store = useSettingsStore.getState();
      const mockSnapshot = createMockSnapshot('profile-1', 'Test Profile');

      store.setCachedUsage('profile-1', mockSnapshot);

      // Advance time exactly to TTL (10 minutes)
      // Cache uses > for comparison, so it should still be valid
      vi.advanceTimersByTime(10 * 60 * 1000);

      const retrieved = store.getCachedUsage('profile-1');
      expect(retrieved).toEqual(mockSnapshot);
    });

    it('should handle multiple profiles with different expiration times', () => {
      const store = useSettingsStore.getState();
      const snapshot1 = createMockSnapshot('profile-1', 'Profile One');
      const snapshot2 = createMockSnapshot('profile-2', 'Profile Two');

      // Cache first profile
      store.setCachedUsage('profile-1', snapshot1);

      // Advance time by 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);

      // Cache second profile
      store.setCachedUsage('profile-2', snapshot2);

      // Advance another 6 minutes (total 11 minutes from first cache)
      vi.advanceTimersByTime(6 * 60 * 1000);

      // First profile should be expired (11 > 10 minutes)
      const retrieved1 = store.getCachedUsage('profile-1');
      expect(retrieved1).toBeNull();

      // Second profile should still be valid (6 < 10 minutes)
      const retrieved2 = store.getCachedUsage('profile-2');
      expect(retrieved2).toEqual(snapshot2);
    });
  });

  describe('invalidateUsageCache', () => {
    it('should invalidate specific profile cache', () => {
      const store = useSettingsStore.getState();
      const snapshot1 = createMockSnapshot('profile-1', 'Profile One');
      const snapshot2 = createMockSnapshot('profile-2', 'Profile Two');

      store.setCachedUsage('profile-1', snapshot1);
      store.setCachedUsage('profile-2', snapshot2);

      expect(useSettingsStore.getState().cachedUsage.size).toBe(2);

      store.invalidateUsageCache('profile-1');

      const cache = useSettingsStore.getState().cachedUsage;
      expect(cache.size).toBe(1);
      expect(cache.get('profile-1')).toBeUndefined();
      expect(cache.get('profile-2')).toBeDefined();
    });

    it('should invalidate entire cache when no profileId provided', () => {
      const store = useSettingsStore.getState();
      const snapshot1 = createMockSnapshot('profile-1', 'Profile One');
      const snapshot2 = createMockSnapshot('profile-2', 'Profile Two');

      store.setCachedUsage('profile-1', snapshot1);
      store.setCachedUsage('profile-2', snapshot2);

      expect(useSettingsStore.getState().cachedUsage.size).toBe(2);

      store.invalidateUsageCache();

      const cache = useSettingsStore.getState().cachedUsage;
      expect(cache.size).toBe(0);
    });

    it('should handle invalidating non-existent profile gracefully', () => {
      const store = useSettingsStore.getState();
      const snapshot = createMockSnapshot('profile-1', 'Profile One');

      store.setCachedUsage('profile-1', snapshot);

      expect(useSettingsStore.getState().cachedUsage.size).toBe(1);

      // Try to invalidate non-existent profile
      store.invalidateUsageCache('non-existent-profile');

      // Original cache should remain intact
      const cache = useSettingsStore.getState().cachedUsage;
      expect(cache.size).toBe(1);
      expect(cache.get('profile-1')).toBeDefined();
    });

    it('should handle invalidating empty cache gracefully', () => {
      const store = useSettingsStore.getState();

      expect(useSettingsStore.getState().cachedUsage.size).toBe(0);

      // Should not throw error
      store.invalidateUsageCache();
      store.invalidateUsageCache('profile-1');

      expect(useSettingsStore.getState().cachedUsage.size).toBe(0);
    });
  });

  describe('Cache Hit/Miss Behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return fresh data after cache expiration and refresh', () => {
      const store = useSettingsStore.getState();
      const originalSnapshot = createMockSnapshot('profile-1', 'Test Profile');
      const updatedSnapshot = createMockSnapshot('profile-1', 'Test Profile');
      updatedSnapshot.sessionPercent = 85; // Updated value

      // Initial cache
      store.setCachedUsage('profile-1', originalSnapshot);
      expect(store.getCachedUsage('profile-1')).toEqual(originalSnapshot);

      // Advance past TTL
      vi.advanceTimersByTime(11 * 60 * 1000);

      // Cache should be expired
      expect(store.getCachedUsage('profile-1')).toBeNull();

      // Refresh with new data
      store.setCachedUsage('profile-1', updatedSnapshot);

      // Should return fresh data
      const retrieved = store.getCachedUsage('profile-1');
      expect(retrieved).toEqual(updatedSnapshot);
      expect(retrieved?.sessionPercent).toBe(85);
    });

    it('should not interfere with other profiles when one expires', () => {
      const store = useSettingsStore.getState();
      const snapshot1 = createMockSnapshot('profile-1', 'Profile One');
      const snapshot2 = createMockSnapshot('profile-2', 'Profile Two');

      store.setCachedUsage('profile-1', snapshot1);
      store.setCachedUsage('profile-2', snapshot2);

      // Advance past TTL
      vi.advanceTimersByTime(11 * 60 * 1000);

      // Both should be expired
      expect(store.getCachedUsage('profile-1')).toBeNull();
      expect(store.getCachedUsage('profile-2')).toBeNull();

      // Refresh only profile-2
      store.setCachedUsage('profile-2', snapshot2);

      // Profile-1 should still be null
      expect(store.getCachedUsage('profile-1')).toBeNull();

      // Profile-2 should have fresh data
      expect(store.getCachedUsage('profile-2')).toEqual(snapshot2);
    });
  });

  describe('Cache State Persistence', () => {
    it('should maintain cache across multiple operations', () => {
      const store = useSettingsStore.getState();
      const snapshot1 = createMockSnapshot('profile-1', 'Profile One');
      const snapshot2 = createMockSnapshot('profile-2', 'Profile Two');
      const snapshot3 = createMockSnapshot('profile-3', 'Profile Three');

      // Add multiple profiles
      store.setCachedUsage('profile-1', snapshot1);
      store.setCachedUsage('profile-2', snapshot2);
      store.setCachedUsage('profile-3', snapshot3);

      expect(useSettingsStore.getState().cachedUsage.size).toBe(3);

      // Retrieve all profiles
      expect(store.getCachedUsage('profile-1')).toEqual(snapshot1);
      expect(store.getCachedUsage('profile-2')).toEqual(snapshot2);
      expect(store.getCachedUsage('profile-3')).toEqual(snapshot3);

      // Remove one profile
      store.invalidateUsageCache('profile-2');

      // Others should remain
      expect(store.getCachedUsage('profile-1')).toEqual(snapshot1);
      expect(store.getCachedUsage('profile-2')).toBeNull();
      expect(store.getCachedUsage('profile-3')).toEqual(snapshot3);
    });

    it('should handle rapid updates to same profile', () => {
      const store = useSettingsStore.getState();
      const snapshot1 = createMockSnapshot('profile-1', 'Version 1');
      const snapshot2 = createMockSnapshot('profile-1', 'Version 2');
      const snapshot3 = createMockSnapshot('profile-1', 'Version 3');

      // Rapid updates
      store.setCachedUsage('profile-1', snapshot1);
      store.setCachedUsage('profile-1', snapshot2);
      store.setCachedUsage('profile-1', snapshot3);

      // Should have latest version
      const retrieved = store.getCachedUsage('profile-1');
      expect(retrieved?.profileName).toBe('Version 3');
      expect(useSettingsStore.getState().cachedUsage.size).toBe(1);
    });
  });
});
