/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SessionQueue,
  SessionPriority,
  type QueuedSession,
  type SessionQueueConfig
} from '../session-queue';

describe('SessionQueue', () => {
  let queue: SessionQueue;
  let config: SessionQueueConfig;

  beforeEach(() => {
    config = {
      maxConcurrentSessions: 3,
      maxSessionsPerProject: 2
    };
    queue = new SessionQueue(config);
  });

  describe('Priority Ordering', () => {
    it('should order sessions by priority (URGENT > HIGH > NORMAL > LOW)', () => {
      const sessions: QueuedSession[] = [
        {
          sessionId: 'session-1',
          projectId: 'project-1',
          priority: SessionPriority.NORMAL,
          queuedAt: Date.now()
        },
        {
          sessionId: 'session-2',
          projectId: 'project-1',
          priority: SessionPriority.HIGH,
          queuedAt: Date.now() + 1
        },
        {
          sessionId: 'session-3',
          projectId: 'project-1',
          priority: SessionPriority.LOW,
          queuedAt: Date.now() + 2
        },
        {
          sessionId: 'session-4',
          projectId: 'project-1',
          priority: SessionPriority.URGENT,
          queuedAt: Date.now() + 3
        }
      ];

      // Enqueue in random order
      sessions.forEach(s => queue.enqueue(s));

      const queued = queue.getQueuedSessions();
      expect(queued[0].sessionId).toBe('session-4'); // URGENT
      expect(queued[1].sessionId).toBe('session-2'); // HIGH
      expect(queued[2].sessionId).toBe('session-1'); // NORMAL
      expect(queued[3].sessionId).toBe('session-3'); // LOW
    });

    it('should maintain FIFO order within same priority level', () => {
      const baseTime = Date.now();

      const sessions: QueuedSession[] = [
        {
          sessionId: 'session-1',
          projectId: 'project-1',
          priority: SessionPriority.NORMAL,
          queuedAt: baseTime
        },
        {
          sessionId: 'session-2',
          projectId: 'project-1',
          priority: SessionPriority.NORMAL,
          queuedAt: baseTime + 100
        },
        {
          sessionId: 'session-3',
          projectId: 'project-1',
          priority: SessionPriority.NORMAL,
          queuedAt: baseTime + 200
        }
      ];

      sessions.forEach(s => queue.enqueue(s));

      const queued = queue.getQueuedSessions();
      expect(queued[0].sessionId).toBe('session-1');
      expect(queued[1].sessionId).toBe('session-2');
      expect(queued[2].sessionId).toBe('session-3');
    });

    it('should insert new session at correct position based on priority and time', () => {
      const baseTime = Date.now();

      // Enqueue initial sessions
      queue.enqueue({
        sessionId: 'session-1',
        projectId: 'project-1',
        priority: SessionPriority.HIGH,
        queuedAt: baseTime
      });
      queue.enqueue({
        sessionId: 'session-2',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: baseTime + 100
      });

      // Insert URGENT session (should go first)
      queue.enqueue({
        sessionId: 'session-3',
        projectId: 'project-1',
        priority: SessionPriority.URGENT,
        queuedAt: baseTime + 200
      });

      // Insert NORMAL session (should go after session-2, which was queued earlier)
      queue.enqueue({
        sessionId: 'session-4',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: baseTime + 300
      });

      const queued = queue.getQueuedSessions();
      expect(queued.map(s => s.sessionId)).toEqual([
        'session-3', // URGENT
        'session-1', // HIGH
        'session-2', // NORMAL (earlier)
        'session-4'  // NORMAL (later)
      ]);
    });
  });

  describe('Enqueue and Dequeue', () => {
    it('should enqueue sessions correctly', () => {
      queue.enqueue({
        sessionId: 'session-1',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });

      expect(queue.getQueueSize()).toBe(1);
      expect(queue.isQueued('session-1')).toBe(true);
    });

    it('should dequeue sessions in priority order', () => {
      const baseTime = Date.now();

      queue.enqueue({
        sessionId: 'session-1',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: baseTime
      });
      queue.enqueue({
        sessionId: 'session-2',
        projectId: 'project-1',
        priority: SessionPriority.HIGH,
        queuedAt: baseTime + 1
      });

      const first = queue.dequeue();
      expect(first?.sessionId).toBe('session-2');

      const second = queue.dequeue();
      expect(second?.sessionId).toBe('session-1');

      const third = queue.dequeue();
      expect(third).toBeUndefined();
    });

    it('should return undefined when dequeueing empty queue', () => {
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe('Concurrent Session Limits', () => {
    it('should enforce global concurrent session limit', () => {
      // Mark 3 sessions as active (reaching the limit)
      queue.markSessionActive('session-1', 'project-1');
      queue.markSessionActive('session-2', 'project-1');
      queue.markSessionActive('session-3', 'project-1');

      expect(queue.canStartSession('project-1')).toBe(false);
    });

    it('should allow starting sessions under global limit', () => {
      queue.markSessionActive('session-1', 'project-1');
      queue.markSessionActive('session-2', 'project-2');

      // 2 active sessions (under global limit of 3), can start more
      expect(queue.canStartSession('project-3')).toBe(true);
    });

    it('should allow starting sessions when limit is zero', () => {
      queue.updateConfig({ maxConcurrentSessions: 0 });

      expect(queue.canStartSession('project-1')).toBe(false);
    });
  });

  describe('Per-Project Session Limits', () => {
    it('should enforce per-project concurrent session limit', () => {
      // Mark 2 sessions as active for project-1 (reaching per-project limit)
      queue.markSessionActive('session-1', 'project-1');
      queue.markSessionActive('session-2', 'project-1');

      // Even though global limit allows 3, project limit is 2
      expect(queue.canStartSession('project-1')).toBe(false);
    });

    it('should allow sessions from different projects under per-project limit', () => {
      queue.markSessionActive('session-1', 'project-1');
      queue.markSessionActive('session-2', 'project-1');

      // Different project, should be allowed
      expect(queue.canStartSession('project-2')).toBe(true);
    });

    it('should track active sessions per project correctly', () => {
      queue.markSessionActive('session-1', 'project-1');
      queue.markSessionActive('session-2', 'project-1');
      queue.markSessionActive('session-3', 'project-2');

      expect(queue.getActiveCountForProject('project-1')).toBe(2);
      expect(queue.getActiveCountForProject('project-2')).toBe(1);
      expect(queue.getActiveCountForProject('project-3')).toBe(0);
    });
  });

  describe('Active Session Management', () => {
    it('should mark sessions as active and track them', () => {
      queue.markSessionActive('session-1', 'project-1');
      queue.markSessionActive('session-2', 'project-2');

      expect(queue.getActiveCount()).toBe(2);
      expect(queue.isActive('session-1')).toBe(true);
      expect(queue.isActive('session-2')).toBe(true);
      expect(queue.isActive('session-3')).toBe(false);
    });

    it('should remove active sessions correctly', () => {
      queue.markSessionActive('session-1', 'project-1');
      queue.markSessionActive('session-2', 'project-2');

      queue.removeActiveSession('session-1', 'project-1');

      expect(queue.getActiveCount()).toBe(1);
      expect(queue.isActive('session-1')).toBe(false);
      expect(queue.getActiveCountForProject('project-1')).toBe(0);
    });

    it('should get all active sessions', () => {
      queue.markSessionActive('session-1', 'project-1');
      queue.markSessionActive('session-2', 'project-2');

      const active = queue.getActiveSessions();
      expect(active).toHaveLength(2);
      expect(active.some(s => s.sessionId === 'session-1')).toBe(true);
      expect(active.some(s => s.sessionId === 'session-2')).toBe(true);
    });

    it('should get active sessions for specific project', () => {
      queue.markSessionActive('session-1', 'project-1');
      queue.markSessionActive('session-2', 'project-1');
      queue.markSessionActive('session-3', 'project-2');

      const project1Sessions = queue.getActiveSessionsForProject('project-1');
      expect(project1Sessions).toHaveLength(2);
      expect(project1Sessions.every(s => s.projectId === 'project-1')).toBe(true);
    });
  });

  describe('Cancellation', () => {
    it('should cancel queued session', () => {
      queue.enqueue({
        sessionId: 'session-1',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });

      const cancelled = queue.cancel('session-1');
      expect(cancelled).toBe(true);
      expect(queue.isQueued('session-1')).toBe(false);
      expect(queue.getQueueSize()).toBe(0);
    });

    it('should return false when cancelling non-existent session', () => {
      expect(queue.cancel('session-1')).toBe(false);
    });

    it('should not affect active sessions when cancelling queued session', () => {
      queue.markSessionActive('session-1', 'project-1');
      queue.enqueue({
        sessionId: 'session-2',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });

      queue.cancel('session-2');

      expect(queue.isActive('session-1')).toBe(true);
      expect(queue.getActiveCount()).toBe(1);
    });

    it('should return false when cancelling active session (not in queue)', () => {
      queue.markSessionActive('session-1', 'project-1');

      expect(queue.cancel('session-1')).toBe(false);
      expect(queue.isActive('session-1')).toBe(true);
    });

    it('should maintain order after mid-queue cancellation', () => {
      const baseTime = Date.now();

      queue.enqueue({
        sessionId: 'session-1',
        projectId: 'project-1',
        priority: SessionPriority.HIGH,
        queuedAt: baseTime
      });
      queue.enqueue({
        sessionId: 'session-2',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: baseTime + 100
      });
      queue.enqueue({
        sessionId: 'session-3',
        projectId: 'project-1',
        priority: SessionPriority.URGENT,
        queuedAt: baseTime + 200
      });

      // Cancel middle session
      queue.cancel('session-2');

      const queued = queue.getQueuedSessions();
      expect(queued.map(s => s.sessionId)).toEqual(['session-3', 'session-1']);
    });
  });

  describe('Queue Position Tracking', () => {
    it('should return correct queue position (1-indexed)', () => {
      queue.enqueue({
        sessionId: 'session-1',
        projectId: 'project-1',
        priority: SessionPriority.HIGH,
        queuedAt: Date.now()
      });
      queue.enqueue({
        sessionId: 'session-2',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now() + 1
      });
      queue.enqueue({
        sessionId: 'session-3',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now() + 2
      });

      expect(queue.getQueuePosition('session-1')).toBe(1);
      expect(queue.getQueuePosition('session-2')).toBe(2);
      expect(queue.getQueuePosition('session-3')).toBe(3);
    });

    it('should return 0 for session not in queue', () => {
      expect(queue.getQueuePosition('session-1')).toBe(0);
    });

    it('should update queue positions after dequeue', () => {
      queue.enqueue({
        sessionId: 'session-1',
        projectId: 'project-1',
        priority: SessionPriority.HIGH,
        queuedAt: Date.now()
      });
      queue.enqueue({
        sessionId: 'session-2',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now() + 1
      });
      queue.enqueue({
        sessionId: 'session-3',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now() + 2
      });

      queue.dequeue();

      expect(queue.getQueuePosition('session-2')).toBe(1);
      expect(queue.getQueuePosition('session-3')).toBe(2);
    });
  });

  describe('Configuration', () => {
    it('should get current configuration', () => {
      const config = queue.getConfig();
      expect(config.maxConcurrentSessions).toBe(3);
      expect(config.maxSessionsPerProject).toBe(2);
    });

    it('should update configuration', () => {
      queue.updateConfig({
        maxConcurrentSessions: 5,
        maxSessionsPerProject: 3
      });

      const config = queue.getConfig();
      expect(config.maxConcurrentSessions).toBe(5);
      expect(config.maxSessionsPerProject).toBe(3);
    });

    it('should partially update configuration', () => {
      queue.updateConfig({ maxConcurrentSessions: 10 });

      const config = queue.getConfig();
      expect(config.maxConcurrentSessions).toBe(10);
      expect(config.maxSessionsPerProject).toBe(2); // Unchanged
    });
  });

  describe('Clear Operations', () => {
    it('should clear all queued sessions', () => {
      queue.enqueue({
        sessionId: 'session-1',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });
      queue.enqueue({
        sessionId: 'session-2',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });

      queue.markSessionActive('session-3', 'project-1');

      queue.clearQueue();

      expect(queue.getQueueSize()).toBe(0);
      expect(queue.getActiveCount()).toBe(1); // Unaffected
    });

    it('should clear all active sessions', () => {
      queue.markSessionActive('session-1', 'project-1');
      queue.markSessionActive('session-2', 'project-2');

      queue.enqueue({
        sessionId: 'session-3',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });

      queue.clearActiveSessions();

      expect(queue.getActiveCount()).toBe(0);
      expect(queue.getQueueSize()).toBe(1); // Unaffected
      expect(queue.getActiveCountForProject('project-1')).toBe(0);
      expect(queue.getActiveCountForProject('project-2')).toBe(0);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle mixed priority and project scenarios', () => {
      const baseTime = Date.now();

      // Enqueue sessions with different priorities and projects
      queue.enqueue({
        sessionId: 'session-1',
        projectId: 'project-1',
        priority: SessionPriority.URGENT,
        queuedAt: baseTime
      });
      queue.enqueue({
        sessionId: 'session-2',
        projectId: 'project-1',
        priority: SessionPriority.HIGH,
        queuedAt: baseTime + 100
      });
      queue.enqueue({
        sessionId: 'session-3',
        projectId: 'project-2',
        priority: SessionPriority.URGENT,
        queuedAt: baseTime + 200
      });

      // Start URGENT session for project-1
      const session1 = queue.dequeue()!;
      expect(session1.sessionId).toBe('session-1');
      queue.markSessionActive(session1.sessionId, session1.projectId);

      // Can start another URGENT session (different project)
      expect(queue.canStartSession('project-2')).toBe(true);

      const session3 = queue.dequeue()!;
      expect(session3.sessionId).toBe('session-3');
      queue.markSessionActive(session3.sessionId, session3.projectId);

      // Can start another session for project-1 (only 1 active, per-project limit is 2)
      expect(queue.canStartSession('project-1')).toBe(true);

      // Start the next session for project-1
      const session2 = queue.dequeue()!;
      expect(session2.sessionId).toBe('session-2');
      queue.markSessionActive(session2.sessionId, session2.projectId);

      // Now cannot start another session for project-1 (per-project limit reached)
      expect(queue.canStartSession('project-1')).toBe(false);

      // And global limit also reached (3 active sessions)
      expect(queue.canStartSession('project-3')).toBe(false);
    });

    it('should properly clean up per-project tracking when all sessions complete', () => {
      queue.markSessionActive('session-1', 'project-1');
      queue.markSessionActive('session-2', 'project-1');

      expect(queue.getActiveCountForProject('project-1')).toBe(2);

      queue.removeActiveSession('session-1', 'project-1');
      expect(queue.getActiveCountForProject('project-1')).toBe(1);

      queue.removeActiveSession('session-2', 'project-1');
      expect(queue.getActiveCountForProject('project-1')).toBe(0);
    });
  });
});
