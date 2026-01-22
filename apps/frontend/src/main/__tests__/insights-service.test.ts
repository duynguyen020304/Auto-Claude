/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InsightsService } from '../insights-service';
import { SessionQueue, SessionPriority } from '../insights/session-queue';

// Mock all dependencies
vi.mock('../insights/config');
vi.mock('../insights/paths');
vi.mock('../insights/session-storage');
vi.mock('../insights/session-manager');
vi.mock('../insights/insights-executor');

describe('InsightsService', () => {
  let service: InsightsService;
  let mockSessionQueue: SessionQueue;
  let mockExecutor: any;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create a real SessionQueue instance for testing
    mockSessionQueue = new SessionQueue({
      maxConcurrentSessions: 2,
      maxSessionsPerProject: 1
    });

    // Create a mock executor
    mockExecutor = {
      on: vi.fn(),
      cancelSession: vi.fn()
    };

    // Create service instance
    service = new InsightsService();

    // Replace the service's sessionQueue and executor with our mocks
    (service as any).sessionQueue = mockSessionQueue;
    (service as any).executor = mockExecutor;
  });

  describe('cancelSession', () => {
    it('should cancel a queued session', () => {
      const sessionId = 'queued-session-1';
      const projectId = 'project-1';

      // Enqueue the session
      mockSessionQueue.enqueue({
        sessionId,
        projectId,
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });

      // Verify session is queued
      expect(mockSessionQueue.isQueued(sessionId)).toBe(true);

      // Cancel the session
      const result = service.cancelSession(sessionId);

      // Verify cancellation
      expect(result).toBe(true);
      expect(mockSessionQueue.isQueued(sessionId)).toBe(false);
      expect(mockExecutor.cancelSession).not.toHaveBeenCalled();
    });

    it('should cancel an active session', () => {
      const sessionId = 'active-session-1';
      const projectId = 'project-1';

      // Mark session as active
      mockSessionQueue.markSessionActive(sessionId, projectId);

      // Verify session is active
      expect(mockSessionQueue.isActive(sessionId)).toBe(true);
      expect(mockSessionQueue.getProjectIdForActiveSession(sessionId)).toBe(projectId);

      // Mock the executor's cancelSession to return true
      mockExecutor.cancelSession.mockReturnValue(true);

      // Cancel the session
      const result = service.cancelSession(sessionId);

      // Verify cancellation
      expect(result).toBe(true);
      expect(mockExecutor.cancelSession).toHaveBeenCalledWith(sessionId, projectId);
    });

    it('should return false when session is not found', () => {
      const sessionId = 'non-existent-session';

      // Cancel the session
      const result = service.cancelSession(sessionId);

      // Verify result
      expect(result).toBe(false);
      expect(mockExecutor.cancelSession).not.toHaveBeenCalled();
    });

    it('should return false when active session has no project ID', () => {
      const sessionId = 'active-session-no-project';
      const projectId = 'project-1';

      // Manually add to activeSessions without proper tracking
      mockSessionQueue.markSessionActive(sessionId, projectId);
      // Then manually clear the activeSessions map to simulate missing project ID
      (mockSessionQueue as any).activeSessions.delete(sessionId);

      // Cancel the session
      const result = service.cancelSession(sessionId);

      // Verify result - should return false since we can't get the project ID
      expect(result).toBe(false);
      expect(mockExecutor.cancelSession).not.toHaveBeenCalled();
    });

    it('should handle cancellation of queued session when executor is also called', () => {
      const sessionId = 'queued-session-2';
      const projectId = 'project-2';

      // Enqueue the session
      mockSessionQueue.enqueue({
        sessionId,
        projectId,
        priority: SessionPriority.HIGH,
        queuedAt: Date.now()
      });

      // Cancel the session
      const result = service.cancelSession(sessionId);

      // Verify it was cancelled from queue and executor was not called
      expect(result).toBe(true);
      expect(mockSessionQueue.isQueued(sessionId)).toBe(false);
      expect(mockExecutor.cancelSession).not.toHaveBeenCalled();
    });

    it('should prioritize queue cancellation over active cancellation', () => {
      const sessionId = 'session-both-states';
      const projectId = 'project-3';

      // Add session to both queue and active (edge case that shouldn't happen in normal flow)
      mockSessionQueue.enqueue({
        sessionId,
        projectId,
        priority: SessionPriority.NORMAL,
        queuedAt: Date.now()
      });
      mockSessionQueue.markSessionActive(sessionId, projectId);

      // Mock executor to track if it was called
      mockExecutor.cancelSession.mockReturnValue(true);

      // Cancel the session
      const result = service.cancelSession(sessionId);

      // Should only cancel from queue, not call executor
      expect(result).toBe(true);
      expect(mockSessionQueue.isQueued(sessionId)).toBe(false);
      expect(mockExecutor.cancelSession).not.toHaveBeenCalled();
    });
  });
});
