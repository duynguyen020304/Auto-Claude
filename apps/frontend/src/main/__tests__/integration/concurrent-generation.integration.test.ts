/**
 * Integration tests for end-to-end concurrent generation flow
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionQueue, SessionPriority } from '../../insights/session-queue';
import { RollingWindowRateLimiter } from '../../insights/rate-limiter';
import { InsightsService } from '../../insights-service';

// Mock all the dependencies that require Python environment
vi.mock('../../insights/config');
vi.mock('../../insights/paths');
vi.mock('../../insights/session-storage');
vi.mock('../../insights/session-manager');
vi.mock('../../insights/insights-executor');

describe('Concurrent Generation - End-to-End Integration', () => {
  let sessionQueue: SessionQueue;
  let rateLimiter: RollingWindowRateLimiter;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create real instances of core components for integration testing
    sessionQueue = new SessionQueue({
      maxConcurrentSessions: 2,
      maxSessionsPerProject: 1
    });

    rateLimiter = new RollingWindowRateLimiter();
  });

  describe('Session Queue Integration', () => {
    it('should complete full lifecycle: queue → active → remove', () => {
      const sessionId = 'session-1';
      const projectId = 'project-1';

      // Step 1: Enqueue session
      sessionQueue.enqueue({
        sessionId,
        projectId,
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });

      expect(sessionQueue.isQueued(sessionId)).toBe(true);
      expect(sessionQueue.getQueueSize()).toBe(1);

      // Step 2: Dequeue and mark as active
      const dequeuedSession = sessionQueue.dequeue();
      expect(dequeuedSession).toBeDefined();
      expect(dequeuedSession?.sessionId).toBe(sessionId);
      expect(sessionQueue.isQueued(sessionId)).toBe(false);
      expect(sessionQueue.getQueueSize()).toBe(0);

      // Mark as active
      sessionQueue.markSessionActive(sessionId, projectId);
      expect(sessionQueue.isActive(sessionId)).toBe(true);
      expect(sessionQueue.getActiveCount()).toBe(1);

      // Step 3: Remove (cleanup)
      sessionQueue.removeActiveSession(sessionId, projectId);
      expect(sessionQueue.isActive(sessionId)).toBe(false);
      expect(sessionQueue.getActiveCount()).toBe(0);
    });

    it('should enforce concurrent session limits', () => {
      const projectId = 'project-1';

      // Should be able to start first session
      expect(sessionQueue.canStartSession(projectId)).toBe(true);

      // Mark first session as active
      sessionQueue.markSessionActive('session-1', projectId);

      // Cannot start another session for same project (maxSessionsPerProject=1)
      expect(sessionQueue.canStartSession(projectId)).toBe(false);
      expect(sessionQueue.getActiveCount()).toBe(1);

      // Mark second session as active for different project
      sessionQueue.markSessionActive('session-2', 'project-2');
      expect(sessionQueue.getActiveCount()).toBe(2);

      // At global limit (maxConcurrentSessions=2), cannot start more sessions
      expect(sessionQueue.canStartSession('project-3')).toBe(false);

      // Clean up
      sessionQueue.removeActiveSession('session-1', projectId);
      sessionQueue.removeActiveSession('session-2', 'project-2');
    });

    it('should enforce per-project concurrent limits', () => {
      const projectId1 = 'project-1';
      const projectId2 = 'project-2';

      // Start first session for project-1
      sessionQueue.markSessionActive('session-1', projectId1);
      expect(sessionQueue.getActiveCountForProject(projectId1)).toBe(1);
      expect(sessionQueue.canStartSession(projectId1)).toBe(false); // maxSessionsPerProject=1

      // Can still start session for different project
      expect(sessionQueue.canStartSession(projectId2)).toBe(true);
      sessionQueue.markSessionActive('session-2', projectId2);
      expect(sessionQueue.getActiveCountForProject(projectId2)).toBe(1);

      // Clean up
      sessionQueue.removeActiveSession('session-1', projectId1);
      sessionQueue.removeActiveSession('session-2', projectId2);
    });

    it('should cancel queued session', () => {
      const sessionId = 'session-cancel';
      const projectId = 'project-1';

      // Enqueue session
      sessionQueue.enqueue({
        sessionId,
        projectId,
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });

      expect(sessionQueue.isQueued(sessionId)).toBe(true);

      // Cancel session
      const cancelled = sessionQueue.cancel(sessionId);
      expect(cancelled).toBe(true);
      expect(sessionQueue.isQueued(sessionId)).toBe(false);
      expect(sessionQueue.getQueueSize()).toBe(0);
    });

    it('should get queue position correctly', () => {
      const now = Date.now();

      // Enqueue sessions with different priorities
      sessionQueue.enqueue({
        sessionId: 'low-1',
        projectId: 'project-1',
        priority: SessionPriority.LOW,
        queuedAt: now
      });

      sessionQueue.enqueue({
        sessionId: 'urgent-1',
        projectId: 'project-1',
        priority: SessionPriority.URGENT,
        queuedAt: now + 1
      });

      sessionQueue.enqueue({
        sessionId: 'normal-1',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: now + 2
      });

      // Queue positions (1-indexed)
      expect(sessionQueue.getQueuePosition('urgent-1')).toBe(1);
      expect(sessionQueue.getQueuePosition('normal-1')).toBe(2);
      expect(sessionQueue.getQueuePosition('low-1')).toBe(3);
    });

    it('should return active sessions with metadata', () => {
      const sessionId = 'session-active';
      const projectId = 'project-1';

      const beforeMark = Date.now();
      sessionQueue.markSessionActive(sessionId, projectId);
      const afterMark = Date.now();

      const activeSessions = sessionQueue.getActiveSessions();

      expect(activeSessions.length).toBe(1);
      expect(activeSessions[0].sessionId).toBe(sessionId);
      expect(activeSessions[0].projectId).toBe(projectId);
      expect(activeSessions[0].startedAt).toBeGreaterThanOrEqual(beforeMark);
      expect(activeSessions[0].startedAt).toBeLessThanOrEqual(afterMark);
    });

    it('should handle cleanup operations', () => {
      // Add queued sessions
      sessionQueue.enqueue({
        sessionId: 'queued-1',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });

      // Add active sessions
      sessionQueue.markSessionActive('active-1', 'project-1');
      sessionQueue.markSessionActive('active-2', 'project-2');

      expect(sessionQueue.getQueueSize()).toBe(1);
      expect(sessionQueue.getActiveCount()).toBe(2);

      // Clear queue only
      sessionQueue.clearQueue();
      expect(sessionQueue.getQueueSize()).toBe(0);
      expect(sessionQueue.getActiveCount()).toBe(2);

      // Clear active sessions
      sessionQueue.clearActiveSessions();
      expect(sessionQueue.getActiveCount()).toBe(0);
    });
  });

  describe('Rate Limiter Integration', () => {
    it('should enforce rate limit per project', () => {
      const projectId = 'project-1';
      const limit = 3;
      const windowMs = 100;

      // First 3 sessions should be allowed
      expect(rateLimiter.canStartSession(projectId, limit, windowMs)).toBe(true);
      expect(rateLimiter.canStartSession(projectId, limit, windowMs)).toBe(true);
      expect(rateLimiter.canStartSession(projectId, limit, windowMs)).toBe(true);

      // 4th session should be blocked
      expect(rateLimiter.canStartSession(projectId, limit, windowMs)).toBe(false);
    });

    it('should track rate limit usage correctly', () => {
      const projectId1 = 'project-1';
      const projectId2 = 'project-2';
      const limit = 5;
      const windowMs = 1000;

      // Add sessions for project-1
      rateLimiter.canStartSession(projectId1, limit, windowMs);
      rateLimiter.canStartSession(projectId1, limit, windowMs);
      rateLimiter.canStartSession(projectId1, limit, windowMs);

      // Add sessions for project-2
      rateLimiter.canStartSession(projectId2, limit, windowMs);
      rateLimiter.canStartSession(projectId2, limit, windowMs);

      // Check usage
      expect(rateLimiter.getUsage(projectId1, windowMs)).toBe(3);
      expect(rateLimiter.getUsage(projectId2, windowMs)).toBe(2);
    });

    it('should clean up old timestamps automatically', async () => {
      const projectId = 'project-1';
      const limit = 10;
      const windowMs = 100; // Short window for testing

      // Add some sessions
      rateLimiter.canStartSession(projectId, limit, windowMs);
      rateLimiter.canStartSession(projectId, limit, windowMs);
      rateLimiter.canStartSession(projectId, limit, windowMs);

      expect(rateLimiter.getUsage(projectId, windowMs)).toBe(3);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, windowMs + 50));

      // Old timestamps should be cleaned up
      expect(rateLimiter.getUsage(projectId, windowMs)).toBe(0);

      // Should be able to start new sessions
      expect(rateLimiter.canStartSession(projectId, limit, windowMs)).toBe(true);
    });

    it('should clear rate limit data for specific project', () => {
      const projectId1 = 'project-1';
      const projectId2 = 'project-2';
      const limit = 10;
      const windowMs = 1000;

      // Add sessions for both projects
      rateLimiter.canStartSession(projectId1, limit, windowMs);
      rateLimiter.canStartSession(projectId2, limit, windowMs);

      // Clear only project-1
      rateLimiter.clearProject(projectId1);

      expect(rateLimiter.getUsage(projectId1, windowMs)).toBe(0);
      expect(rateLimiter.getUsage(projectId2, windowMs)).toBe(1);
    });

    it('should clear all rate limit data', () => {
      const limit = 10;
      const windowMs = 1000;

      // Add sessions for multiple projects
      rateLimiter.canStartSession('project-1', limit, windowMs);
      rateLimiter.canStartSession('project-2', limit, windowMs);
      rateLimiter.canStartSession('project-3', limit, windowMs);

      // Clear all
      rateLimiter.clearAll();

      expect(rateLimiter.getUsage('project-1', windowMs)).toBe(0);
      expect(rateLimiter.getUsage('project-2', windowMs)).toBe(0);
      expect(rateLimiter.getUsage('project-3', windowMs)).toBe(0);
    });
  });

  describe('Queue Priority Integration', () => {
    it('should maintain priority order (URGENT > HIGH > NORMAL > LOW)', () => {
      const now = Date.now();

      // Enqueue sessions in random order
      sessionQueue.enqueue({
        sessionId: 'normal-1',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: now
      });

      sessionQueue.enqueue({
        sessionId: 'urgent-1',
        projectId: 'project-1',
        priority: SessionPriority.URGENT,
        queuedAt: now + 1
      });

      sessionQueue.enqueue({
        sessionId: 'low-1',
        projectId: 'project-1',
        priority: SessionPriority.LOW,
        queuedAt: now + 2
      });

      sessionQueue.enqueue({
        sessionId: 'high-1',
        projectId: 'project-1',
        priority: SessionPriority.HIGH,
        queuedAt: now + 3
      });

      // Dequeue and verify order
      const order: string[] = [];
      let session = sessionQueue.dequeue();
      while (session) {
        order.push(session.sessionId);
        session = sessionQueue.dequeue();
      }

      expect(order).toEqual(['urgent-1', 'high-1', 'normal-1', 'low-1']);
    });

    it('should maintain FIFO order within same priority', () => {
      const now = Date.now();

      // Enqueue multiple NORMAL priority sessions
      sessionQueue.enqueue({
        sessionId: 'normal-1',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: now
      });

      sessionQueue.enqueue({
        sessionId: 'normal-2',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: now + 10
      });

      sessionQueue.enqueue({
        sessionId: 'normal-3',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: now + 20
      });

      // Dequeue and verify FIFO order
      const order: string[] = [];
      let nextSession = sessionQueue.dequeue();
      while (nextSession) {
        order.push(nextSession.sessionId);
        nextSession = sessionQueue.dequeue();
      }

      expect(order).toEqual(['normal-1', 'normal-2', 'normal-3']);
    });

    it('should insert higher priority session ahead of lower ones', () => {
      const now = Date.now();

      // Enqueue a LOW priority session
      sessionQueue.enqueue({
        sessionId: 'low-1',
        projectId: 'project-1',
        priority: SessionPriority.LOW,
        queuedAt: now
      });

      // Enqueue a HIGH priority session later
      sessionQueue.enqueue({
        sessionId: 'high-1',
        projectId: 'project-1',
        priority: SessionPriority.HIGH,
        queuedAt: now + 100
      });

      // HIGH should be dequeued first even though it was queued later
      const first = sessionQueue.dequeue();
      expect(first?.sessionId).toBe('high-1');

      const second = sessionQueue.dequeue();
      expect(second?.sessionId).toBe('low-1');
    });
  });

  describe('InsightsService Integration', () => {
    it('should integrate with SessionQueue for active session management', () => {
      const service = new InsightsService();

      // Get active sessions (should be empty initially)
      const activeSessions = service.getActiveSessions();
      expect(Array.isArray(activeSessions)).toBe(true);
      expect(activeSessions.length).toBe(0);
    });

    it('should cancel session from queue', () => {
      const service = new InsightsService();
      const sessionId = 'queued-session';
      const projectId = 'project-1';

      // Manually enqueue a session
      const serviceQueue = (service as unknown as { sessionQueue: SessionQueue }).sessionQueue;
      serviceQueue.enqueue({
        sessionId,
        projectId,
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });

      // Verify it's queued
      expect(serviceQueue.isQueued(sessionId)).toBe(true);

      // Cancel the session
      const result = service.cancelSession(sessionId);

      // Verify cancellation
      expect(result).toBe(true);
      expect(serviceQueue.isQueued(sessionId)).toBe(false);
    });

    it('should return false when cancelling non-existent session', () => {
      const service = new InsightsService();

      // Try to cancel a session that doesn't exist
      const result = service.cancelSession('non-existent-session');

      expect(result).toBe(false);
    });
  });

  describe('End-to-End Flow Scenarios', () => {
    it('should handle complete flow: queue check → enqueue → dequeue → activate → cleanup', () => {
      const sessionId = 'session-e2e';
      const projectId = 'project-1';

      // Step 1: Check if can start (should be true initially)
      expect(sessionQueue.canStartSession(projectId)).toBe(true);

      // Step 2: Enqueue session
      sessionQueue.enqueue({
        sessionId,
        projectId,
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });
      expect(sessionQueue.isQueued(sessionId)).toBe(true);

      // Step 3: Dequeue when ready
      const dequeued = sessionQueue.dequeue();
      expect(dequeued?.sessionId).toBe(sessionId);
      expect(sessionQueue.isQueued(sessionId)).toBe(false);

      // Step 4: Mark as active
      sessionQueue.markSessionActive(sessionId, projectId);
      expect(sessionQueue.isActive(sessionId)).toBe(true);
      expect(sessionQueue.getActiveCount()).toBe(1);

      // Step 5: Cleanup
      sessionQueue.removeActiveSession(sessionId, projectId);
      expect(sessionQueue.isActive(sessionId)).toBe(false);
      expect(sessionQueue.getActiveCount()).toBe(0);
    });

    it('should handle multiple sessions with different projects and priorities', () => {
      const now = Date.now();

      // Enqueue sessions with different projects and priorities
      sessionQueue.enqueue({
        sessionId: 'project-1-normal',
        projectId: 'project-1',
        priority: SessionPriority.NORMAL,
        queuedAt: now
      });

      sessionQueue.enqueue({
        sessionId: 'project-2-urgent',
        projectId: 'project-2',
        priority: SessionPriority.URGENT,
        queuedAt: now + 1
      });

      sessionQueue.enqueue({
        sessionId: 'project-1-high',
        projectId: 'project-1',
        priority: SessionPriority.HIGH,
        queuedAt: now + 2
      });

      // Verify queue size
      expect(sessionQueue.getQueueSize()).toBe(3);

      // Verify order (urgent should be first)
      const first = sessionQueue.dequeue();
      expect(first?.sessionId).toBe('project-2-urgent');

      // Remaining queue should have 2 items
      expect(sessionQueue.getQueueSize()).toBe(2);

      // Start the urgent session (project-2)
      sessionQueue.markSessionActive('project-2-urgent', 'project-2');

      // Can still start session for project-1 (different project)
      expect(sessionQueue.canStartSession('project-1')).toBe(true);

      // Cleanup
      sessionQueue.removeActiveSession('project-2-urgent', 'project-2');
      expect(sessionQueue.getActiveCount()).toBe(0);
    });

    it('should handle rate limiting combined with queue limits', () => {
      const projectId = 'project-1';
      const limit = 2;
      const windowMs = 1000;

      // Start 2 sessions (at rate limit)
      expect(rateLimiter.canStartSession(projectId, limit, windowMs)).toBe(true);
      expect(rateLimiter.canStartSession(projectId, limit, windowMs)).toBe(true);

      // 3rd session blocked by rate limit
      expect(rateLimiter.canStartSession(projectId, limit, windowMs)).toBe(false);

      // But queue still allows checking (separate from rate limit)
      expect(sessionQueue.canStartSession(projectId)).toBe(true);

      // Verify rate limit usage
      expect(rateLimiter.getUsage(projectId, windowMs)).toBe(2);
    });
  });
});
