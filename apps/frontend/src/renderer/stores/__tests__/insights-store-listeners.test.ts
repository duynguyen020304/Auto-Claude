/**
 * Tests for insights-store IPC event listener routing by sessionId
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useInsightsStore, setupInsightsListeners } from '../insights-store';
import type { InsightsStreamChunk } from '../../../shared/types';

// Mock window.electronAPI
const mockListeners = new Map<string, (...args: unknown[]) => void>();

const mockUnsubStreamChunk = vi.fn();
const mockUnsubStatus = vi.fn();
const mockUnsubError = vi.fn();
const mockUnsubSessionUpdated = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    onInsightsStreamChunk: vi.fn((callback) => {
      mockListeners.set('streamChunk', callback);
      return mockUnsubStreamChunk;
    }),
    onInsightsStatus: vi.fn((callback) => {
      mockListeners.set('status', callback);
      return mockUnsubStatus;
    }),
    onInsightsError: vi.fn((callback) => {
      mockListeners.set('error', callback);
      return mockUnsubError;
    }),
    onInsightsSessionUpdated: vi.fn((callback) => {
      mockListeners.set('sessionUpdated', callback);
      return mockUnsubSessionUpdated;
    })
  }
});

describe('insights-store - IPC listener routing by sessionId', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    // Reset store state before each test
    useInsightsStore.getState().clearSession();

    // Clear mock listener tracking
    mockListeners.clear();

    // Reset mock functions
    mockUnsubStreamChunk.mockReset();
    mockUnsubStatus.mockReset();
    mockUnsubError.mockReset();
    mockUnsubSessionUpdated.mockReset();

    // Setup listeners
    cleanup = setupInsightsListeners();
  });

  afterEach(() => {
    // Cleanup listeners after each test
    if (cleanup) {
      cleanup();
    }
  });

  describe('stream chunk routing', () => {
    it('should route stream chunks to the correct session based on sessionId', () => {
      const store = useInsightsStore.getState();

      // Setup two sessions
      const sessionAId = 'session-a';
      const sessionBId = 'session-b';
      const projectId = 'proj-1';

      // Initialize session states
      store.setCurrentSessionId(sessionAId);
      store.setCurrentSessionId(sessionBId);

      // Add abort controller for session A (marks it as generating)
      store.abortControllers.set(sessionAId, new AbortController());

      // Set session B as current (not the generating session)
      store.setCurrentSessionId(sessionBId);

      // Simulate stream chunk for session A
      const streamChunkCallback = mockListeners.get('streamChunk');
      expect(streamChunkCallback).toBeDefined();

      const chunk: InsightsStreamChunk = {
        type: 'text',
        content: 'Hello from session A'
      };

      streamChunkCallback!(sessionAId, projectId, chunk);

      // Verify session A received the content (not session B)
      const stateA = store.getSessionState(sessionAId);
      const stateB = store.getSessionState(sessionBId);

      expect(stateA?.streamingContent).toBe('Hello from session A');
      expect(stateB?.streamingContent).toBe('');

      // Verify top-level field was NOT updated (session B is current)
      expect(store.streamingContent).toBe('');
    });

    it('should drop stream chunks for sessions that have been aborted', () => {
      const store = useInsightsStore.getState();

      const sessionId = 'session-aborted';
      const projectId = 'proj-1';

      // Initialize session state
      store.setCurrentSessionId(sessionId);

      // Don't add abort controller - simulates already-aborted state

      // Simulate stream chunk
      const streamChunkCallback = mockListeners.get('streamChunk');
      const chunk: InsightsStreamChunk = {
        type: 'text',
        content: 'This should be dropped'
      };

      streamChunkCallback!(sessionId, projectId, chunk);

      // Verify content was NOT added (chunk was dropped)
      const state = store.getSessionState(sessionId);
      expect(state?.streamingContent).toBe('');
    });

    it('should drop stream chunks for unknown sessions', () => {
      const store = useInsightsStore.getState();

      const sessionId = 'session-unknown';
      const projectId = 'proj-unknown';

      // Don't initialize session state or add abort controller

      // Simulate stream chunk
      const streamChunkCallback = mockListeners.get('streamChunk');
      const chunk: InsightsStreamChunk = {
        type: 'text',
        content: 'This should be dropped'
      };

      streamChunkCallback!(sessionId, projectId, chunk);

      // Verify content was NOT added (chunk was dropped)
      const state = store.getSessionState(sessionId);
      expect(state?.streamingContent).toBeUndefined();
    });

    it('should handle concurrent stream chunks for multiple sessions', () => {
      const store = useInsightsStore.getState();

      const sessionAId = 'session-a';
      const sessionBId = 'session-b';
      const projectId = 'proj-1';

      // Initialize both sessions
      store.setCurrentSessionId(sessionAId);
      store.setCurrentSessionId(sessionBId);

      // Add abort controllers for both sessions (both generating)
      store.abortControllers.set(sessionAId, new AbortController());
      store.abortControllers.set(sessionBId, new AbortController());

      // Simulate concurrent streaming
      const streamChunkCallback = mockListeners.get('streamChunk');

      streamChunkCallback!(sessionAId, projectId, { type: 'text', content: 'Chunk A1 ' });
      streamChunkCallback!(sessionBId, projectId, { type: 'text', content: 'Chunk B1 ' });
      streamChunkCallback!(sessionAId, projectId, { type: 'text', content: 'Chunk A2 ' });
      streamChunkCallback!(sessionBId, projectId, { type: 'text', content: 'Chunk B2 ' });

      // Verify both sessions received correct content without cross-talk
      const stateA = store.getSessionState(sessionAId);
      const stateB = store.getSessionState(sessionBId);

      expect(stateA?.streamingContent).toBe('Chunk A1 Chunk A2 ');
      expect(stateB?.streamingContent).toBe('Chunk B1 Chunk B2 ');
    });

    it('should update top-level fields only for current session', () => {
      const store = useInsightsStore.getState();

      const sessionAId = 'session-a';
      const sessionBId = 'session-b';
      const projectId = 'proj-1';

      // Initialize both sessions
      store.setCurrentSessionId(sessionAId);
      store.setCurrentSessionId(sessionBId);

      // Add abort controller for session A only
      store.abortControllers.set(sessionAId, new AbortController());
      useInsightsStore.getState().setCurrentSessionId(sessionBId); // Session B is current

      // Simulate stream chunk
      const streamChunkCallback = mockListeners.get('streamChunk');
      streamChunkCallback!(sessionAId, projectId, { type: 'text', content: 'Content A' });

      // Verify session A received content
      const stateA = store.getSessionState(sessionAId);
      expect(stateA?.streamingContent).toBe('Content A');

      // Verify top-level field NOT updated (session B is current, not A)
      expect(store.streamingContent).toBe('');
    });

    it('should handle tool_start chunks and update session state', () => {
      const store = useInsightsStore.getState();
      const sessionId = 'session-tool';
      const projectId = 'proj-1';

      // Initialize session
      useInsightsStore.getState().setCurrentSessionId(sessionId);

      // Add abort controller to mark as generating
      store.abortControllers.set(sessionId, new AbortController());

      // Simulate tool_start chunk
      const streamChunkCallback = mockListeners.get('streamChunk');
      streamChunkCallback!(sessionId, projectId, {
        type: 'tool_start',
        tool: { name: 'test-tool', input: 'test-input' }
      });

      // Verify tool state updated
      const state = store.getSessionState(sessionId);
      expect(state?.currentTool?.name).toBe('test-tool');
      expect(state?.currentTool?.input).toBe('test-input');
      expect(state?.toolsUsed).toHaveLength(1);
      expect(state?.toolsUsed[0].name).toBe('test-tool');
      expect(state?.status.phase).toBe('streaming');
    });

    it('should handle tool_end chunks and clear current tool', () => {
      const store = useInsightsStore.getState();
      const sessionId = 'session-tool-end';
      const projectId = 'proj-1';

      // Initialize session with current tool
      useInsightsStore.getState().setCurrentSessionId(sessionId);

      // Add abort controller to mark as generating
      store.abortControllers.set(sessionId, new AbortController());

      useInsightsStore.getState().setCurrentTool({ name: 'active-tool', input: 'input' });

      // Simulate tool_end chunk
      const streamChunkCallback = mockListeners.get('streamChunk');
      streamChunkCallback!(sessionId, projectId, { type: 'tool_end' });

      // Verify current tool cleared
      const state = store.getSessionState(sessionId);
      expect(state?.currentTool).toBeNull();
    });

    it('should handle done chunks and finalize message', () => {
      const store = useInsightsStore.getState();
      const sessionId = 'session-done';
      const projectId = 'proj-1';

      // Initialize session with streaming content
      useInsightsStore.getState().setCurrentSessionId(sessionId);
      useInsightsStore.getState().setSession({
        id: sessionId,
        projectId,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Add abort controller to mark as generating
      store.abortControllers.set(sessionId, new AbortController());

      useInsightsStore.getState().appendStreamingContent('Final message', sessionId);

      // Simulate done chunk
      const streamChunkCallback = mockListeners.get('streamChunk');
      streamChunkCallback!(sessionId, projectId, { type: 'done' });

      // Verify state finalized
      const storeState = useInsightsStore.getState();
      const state = storeState.getSessionState(sessionId);
      expect(state?.streamingContent).toBe(''); // Cleared
      expect(storeState.session?.messages).toHaveLength(1); // Message added
      expect(storeState.session?.messages[0].content).toBe('Final message');

      // CRITICAL: Verify abort controller was removed (this was the bug)
      expect(storeState.abortControllers.has(sessionId)).toBe(false);
    });

    it('should handle error chunks and update status', () => {
      const store = useInsightsStore.getState();
      const sessionId = 'session-error';
      const projectId = 'proj-1';

      // Initialize session
      useInsightsStore.getState().setCurrentSessionId(sessionId);

      // Add abort controller to mark as generating
      store.abortControllers.set(sessionId, new AbortController());

      // Simulate error chunk
      const streamChunkCallback = mockListeners.get('streamChunk');
      streamChunkCallback!(sessionId, projectId, {
        type: 'error',
        error: 'Test error message'
      });

      // Verify error status
      const storeState = useInsightsStore.getState();
      const state = storeState.getSessionState(sessionId);
      expect(state?.status.phase).toBe('error');
      expect(state?.status.error).toBe('Test error message');

      // CRITICAL: Verify abort controller was removed (this was the bug)
      expect(storeState.abortControllers.has(sessionId)).toBe(false);
    });
  });

  describe('status update routing', () => {
    it('should route status updates to the correct session', () => {
      const store = useInsightsStore.getState();

      const sessionAId = 'session-a';
      const sessionBId = 'session-b';
      const projectId = 'proj-1';

      // Initialize sessions
      store.setCurrentSessionId(sessionAId);
      store.setCurrentSessionId(sessionBId);

      // Add abort controller for session A only
      store.abortControllers.set(sessionAId, new AbortController());

      // Set session B as current
      useInsightsStore.getState().setCurrentSessionId(sessionBId);

      // Simulate status update
      const statusCallback = mockListeners.get('status');
      statusCallback!(sessionAId, projectId, { phase: 'thinking', message: 'Processing...' });

      // Verify session A received status (not session B)
      const stateA = store.getSessionState(sessionAId);
      const stateB = store.getSessionState(sessionBId);

      expect(stateA?.status.phase).toBe('thinking');
      expect(stateA?.status.message).toBe('Processing...');

      expect(stateB?.status.phase).toBe('idle');

      // Verify top-level field NOT updated (session B is current)
      expect(store.status.phase).toBe('idle');
    });

    it('should drop status updates for aborted sessions', () => {
      const sessionId = 'session-aborted';
      const projectId = 'proj-1';

      // Initialize session
      useInsightsStore.getState().setCurrentSessionId(sessionId);

      // Don't add abort controller - simulates aborted state

      // Simulate status update
      const statusCallback = mockListeners.get('status');
      statusCallback!(sessionId, projectId, { phase: 'streaming', message: 'Should be dropped' });

      // Verify status NOT updated
      const store = useInsightsStore.getState();
      const state = store.getSessionState(sessionId);
      expect(state?.status.phase).toBe('idle');
    });

    it('should drop status updates for unknown sessions', () => {
      const store = useInsightsStore.getState();

      const sessionId = 'session-unknown';
      const projectId = 'proj-unknown';

      // Initialize session without abort controller
      store.setCurrentSessionId(sessionId);

      // Simulate status update
      const statusCallback = mockListeners.get('status');
      statusCallback!(sessionId, projectId, { phase: 'thinking', message: 'Should be dropped' });

      // Verify status NOT updated
      const state = store.getSessionState(sessionId);
      expect(state?.status.phase).toBe('idle');
    });
  });

  describe('error routing', () => {
    it('should route errors to the correct session', () => {
      const store = useInsightsStore.getState();
      const sessionAId = 'session-a';
      const sessionBId = 'session-b';
      const projectId = 'proj-1';

      // Initialize sessions
      useInsightsStore.getState().setCurrentSessionId(sessionAId);
      useInsightsStore.getState().setCurrentSessionId(sessionBId);

      // Add abort controller for session A only
      store.abortControllers.set(sessionAId, new AbortController());

      // Set session B as current
      useInsightsStore.getState().setCurrentSessionId(sessionBId);

      // Simulate error
      const errorCallback = mockListeners.get('error');
      errorCallback!(sessionAId, projectId, 'Test error');

      // Verify session A received error (not session B)
      const storeState = useInsightsStore.getState();
      const stateA = storeState.getSessionState(sessionAId);
      const stateB = storeState.getSessionState(sessionBId);

      expect(stateA?.status.phase).toBe('error');
      expect(stateA?.status.error).toBe('Test error');

      expect(stateB?.status.phase).toBe('idle');
    });

    it('should drop errors for aborted sessions', () => {
      const sessionId = 'session-aborted';
      const projectId = 'proj-1';

      // Initialize session
      useInsightsStore.getState().setCurrentSessionId(sessionId);

      // Don't add abort controller - simulates aborted state

      // Simulate error
      const errorCallback = mockListeners.get('error');
      errorCallback!(sessionId, projectId, 'Should be dropped');

      // Verify error NOT set
      const store = useInsightsStore.getState();
      const state = store.getSessionState(sessionId);
      expect(state?.status.phase).toBe('idle');
      expect(state?.status.error).toBeUndefined();
    });

    it('should drop errors for unknown sessions', () => {
      const store = useInsightsStore.getState();

      const sessionId = 'session-unknown';
      const projectId = 'proj-unknown';

      // Initialize session without abort controller
      store.setCurrentSessionId(sessionId);

      // Simulate error
      const errorCallback = mockListeners.get('error');
      errorCallback!(sessionId, projectId, 'Should be dropped');

      // Verify error NOT set
      const state = store.getSessionState(sessionId);
      expect(state?.status.phase).toBe('idle');
    });
  });

  describe('cleanup', () => {
    it('should return cleanup function that unsubscribes all listeners', () => {
      // Verify cleanup function exists
      expect(cleanup).toBeTypeOf('function');

      // Call cleanup
      cleanup!();

      // Verify all unsubscribe functions were called
      expect(mockUnsubStreamChunk).toHaveBeenCalledTimes(1);
      expect(mockUnsubStatus).toHaveBeenCalledTimes(1);
      expect(mockUnsubError).toHaveBeenCalledTimes(1);
      expect(mockUnsubSessionUpdated).toHaveBeenCalledTimes(1);
    });
  });

  describe('cross-session isolation', () => {
    it('should prevent cross-session data leakage during concurrent streaming', () => {
      const store = useInsightsStore.getState();
      const sessionAId = 'session-a';
      const sessionBId = 'session-b';
      const projectId = 'proj-1';

      // Initialize sessions with different states
      useInsightsStore.getState().setCurrentSessionId(sessionAId);
      useInsightsStore.getState().setStatus({ phase: 'streaming', message: 'Streaming A' }, sessionAId);
      useInsightsStore.getState().appendStreamingContent('Content A', sessionAId);
      useInsightsStore.getState().setCurrentTool({ name: 'tool-a' }, sessionAId);

      useInsightsStore.getState().setCurrentSessionId(sessionBId);
      useInsightsStore.getState().setStatus({ phase: 'thinking', message: 'Thinking B' }, sessionBId);
      useInsightsStore.getState().appendStreamingContent('Content B', sessionBId);
      useInsightsStore.getState().setCurrentTool({ name: 'tool-b' }, sessionBId);

      // Add abort controllers for both
      store.abortControllers.set(sessionAId, new AbortController());
      store.abortControllers.set(sessionBId, new AbortController());

      // Stream to both sessions
      const streamChunkCallback = mockListeners.get('streamChunk');

      streamChunkCallback!(sessionAId, projectId, {
        type: 'text',
        content: ' - more A'
      });
      streamChunkCallback!(sessionBId, projectId, {
        type: 'text',
        content: ' - more B'
      });
      streamChunkCallback!(sessionAId, projectId, {
        type: 'tool_start',
        tool: { name: 'new-tool-a', input: 'input-a' }
      });

      // Verify sessions remain isolated
      const storeState = useInsightsStore.getState();
      const stateA = storeState.getSessionState(sessionAId);
      const stateB = storeState.getSessionState(sessionBId);

      expect(stateA?.streamingContent).toBe('Content A - more A');
      expect(stateB?.streamingContent).toBe('Content B - more B');

      // Session A has new-tool-a (from tool_start chunk)
      // Session B's tool was cleared when text chunk arrived (text chunks clear currentTool)
      expect(stateA?.currentTool?.name).toBe('new-tool-a');
      expect(stateB?.currentTool).toBeNull(); // Text chunks clear current tool

      expect(stateA?.status.message).toBe('Using new-tool-a...');
      // Session B's status was updated to 'Receiving response...' when text chunk arrived
      expect(stateB?.status.message).toBe('Receiving response...');
    });
  });
});
