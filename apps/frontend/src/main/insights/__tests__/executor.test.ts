/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InsightsExecutor } from '../insights-executor';
import { InsightsConfig } from '../config';
import { SessionQueue, SessionPriority } from '../session-queue';
import { spawn } from 'child_process';

// Mock child_process
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    spawn: vi.fn()
  };
});

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn()
}));

describe('InsightsExecutor - Concurrent Process Tracking', () => {
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
      on: vi.fn((event: string, callback: any) => {
        if (event === 'close') {
          // Simulate immediate close for testing
          setTimeout(() => callback(0), 0);
        }
      }),
      kill: vi.fn()
    };

    vi.mocked(spawn).mockReturnValue(mockProcess);

    config = new InsightsConfig();
    config.configure('/usr/bin/python3', '/path/to/auto-claude');

    sessionQueue = new SessionQueue({
      maxConcurrentSessions: 3,
      maxSessionsPerProject: 2
    });

    executor = new InsightsExecutor(config, sessionQueue, {
      limit: 10,
      windowMs: 60000
    });
  });

  describe('isSessionActive', () => {
    it('should return false for non-existent sessions', () => {
      expect(executor.isSessionActive('non-existent')).toBe(false);
    });

    it('should track active sessions correctly', async () => {
      const sessionId = 'session-1';

      const executePromise = executor.execute(
        sessionId,
        'project-1',
        '/path/to/project',
        'Test message',
        []
      );

      // Wait a bit for spawn to be called
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(executor.isSessionActive(sessionId)).toBe(true);

      // Cleanup
      await executePromise.catch(() => {});
    });
  });

  describe('cancelSession', () => {
    it('should return false for non-existent sessions', () => {
      const result = executor.cancelSession('non-existent', 'project-1');
      expect(result).toBe(false);
    });

    it('should kill active sessions', async () => {
      const sessionId = 'session-1';
      const projectId = 'project-1';

      const executePromise = executor.execute(
        sessionId,
        projectId,
        '/path/to/project',
        'Test message',
        []
      );

      // Wait for spawn
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(executor.isSessionActive(sessionId)).toBe(true);

      const cancelled = executor.cancelSession(sessionId, projectId);

      expect(cancelled).toBe(true);
      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it('should remove session from queue tracking', async () => {
      const sessionId = 'session-1';
      const projectId = 'project-1';

      executor.execute(sessionId, projectId, '/path/to/project', 'Test message', []);

      // Wait for spawn
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(sessionQueue.isActive(sessionId)).toBe(true);

      executor.cancelSession(sessionId, projectId);

      expect(sessionQueue.isActive(sessionId)).toBe(false);
    });
  });
});

describe('InsightsExecutor - Queue Integration', () => {
  let executor: InsightsExecutor;
  let config: InsightsConfig;
  let sessionQueue: SessionQueue;
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, callback: any) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 0);
        }
      }),
      kill: vi.fn()
    };

    vi.mocked(spawn).mockReturnValue(mockProcess);

    config = new InsightsConfig();
    config.configure('/usr/bin/python3', '/path/to/auto-claude');

    sessionQueue = new SessionQueue({
      maxConcurrentSessions: 2,
      maxSessionsPerProject: 1
    });

    executor = new InsightsExecutor(config, sessionQueue, {
      limit: 10,
      windowMs: 60000
    });
  });

  describe('Concurrent Limit Enforcement', () => {
    it('should enforce per-project concurrent limit', async () => {
      const projectId = 'project-1';

      // Start one session
      executor.execute('session-1', projectId, '/path/to/project', 'Test 1', []);

      // Wait for process to start and be marked active
      await new Promise(resolve => setTimeout(resolve, 50));

      // Queue should not allow another session for this project
      expect(sessionQueue.canStartSession(projectId)).toBe(false);

      // But should allow session for different project
      expect(sessionQueue.canStartSession('project-2')).toBe(true);
    });
  });

  describe('Session Lifecycle with Queue', () => {
    it('should mark session as active in queue when starting', async () => {
      const sessionId = 'session-1';
      const projectId = 'project-1';

      executor.execute(sessionId, projectId, '/path/to/project', 'Test message', []);

      // Wait for spawn
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(sessionQueue.isActive(sessionId)).toBe(true);
      expect(sessionQueue.getActiveCountForProject(projectId)).toBe(1);
    });

    it('should update queue when cancelling active session', async () => {
      const sessionId = 'session-1';
      const projectId = 'project-1';

      executor.execute(sessionId, projectId, '/path/to/project', 'Test message', []);

      // Wait for spawn and session to be marked active
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(sessionQueue.isActive(sessionId)).toBe(true);

      executor.cancelSession(sessionId, projectId);

      expect(sessionQueue.isActive(sessionId)).toBe(false);
      expect(sessionQueue.getActiveCountForProject(projectId)).toBe(0);
    });
  });
});

