/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InsightsExecutor } from '../insights-executor';
import { InsightsConfig } from '../config';
import { SessionQueue, SessionPriority } from '../session-queue';
import { spawn } from 'child_process';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn()
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn()
}));

describe('InsightsExecutor Rate Limiting', () => {
  let executor: InsightsExecutor;
  let config: InsightsConfig;
  let sessionQueue: SessionQueue;
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock process
    mockProcess = {
      stdout: {
        on: vi.fn()
      },
      stderr: {
        on: vi.fn()
      },
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          // Simulate immediate close for testing
          setTimeout(() => callback(0), 0);
        }
      })
    };

    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    config = new InsightsConfig();
    config.configure(
      '/path/to/python',
      '/path/to/auto-claude'
    );

    sessionQueue = new SessionQueue({
      maxConcurrentSessions: 5,
      maxSessionsPerProject: 3
    });

    // Create executor with custom rate limit: 3 sessions per 10 seconds
    executor = new InsightsExecutor(config, sessionQueue, {
      limit: 3,
      windowMs: 10000
    });
  });

  describe('Basic Rate Limiting', () => {
    it('should allow sessions under the rate limit', async () => {
      const projectId = 'test-project-1';

      // First 3 sessions should be allowed
      for (let i = 0; i < 3; i++) {
        const executePromise = executor.execute(
          `session-${i}`,
          projectId,
          '/path/to/project',
          'test message',
          []
        );

        // Wait a bit for the spawn to complete
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Verify spawn was called 3 times
      expect(spawn).toHaveBeenCalledTimes(3);
    });

    it('should block sessions when rate limit is exceeded', async () => {
      const projectId = 'test-project-2';

      // Start 3 sessions (reaching limit)
      for (let i = 0; i < 3; i++) {
        const executePromise = executor.execute(
          `session-${i}`,
          projectId,
          '/path/to/project',
          'test message',
          []
        );

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // 4th session should be blocked
      await expect(executor.execute(
        'session-3',
        projectId,
        '/path/to/project',
        'test message',
        []
      )).rejects.toThrow(/Rate limit exceeded/);
    });

    it('should provide detailed error message when rate limit exceeded', async () => {
      const projectId = 'test-project-3';

      // Fill rate limit
      for (let i = 0; i < 3; i++) {
        await executor.execute(
          `session-${i}`,
          projectId,
          '/path/to/project',
          'test message',
          []
        );

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Verify error message contains usage information
      await expect(executor.execute(
        'session-3',
        projectId,
        '/path/to/project',
        'test message',
        []
      )).rejects.toThrow('3/3 sessions per 10s');
    });

    it('should track projects independently', async () => {
      // Fill rate limit for project-1
      for (let i = 0; i < 3; i++) {
        await executor.execute(
          `session-p1-${i}`,
          'project-1',
          '/path/to/project',
          'test message',
          []
        );

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // project-1 should be blocked
      await expect(executor.execute(
        'session-p1-3',
        'project-1',
        '/path/to/project',
        'test message',
        []
      )).rejects.toThrow(/Rate limit exceeded/);

      // project-2 should still be allowed
      await executor.execute(
        'session-p2-1',
        'project-2',
        '/path/to/project',
        'test message',
        []
      );

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(spawn).toHaveBeenCalledTimes(4); // 3 for project-1, 1 for project-2
    });
  });

  describe('Rate Limit Configuration', () => {
    it('should use default rate limit when not specified', () => {
      const defaultExecutor = new InsightsExecutor(config, sessionQueue);
      const rateLimitConfig = defaultExecutor.getRateLimitConfig();

      expect(rateLimitConfig.limit).toBe(10);
      expect(rateLimitConfig.windowMs).toBe(60000);
    });

    it('should allow custom rate limit configuration', () => {
      const customExecutor = new InsightsExecutor(config, sessionQueue, {
        limit: 5,
        windowMs: 30000
      });

      const rateLimitConfig = customExecutor.getRateLimitConfig();
      expect(rateLimitConfig.limit).toBe(5);
      expect(rateLimitConfig.windowMs).toBe(30000);
    });

    it('should update rate limit configuration dynamically', () => {
      executor.updateRateLimitConfig({ limit: 20 });

      const rateLimitConfig = executor.getRateLimitConfig();
      expect(rateLimitConfig.limit).toBe(20);
      expect(rateLimitConfig.windowMs).toBe(10000); // unchanged
    });

    it('should return copy of rate limit config', () => {
      const config1 = executor.getRateLimitConfig();
      const config2 = executor.getRateLimitConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different instances
    });
  });

  describe('Rate Limit Usage Tracking', () => {
    it('should report current usage for a project', async () => {
      const projectId = 'test-project-4';

      expect(executor.getRateLimitUsage(projectId)).toBe(0);

      // Start 2 sessions
      for (let i = 0; i < 2; i++) {
        await executor.execute(
          `session-${i}`,
          projectId,
          '/path/to/project',
          'test message',
          []
        );

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      expect(executor.getRateLimitUsage(projectId)).toBe(2);
    });

    it('should return 0 for non-existent project', () => {
      const usage = executor.getRateLimitUsage('non-existent-project');
      expect(usage).toBe(0);
    });
  });

  describe('Rate Limit Data Management', () => {
    it('should clear rate limit data for specific project', async () => {
      const projectId = 'test-project-5';

      // Fill rate limit
      for (let i = 0; i < 3; i++) {
        await executor.execute(
          `session-${i}`,
          projectId,
          '/path/to/project',
          'test message',
          []
        );

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Verify blocked
      await expect(executor.execute(
        'session-3',
        projectId,
        '/path/to/project',
        'test message',
        []
      )).rejects.toThrow(/Rate limit exceeded/);

      // Clear rate limit
      executor.clearRateLimit(projectId);

      // Should be allowed now
      await executor.execute(
        'session-3',
        projectId,
        '/path/to/project',
        'test message',
        []
      );

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(executor.getRateLimitUsage(projectId)).toBe(1);
    });

    it('should clear all rate limit data', async () => {
      // Fill rate limits for multiple projects
      for (let i = 0; i < 3; i++) {
        await executor.execute(
          `session-p1-${i}`,
          'project-1',
          '/path/to/project',
          'test message',
          []
        );

        await executor.execute(
          `session-p2-${i}`,
          'project-2',
          '/path/to/project',
          'test message',
          []
        );

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Verify both are blocked
      await expect(executor.execute(
        'session-p1-3',
        'project-1',
        '/path/to/project',
        'test message',
        []
      )).rejects.toThrow(/Rate limit exceeded/);

      // Clear all
      executor.clearAllRateLimits();

      // Both should be allowed now
      await executor.execute(
        'session-p1-3',
        'project-1',
        '/path/to/project',
        'test message',
        []
      );

      await executor.execute(
        'session-p2-3',
        'project-2',
        '/path/to/project',
        'test message',
        []
      );

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(spawn).toHaveBeenCalledTimes(8); // 6 initial + 2 after clear
    });
  });

  describe('Rate Limiter Access', () => {
    it('should provide access to rate limiter instance', () => {
      const rateLimiter = executor.getRateLimiter();
      expect(rateLimiter).toBeDefined();
      expect(rateLimiter.getTimestamps('test')).toEqual([]);
    });

    it('should allow rate limiter state inspection', async () => {
      const projectId = 'test-project-6';
      const rateLimiter = executor.getRateLimiter();

      // Start 2 sessions
      for (let i = 0; i < 2; i++) {
        await executor.execute(
          `session-${i}`,
          projectId,
          '/path/to/project',
          'test message',
          []
        );

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const timestamps = rateLimiter.getTimestamps(projectId);
      expect(timestamps).toHaveLength(2);
      expect(timestamps[0]).toBeGreaterThan(0);
    });
  });

  describe('Integration with Session Queue', () => {
    it('should check rate limit before spawning process', async () => {
      const projectId = 'test-project-8';

      // Fill rate limit
      for (let i = 0; i < 3; i++) {
        await executor.execute(
          `session-${i}`,
          projectId,
          '/path/to/project',
          'test message',
          []
        );

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const spawnCallCount = vi.mocked(spawn).mock.calls.length;

      // Try to start 4th session - should be blocked before spawn
      await expect(executor.execute(
        'session-3',
        projectId,
        '/path/to/project',
        'test message',
        []
      )).rejects.toThrow();

      // Spawn should not have been called again
      expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCallCount);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero rate limit', () => {
      const zeroLimitExecutor = new InsightsExecutor(config, sessionQueue, {
        limit: 0,
        windowMs: 60000
      });

      return expect(zeroLimitExecutor.execute(
        'session-1',
        'project-1',
        '/path/to/project',
        'test message',
        []
      )).rejects.toThrow(/Rate limit exceeded/);
    });

    it('should handle very large rate limit', async () => {
      const largeLimitExecutor = new InsightsExecutor(config, sessionQueue, {
        limit: 1000,
        windowMs: 60000
      });

      // Should allow many sessions
      for (let i = 0; i < 10; i++) {
        await largeLimitExecutor.execute(
          `session-${i}`,
          'project-1',
          '/path/to/project',
          'test message',
          []
        );

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      expect(spawn).toHaveBeenCalledTimes(10);
    });
  });
});
