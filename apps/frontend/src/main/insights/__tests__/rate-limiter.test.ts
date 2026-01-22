/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RollingWindowRateLimiter } from '../rate-limiter';

describe('RollingWindowRateLimiter', () => {
  let limiter: RollingWindowRateLimiter;

  beforeEach(() => {
    limiter = new RollingWindowRateLimiter();
  });

  describe('Basic Rate Limiting', () => {
    it('should allow sessions under the limit', () => {
      // Allow up to 5 sessions per 60 seconds
      expect(limiter.canStartSession('project-1', 5, 60000)).toBe(true);
      expect(limiter.canStartSession('project-1', 5, 60000)).toBe(true);
      expect(limiter.canStartSession('project-1', 5, 60000)).toBe(true);
    });

    it('should reject sessions when limit is exceeded', () => {
      const limit = 3;

      // Allow up to limit
      for (let i = 0; i < limit; i++) {
        expect(limiter.canStartSession('project-1', limit, 60000)).toBe(true);
      }

      // Next session should be rejected
      expect(limiter.canStartSession('project-1', limit, 60000)).toBe(false);
    });

    it('should track projects independently', () => {
      // project-1: limit 2
      expect(limiter.canStartSession('project-1', 2, 60000)).toBe(true);
      expect(limiter.canStartSession('project-1', 2, 60000)).toBe(true);
      expect(limiter.canStartSession('project-1', 2, 60000)).toBe(false);

      // project-2: should have its own independent limit
      expect(limiter.canStartSession('project-2', 2, 60000)).toBe(true);
      expect(limiter.canStartSession('project-2', 2, 60000)).toBe(true);
      expect(limiter.canStartSession('project-2', 2, 60000)).toBe(false);
    });

    it('should handle limit of 0', () => {
      expect(limiter.canStartSession('project-1', 0, 60000)).toBe(false);
    });

    it('should handle window of 0 (all timestamps are expired)', () => {
      // With 0ms window, all timestamps are immediately expired
      expect(limiter.canStartSession('project-1', 5, 0)).toBe(true);
      expect(limiter.canStartSession('project-1', 5, 0)).toBe(true);
      expect(limiter.canStartSession('project-1', 5, 0)).toBe(true);
      // All should be allowed because window is 0
    });
  });

  describe('Rolling Window Behavior', () => {
    it('should expire old timestamps outside the window', () => {
      vi.useFakeTimers();

      const windowMs = 10000; // 10 seconds
      const limit = 3;

      // Start 3 sessions (reaching limit)
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(false);

      // Advance time by window duration
      vi.advanceTimersByTime(windowMs);

      // Old timestamps should be expired, new session allowed
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);

      vi.useRealTimers();
    });

    it('should partially expire timestamps', () => {
      vi.useFakeTimers();

      const windowMs = 10000; // 10 seconds
      const limit = 5;

      // Start 3 sessions
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);

      // Advance time by half window
      vi.advanceTimersByTime(windowMs / 2);

      // Start 2 more sessions (total 5, reaching limit)
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(false);

      // Advance time by half window again (first 3 should be expired)
      vi.advanceTimersByTime(windowMs / 2);

      // Should allow new sessions now
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);

      vi.useRealTimers();
    });

    it('should maintain rolling window correctly over multiple cycles', () => {
      vi.useFakeTimers();

      const windowMs = 6000; // 6 seconds
      const limit = 2;

      // Cycle 1: Start 2 sessions
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(false);

      // Advance past window
      vi.advanceTimersByTime(windowMs);

      // Cycle 2: Should allow 2 more sessions
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(false);

      // Advance past window again
      vi.advanceTimersByTime(windowMs);

      // Cycle 3: Should allow 2 more sessions
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('Memory Leak Prevention', () => {
    it('should clean up old timestamps before checking limit', () => {
      vi.useFakeTimers();

      const windowMs = 5000; // 5 seconds
      const limit = 3;

      // Start 3 sessions (reaching limit)
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(false);

      // Verify we have 3 timestamps
      expect(limiter.getTimestamps('project-1')).toHaveLength(3);

      // Advance time past window
      vi.advanceTimersByTime(windowMs + 1000);

      // After window expires, old timestamps are cleaned up and new session is allowed
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);

      // Old timestamps should be cleaned up, only the new one remains
      const timestamps = limiter.getTimestamps('project-1');
      expect(timestamps).toHaveLength(1);

      vi.useRealTimers();
    });

    it('should not accumulate unbounded timestamps over time', () => {
      vi.useFakeTimers();

      const windowMs = 1000; // 1 second
      const limit = 10;

      // Start many sessions over time
      for (let cycle = 0; cycle < 5; cycle++) {
        // Fill the limit
        for (let i = 0; i < limit; i++) {
          limiter.canStartSession('project-1', limit, windowMs);
        }

        // Verify we don't exceed limit (old timestamps cleaned up)
        const timestamps = limiter.getTimestamps('project-1');
        expect(timestamps.length).toBeLessThanOrEqual(limit);

        // Advance past window
        vi.advanceTimersByTime(windowMs);
      }

      vi.useRealTimers();
    });

    it('should remove project from map when all timestamps expire', () => {
      vi.useFakeTimers();

      const windowMs = 2000; // 2 seconds

      limiter.canStartSession('project-1', 5, windowMs);
      expect(limiter.getProjectCount()).toBe(1);

      // Advance past window
      vi.advanceTimersByTime(windowMs + 1000);

      // Trigger cleanup by calling canStartSession
      // Since all timestamps are expired, it should allow the session and add new timestamp
      limiter.canStartSession('project-1', 5, windowMs);

      // Project should still be tracked (with the new timestamp)
      expect(limiter.getProjectCount()).toBe(1);
      expect(limiter.getTrackedProjects()).toContain('project-1');

      // Advance past window again
      vi.advanceTimersByTime(windowMs + 1000);

      // Now use cleanup method which removes project if all timestamps expire
      const removed = limiter.cleanup('project-1', windowMs);
      expect(removed).toBe(1); // Removed 1 timestamp
      expect(limiter.getProjectCount()).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('getUsage', () => {
    it('should return correct usage count within window', () => {
      const windowMs = 10000;

      limiter.canStartSession('project-1', 10, windowMs);
      limiter.canStartSession('project-1', 10, windowMs);
      limiter.canStartSession('project-1', 10, windowMs);

      expect(limiter.getUsage('project-1', windowMs)).toBe(3);
    });

    it('should not count expired timestamps', () => {
      vi.useFakeTimers();

      const windowMs = 5000;

      limiter.canStartSession('project-1', 10, windowMs);
      limiter.canStartSession('project-1', 10, windowMs);
      limiter.canStartSession('project-1', 10, windowMs);

      expect(limiter.getUsage('project-1', windowMs)).toBe(3);

      // Advance past window
      vi.advanceTimersByTime(windowMs + 1000);

      // Usage should be 0 (all expired)
      expect(limiter.getUsage('project-1', windowMs)).toBe(0);

      vi.useRealTimers();
    });

    it('should return 0 for non-existent project', () => {
      expect(limiter.getUsage('non-existent', 60000)).toBe(0);
    });

    it('should not modify internal state', () => {
      const windowMs = 10000;

      limiter.canStartSession('project-1', 5, windowMs);
      limiter.canStartSession('project-1', 5, windowMs);

      // Call getUsage multiple times
      expect(limiter.getUsage('project-1', windowMs)).toBe(2);
      expect(limiter.getUsage('project-1', windowMs)).toBe(2);
      expect(limiter.getUsage('project-1', windowMs)).toBe(2);

      // Should still be able to start 3 more sessions
      expect(limiter.canStartSession('project-1', 5, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', 5, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', 5, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', 5, windowMs)).toBe(false);
    });
  });

  describe('getTimestamps', () => {
    it('should return copy of timestamps array', () => {
      vi.useFakeTimers();

      const windowMs = 10000;

      limiter.canStartSession('project-1', 5, windowMs);
      vi.advanceTimersByTime(1); // Advance 1ms to ensure different timestamp
      limiter.canStartSession('project-1', 5, windowMs);

      const timestamps = limiter.getTimestamps('project-1');
      expect(timestamps).toHaveLength(2);
      expect(timestamps[0]).toBeGreaterThan(0);
      expect(timestamps[1]).toBeGreaterThan(timestamps[0]);

      vi.useRealTimers();
    });

    it('should return empty array for non-existent project', () => {
      const timestamps = limiter.getTimestamps('non-existent');
      expect(timestamps).toEqual([]);
    });

    it('should return copy, not reference to internal array', () => {
      const windowMs = 10000;

      limiter.canStartSession('project-1', 5, windowMs);

      const timestamps1 = limiter.getTimestamps('project-1');
      const timestamps2 = limiter.getTimestamps('project-1');

      // Should be different array instances
      expect(timestamps1).not.toBe(timestamps2);

      // Modifying the copy should not affect internal state
      timestamps1.push(999999);
      expect(limiter.getTimestamps('project-1')).not.toContain(999999);
    });
  });

  describe('clearProject', () => {
    it('should clear timestamps for specific project', () => {
      const windowMs = 10000;

      limiter.canStartSession('project-1', 5, windowMs);
      limiter.canStartSession('project-1', 5, windowMs);
      limiter.canStartSession('project-2', 5, windowMs);

      expect(limiter.getUsage('project-1', windowMs)).toBe(2);
      expect(limiter.getUsage('project-2', windowMs)).toBe(1);

      limiter.clearProject('project-1');

      expect(limiter.getUsage('project-1', windowMs)).toBe(0);
      expect(limiter.getUsage('project-2', windowMs)).toBe(1);
    });

    it('should allow sessions after clearing', () => {
      const windowMs = 10000;
      const limit = 2;

      // Fill limit
      limiter.canStartSession('project-1', limit, windowMs);
      limiter.canStartSession('project-1', limit, windowMs);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(false);

      // Clear and retry
      limiter.clearProject('project-1');
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
    });

    it('should handle clearing non-existent project', () => {
      expect(() => limiter.clearProject('non-existent')).not.toThrow();
    });
  });

  describe('clearAll', () => {
    it('should clear all timestamps for all projects', () => {
      const windowMs = 10000;

      limiter.canStartSession('project-1', 5, windowMs);
      limiter.canStartSession('project-2', 5, windowMs);
      limiter.canStartSession('project-3', 5, windowMs);

      expect(limiter.getProjectCount()).toBe(3);

      limiter.clearAll();

      expect(limiter.getProjectCount()).toBe(0);
      expect(limiter.getUsage('project-1', windowMs)).toBe(0);
      expect(limiter.getUsage('project-2', windowMs)).toBe(0);
      expect(limiter.getUsage('project-3', windowMs)).toBe(0);
    });

    it('should allow sessions after clearing all', () => {
      const windowMs = 10000;
      const limit = 2;

      // Fill limits for multiple projects
      limiter.canStartSession('project-1', limit, windowMs);
      limiter.canStartSession('project-1', limit, windowMs);
      limiter.canStartSession('project-2', limit, windowMs);
      limiter.canStartSession('project-2', limit, windowMs);

      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(false);
      expect(limiter.canStartSession('project-2', limit, windowMs)).toBe(false);

      // Clear all
      limiter.clearAll();

      // All should be allowed again
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      expect(limiter.canStartSession('project-2', limit, windowMs)).toBe(true);
    });
  });

  describe('getProjectCount', () => {
    it('should return 0 for new limiter', () => {
      expect(limiter.getProjectCount()).toBe(0);
    });

    it('should count unique projects', () => {
      limiter.canStartSession('project-1', 5, 10000);
      limiter.canStartSession('project-2', 5, 10000);
      limiter.canStartSession('project-3', 5, 10000);

      expect(limiter.getProjectCount()).toBe(3);
    });

    it('should not increment count for same project', () => {
      limiter.canStartSession('project-1', 5, 10000);
      limiter.canStartSession('project-1', 5, 10000);
      limiter.canStartSession('project-1', 5, 10000);

      expect(limiter.getProjectCount()).toBe(1);
    });

    it('should decrement count when project is cleared', () => {
      limiter.canStartSession('project-1', 5, 10000);
      limiter.canStartSession('project-2', 5, 10000);

      expect(limiter.getProjectCount()).toBe(2);

      limiter.clearProject('project-1');

      expect(limiter.getProjectCount()).toBe(1);
    });
  });

  describe('getTrackedProjects', () => {
    it('should return empty array for new limiter', () => {
      expect(limiter.getTrackedProjects()).toEqual([]);
    });

    it('should return all tracked project IDs', () => {
      limiter.canStartSession('project-1', 5, 10000);
      limiter.canStartSession('project-2', 5, 10000);
      limiter.canStartSession('project-3', 5, 10000);

      const projects = limiter.getTrackedProjects();
      expect(projects).toHaveLength(3);
      expect(projects).toContain('project-1');
      expect(projects).toContain('project-2');
      expect(projects).toContain('project-3');
    });

    it('should return copy, not reference to internal keys', () => {
      limiter.canStartSession('project-1', 5, 10000);

      const projects1 = limiter.getTrackedProjects();
      const projects2 = limiter.getTrackedProjects();

      expect(projects1).not.toBe(projects2);
    });
  });

  describe('cleanup', () => {
    it('should remove old timestamps for specific project', () => {
      vi.useFakeTimers();

      const windowMs = 5000;

      limiter.canStartSession('project-1', 10, windowMs);
      limiter.canStartSession('project-1', 10, windowMs);
      limiter.canStartSession('project-1', 10, windowMs);

      expect(limiter.getTimestamps('project-1')).toHaveLength(3);

      // Advance time
      vi.advanceTimersByTime(windowMs + 1000);

      // Manual cleanup
      const removed = limiter.cleanup('project-1', windowMs);

      expect(removed).toBe(3);
      expect(limiter.getTimestamps('project-1')).toHaveLength(0);

      vi.useRealTimers();
    });

    it('should return 0 for non-existent project', () => {
      const removed = limiter.cleanup('non-existent', 60000);
      expect(removed).toBe(0);
    });

    it('should partially remove timestamps', () => {
      vi.useFakeTimers();

      const windowMs = 10000;

      limiter.canStartSession('project-1', 10, windowMs);
      limiter.canStartSession('project-1', 10, windowMs);

      // Advance half window
      vi.advanceTimersByTime(windowMs / 2);

      limiter.canStartSession('project-1', 10, windowMs);

      expect(limiter.getTimestamps('project-1')).toHaveLength(3);

      // Advance past window for first 2 timestamps but not the third
      vi.advanceTimersByTime(windowMs / 2);

      // Cleanup should remove first 2 timestamps (now expired), third remains
      const removed = limiter.cleanup('project-1', windowMs);

      expect(removed).toBe(2);
      expect(limiter.getTimestamps('project-1')).toHaveLength(1);

      vi.useRealTimers();
    });

    it('should remove project when all timestamps expired', () => {
      vi.useFakeTimers();

      const windowMs = 3000;

      limiter.canStartSession('project-1', 10, windowMs);

      expect(limiter.getProjectCount()).toBe(1);

      // Advance past window
      vi.advanceTimersByTime(windowMs + 1000);

      limiter.cleanup('project-1', windowMs);

      expect(limiter.getProjectCount()).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('cleanupAll', () => {
    it('should clean up all projects', () => {
      vi.useFakeTimers();

      const windowMs = 5000;

      limiter.canStartSession('project-1', 10, windowMs);
      limiter.canStartSession('project-1', 10, windowMs);
      limiter.canStartSession('project-2', 10, windowMs);
      limiter.canStartSession('project-3', 10, windowMs);

      expect(limiter.getProjectCount()).toBe(3);

      // Advance time
      vi.advanceTimersByTime(windowMs + 1000);

      // Cleanup all
      const totalRemoved = limiter.cleanupAll(windowMs);

      expect(totalRemoved).toBe(4);
      expect(limiter.getProjectCount()).toBe(0);

      vi.useRealTimers();
    });

    it('should handle empty limiter', () => {
      const removed = limiter.cleanupAll(60000);
      expect(removed).toBe(0);
    });

    it('should handle mix of expired and valid timestamps', () => {
      vi.useFakeTimers();

      const windowMs = 10000;

      // project-1: Create session that will expire
      limiter.canStartSession('project-1', 10, windowMs);

      // Advance past window for project-1
      vi.advanceTimersByTime(windowMs + 1000);

      // project-2: Create fresh session (valid)
      limiter.canStartSession('project-2', 10, windowMs);

      // project-3: Create first session
      limiter.canStartSession('project-3', 10, windowMs);

      // Advance half window
      vi.advanceTimersByTime(windowMs / 2);

      // project-3: Create second session (more recent)
      limiter.canStartSession('project-3', 10, windowMs);

      // Now advance so project-3's first session is expired but second is not
      vi.advanceTimersByTime(windowMs / 2 + 1000);

      const totalRemoved = limiter.cleanupAll(windowMs);

      // At least project-1 should be removed, possibly project-3's first session too
      expect(totalRemoved).toBeGreaterThanOrEqual(1);

      // At least project-2 should remain, possibly project-3 too
      expect(limiter.getProjectCount()).toBeGreaterThanOrEqual(1);

      vi.useRealTimers();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid successive calls correctly', () => {
      const limit = 5;
      const windowMs = 10000;

      // Rapid calls (same millisecond)
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(limiter.canStartSession('project-1', limit, windowMs));
      }

      // First 5 should be allowed, next 5 rejected
      expect(results.filter(r => r).length).toBe(limit);
      expect(results.filter(r => !r).length).toBe(5);
    });

    it('should handle very large window durations', () => {
      const largeWindow = 365 * 24 * 60 * 60 * 1000; // 1 year

      expect(limiter.canStartSession('project-1', 10, largeWindow)).toBe(true);
      expect(limiter.getUsage('project-1', largeWindow)).toBe(1);
    });

    it('should handle very small window durations', () => {
      const smallWindow = 1; // 1ms

      expect(limiter.canStartSession('project-1', 10, smallWindow)).toBe(true);
      expect(limiter.getUsage('project-1', smallWindow)).toBeGreaterThanOrEqual(0);
    });

    it('should handle special characters in project IDs', () => {
      const specialIds = [
        'project-with-dashes',
        'project_with_underscores',
        'project.with.dots',
        'project/with/slashes',
        'project:with:colons',
        'project with spaces'
      ];

      specialIds.forEach(id => {
        expect(limiter.canStartSession(id, 5, 10000)).toBe(true);
      });

      expect(limiter.getProjectCount()).toBe(specialIds.length);
    });

    it('should maintain correct state after many operations', () => {
      const limit = 100;
      const windowMs = 60000;

      // Start many sessions
      for (let i = 0; i < limit; i++) {
        expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
      }

      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(false);
      expect(limiter.getUsage('project-1', windowMs)).toBe(limit);

      // Clear and verify
      limiter.clearProject('project-1');

      expect(limiter.getUsage('project-1', windowMs)).toBe(0);
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle burst traffic correctly', () => {
      vi.useFakeTimers();

      const limit = 10;
      const windowMs = 60000; // 1 minute

      // Burst of 20 requests
      let accepted = 0;
      let rejected = 0;

      for (let i = 0; i < 20; i++) {
        if (limiter.canStartSession('project-1', limit, windowMs)) {
          accepted++;
        } else {
          rejected++;
        }
      }

      expect(accepted).toBe(limit);
      expect(rejected).toBe(10);

      vi.useRealTimers();
    });

    it('should allow gradual recovery after burst', () => {
      vi.useFakeTimers();

      const limit = 5;
      const windowMs = 10000; // 10 seconds

      // Fill limit
      for (let i = 0; i < limit; i++) {
        limiter.canStartSession('project-1', limit, windowMs);
      }

      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(false);

      // Advance 2 seconds (1/5 of window)
      vi.advanceTimersByTime(2000);

      // Should still be rejected (all 5 timestamps still within window)
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(false);

      // Advance 5 more seconds (total 7 seconds, more than half window)
      vi.advanceTimersByTime(5000);

      // Now some timestamps should have expired (those from the first ~7 seconds)
      // With 5 timestamps all at roughly the same time, none should be expired yet
      // We need to advance more time
      vi.advanceTimersByTime(4000); // Total 11 seconds, past the window

      // Now at least some timestamps should be expired
      expect(limiter.canStartSession('project-1', limit, windowMs)).toBe(true);

      vi.useRealTimers();
    });

    it('should handle multiple projects with different limits', () => {
      const windowMs = 60000;

      // project-1: strict limit (2 per minute)
      limiter.canStartSession('project-1', 2, windowMs);
      limiter.canStartSession('project-1', 2, windowMs);
      expect(limiter.canStartSession('project-1', 2, windowMs)).toBe(false);

      // project-2: lenient limit (100 per minute)
      for (let i = 0; i < 50; i++) {
        expect(limiter.canStartSession('project-2', 100, windowMs)).toBe(true);
      }
    });
  });
});