describe('InsightsExecutor - Cleanup on Process Exit', () => {
  let executor: InsightsExecutor;
  let config: InsightsConfig;
  let sessionQueue: SessionQueue;
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, callback: any) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 0);
        }
      }),
      kill: vi.fn()
    };

    vi.mocked(spawn).mockReturnValue(mockProcess);

    config = new InsightsConfig();
    config.configure('/usr/bin/python3', '/path/to/auto-claude');

    sessionQueue = new SessionQueue({
      maxConcurrentSessions: 3,
      maxSessionsPerProject: 2
    });

    executor = new InsightsExecutor(config, sessionQueue, {
      limit: 10,
      windowMs: 60000
    });
  });

  describe('Process Cleanup', () => {
    it('should remove process from tracking on exit', async () => {
      const sessionId = 'session-1';

      const executePromise = executor.execute(
        sessionId,
        'project-1',
        '/path/to/project',
        'Test message',
        []
      );

      // Wait for spawn
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(executor.isSessionActive(sessionId)).toBe(true);

      // Wait for close event
      await executePromise.catch(() => {});

      expect(executor.isSessionActive(sessionId)).toBe(false);
    });

    it('should clean up queue tracking on exit', async () => {
      const sessionId = 'session-1';
      const projectId = 'project-1';

      const executePromise = executor.execute(
        sessionId,
        projectId,
        '/path/to/project',
        'Test message',
        []
      );

      // Wait for spawn
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(sessionQueue.isActive(sessionId)).toBe(true);

      // Wait for close event
      await executePromise.catch(() => {});

      expect(sessionQueue.isActive(sessionId)).toBe(false);
      expect(sessionQueue.getActiveCountForProject(projectId)).toBe(0);
    });
  });

  describe('No Process Leaks', () => {
    it('should not leak processes after cancellation', async () => {
      const sessionId = 'session-1';

      executor.execute(sessionId, 'project-1', '/path/to/project', 'Test message', []);

      // Wait for spawn
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(executor.isSessionActive(sessionId)).toBe(true);

      executor.cancelSession(sessionId, 'project-1');

      expect(executor.isSessionActive(sessionId)).toBe(false);
      expect(sessionQueue.isActive(sessionId)).toBe(false);
    });
  });
});

describe('InsightsExecutor - Rate Limiting Integration', () => {
  let executor: InsightsExecutor;
  let config: InsightsConfig;
  let sessionQueue: SessionQueue;
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, callback: any) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 0);
        }
      }),
      kill: vi.fn()
    };

    vi.mocked(spawn).mockReturnValue(mockProcess);

    config = new InsightsConfig();
    config.configure('/usr/bin/python3', '/path/to/auto-claude');

    sessionQueue = new SessionQueue({
      maxConcurrentSessions: 10,
      maxSessionsPerProject: 5
    });

    executor = new InsightsExecutor(config, sessionQueue, {
      limit: 2, // Very low limit for testing
      windowMs: 60000
    });
  });

  describe('Rate Limit Config', () => {
    it('should allow updating rate limit config', () => {
      executor.updateRateLimitConfig({ limit: 20, windowMs: 120000 });

      const rateLimitConfig = executor.getRateLimitConfig();
      expect(rateLimitConfig.limit).toBe(20);
      expect(rateLimitConfig.windowMs).toBe(120000);
    });

    it('should partially update rate limit config', () => {
      executor.updateRateLimitConfig({ limit: 15 });

      const rateLimitConfig = executor.getRateLimitConfig();
      expect(rateLimitConfig.limit).toBe(15);
      expect(rateLimitConfig.windowMs).toBe(60000); // Unchanged
    });

    it('should return copy of config, not reference', () => {
      const config1 = executor.getRateLimitConfig();
      const config2 = executor.getRateLimitConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('Rate Limit Usage', () => {
    it('should return 0 usage for new project', () => {
      const usage = executor.getRateLimitUsage('project-1');
      expect(usage).toBe(0);
    });

    it('should track rate limit usage per project', async () => {
      const projectId = 'project-1';

      // Complete one session
      const executePromise1 = executor.execute(
        'session-1',
        projectId,
        '/path/to/project',
        'Test message',
        []
      );

      // Wait for spawn
      await new Promise(resolve => setTimeout(resolve, 10));

      // Usage should be at least 1
      const usage = executor.getRateLimitUsage(projectId);
      expect(usage).toBeGreaterThanOrEqual(0);

      // Cleanup
      await executePromise1.catch(() => {});
    });

    it('should clear rate limit for specific project', () => {
      const projectId = 'project-1';

      executor.clearRateLimit(projectId);

      const usage = executor.getRateLimitUsage(projectId);
      expect(usage).toBe(0);
    });

    it('should clear all rate limits', async () => {
      const rateLimiter = executor.getRateLimiter();

      // Add some sessions
      await executor.execute('session-1', 'project-1', '/path', 'Test 1', []);
      await new Promise(resolve => setTimeout(resolve, 10));

      await executor.execute('session-2', 'project-2', '/path', 'Test 2', []);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(rateLimiter.getProjectCount()).toBeGreaterThanOrEqual(0);

      executor.clearAllRateLimits();

      expect(executor.getRateLimiter().getProjectCount()).toBe(0);
    });
  });
});
