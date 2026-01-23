/**
 * Tests for session removal and cleanup
 * Tests removeSession action to ensure proper cleanup of session state
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useInsightsStore } from '../insights-store';

describe('insights-store - session removal', () => {
  beforeEach(() => {
    // Reset store state before each test
    useInsightsStore.getState().clearSession();
  });

  it('should remove session state from sessionStates map', () => {
    const store = useInsightsStore.getState();

    // Set up session A with state
    const sessionAId = 'session-a';
    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'streaming', message: 'Receiving...' }, sessionAId);
    store.setPendingMessage('Pending A', sessionAId);
    store.appendStreamingContent('Content A', sessionAId);

    // Verify session A state exists
    let sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState).toBeDefined();
    expect(sessionAState?.status.phase).toBe('streaming');
    expect(sessionAState?.pendingMessage).toBe('Pending A');
    expect(sessionAState?.streamingContent).toBe('Content A');

    // Remove session A
    store.removeSession(sessionAId);

    // Verify session A state is removed
    sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState).toBeUndefined();
  });

  it('should abort active generation when removing session', () => {
    const store = useInsightsStore.getState();

    // Set up session with active generation
    const sessionId = 'session-active';
    store.setCurrentSessionId(sessionId);
    store.setStatus({ phase: 'streaming', message: 'Receiving...' }, sessionId);

    // Simulate abort controller for the session
    const abortController = new AbortController();
    useInsightsStore.setState((state) => ({
      abortControllers: new Map(state.abortControllers).set(sessionId, abortController)
    }));

    // Verify abort controller exists and is not aborted
    let state = useInsightsStore.getState();
    expect(state.abortControllers.has(sessionId)).toBe(true);
    expect(abortController.signal.aborted).toBe(false);

    // Remove the session
    store.removeSession(sessionId);

    // Verify abort controller was removed and signal was aborted
    state = useInsightsStore.getState();
    expect(state.abortControllers.has(sessionId)).toBe(false);
    expect(abortController.signal.aborted).toBe(true);
  });

  it('should remove session from abortControllers mapping', () => {
    const store = useInsightsStore.getState();

    // Set up session with active generation
    const projectId = 'project-1';
    const sessionId = 'session-generating';
    store.setCurrentSessionId(sessionId);

    // Add to abortControllers mapping (simulating active generation)
    useInsightsStore.setState((state) => ({
      abortControllers: new Map(state.abortControllers).set(sessionId, new AbortController())
    }));

    // Verify abort controller exists
    let state = useInsightsStore.getState();
    expect(state.abortControllers.get(sessionId)).toBeDefined();

    // Remove the session
    store.removeSession(sessionId, projectId);

    // Verify abort controller is removed
    state = useInsightsStore.getState();
    expect(state.abortControllers.get(sessionId)).toBeUndefined();
  });

  it('should clear current session if removing the current session', () => {
    const store = useInsightsStore.getState();

    // Set up current session
    const sessionId = 'session-current';
    store.setCurrentSessionId(sessionId);
    store.setStatus({ phase: 'streaming', message: 'Receiving...' }, sessionId);
    store.setPendingMessage('Pending message', sessionId);
    store.appendStreamingContent('Streaming content', sessionId);
    store.addToolUsage({ name: 'test-tool', input: 'test-input' }, sessionId);
    store.addFileMention({ id: 'file-1', filePath: '/path/to/file' }, sessionId);

    // Verify current session is set
    let state = useInsightsStore.getState();
    expect(state.currentSessionId).toBe(sessionId);
    expect(state.status.phase).toBe('streaming');
    expect(state.pendingMessage).toBe('Pending message');
    expect(state.streamingContent).toBe('Streaming content');
    expect(state.toolsUsed.length).toBe(1);
    expect(state.fileMentions.length).toBe(1);

    // Remove the current session
    store.removeSession(sessionId);

    // Verify current session is cleared
    state = useInsightsStore.getState();
    expect(state.currentSessionId).toBeNull();
    expect(state.session).toBeNull();
    expect(state.status.phase).toBe('idle');
    expect(state.pendingMessage).toBe('');
    expect(state.streamingContent).toBe('');
    expect(state.currentTool).toBeNull();
    expect(state.toolsUsed.length).toBe(0);
    expect(state.fileMentions.length).toBe(0);
  });

  it('should not affect other sessions when removing one session', () => {
    const store = useInsightsStore.getState();

    // Set up two sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    // Set up session A
    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'streaming', message: 'Receiving A...' }, sessionAId);
    store.setPendingMessage('Pending A', sessionAId);
    store.appendStreamingContent('Content A', sessionAId);
    store.addToolUsage({ name: 'tool-a', input: 'input-a' }, sessionAId);

    // Set up session B
    store.setCurrentSessionId(sessionBId);
    store.setStatus({ phase: 'thinking', message: 'Thinking B...' }, sessionBId);
    store.setPendingMessage('Pending B', sessionBId);
    store.appendStreamingContent('Content B', sessionBId);
    store.addToolUsage({ name: 'tool-b', input: 'input-b' }, sessionBId);

    // Remove session A
    store.removeSession(sessionAId);

    // Verify session A state is removed
    let sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState).toBeUndefined();

    // Verify session B state is preserved
    const sessionBState = store.getSessionState(sessionBId);
    expect(sessionBState).toBeDefined();
    expect(sessionBState?.status.phase).toBe('thinking');
    expect(sessionBState?.pendingMessage).toBe('Pending B');
    expect(sessionBState?.streamingContent).toBe('Content B');
    expect(sessionBState?.toolsUsed.length).toBe(1);
    expect(sessionBState?.toolsUsed[0].name).toBe('tool-b');
  });

  it('should handle removing a session that has no state', () => {
    const store = useInsightsStore.getState();

    // Try to remove a session that doesn't exist
    const sessionId = 'non-existent-session';

    // Should not throw an error
    expect(() => {
      store.removeSession(sessionId);
    }).not.toThrow();

    // Verify store state is still valid
    const state = useInsightsStore.getState();
    expect(state.sessionStates.size).toBe(0);
    expect(state.abortControllers.size).toBe(0);
  });

  it('should handle removing session with all types of state', () => {
    const store = useInsightsStore.getState();

    // Set up session with comprehensive state
    const sessionId = 'session-comprehensive';

    store.setCurrentSessionId(sessionId);
    store.setStatus({ phase: 'streaming', message: 'Streaming...' }, sessionId);
    store.setPendingMessage('Pending message', sessionId);
    store.appendStreamingContent('Streaming content', sessionId);
    store.addToolUsage({ name: 'tool-1', input: 'input-1' }, sessionId);
    store.addToolUsage({ name: 'tool-2', input: 'input-2' }, sessionId);
    store.addFileMention({ id: 'file-1', filePath: '/path/to/file1.ts' }, sessionId);
    store.addFileMention({ id: 'file-2', filePath: '/path/to/file2.ts' }, sessionId);

    // Add abort controller
    const abortController = new AbortController();
    useInsightsStore.setState((state) => ({
      abortControllers: new Map(state.abortControllers).set(sessionId, abortController)
    }));

    // Verify all state exists before removal
    let state = useInsightsStore.getState();
    expect(state.sessionStates.has(sessionId)).toBe(true);
    expect(state.abortControllers.has(sessionId)).toBe(true);

    // Remove the session
    store.removeSession(sessionId);

    // Verify all state is removed
    state = useInsightsStore.getState();
    expect(state.sessionStates.has(sessionId)).toBe(false);
    expect(state.abortControllers.has(sessionId)).toBe(false);
    expect(abortController.signal.aborted).toBe(true);
  });

  it('should work correctly when removing the current session with other sessions present', () => {
    const store = useInsightsStore.getState();

    // Set up three sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';
    const sessionCId = 'session-c';

    // Set up session A
    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'complete', message: '' }, sessionAId);
    store.setPendingMessage('Pending A', sessionAId);

    // Set up session B (current)
    store.setCurrentSessionId(sessionBId);
    store.setStatus({ phase: 'streaming', message: 'Streaming B...' }, sessionBId);
    store.setPendingMessage('Pending B', sessionBId);
    store.appendStreamingContent('Content B', sessionBId);

    // Set up session C
    store.setCurrentSessionId(sessionCId);
    store.setStatus({ phase: 'thinking', message: 'Thinking C...' }, sessionCId);
    store.setPendingMessage('Pending C', sessionCId);

    // Make session B the current session again
    store.setCurrentSessionId(sessionBId);

    // Verify session B is current
    let state = useInsightsStore.getState();
    expect(state.currentSessionId).toBe(sessionBId);

    // Remove session B (the current session)
    store.removeSession(sessionBId);

    // Verify session B is removed and current session is cleared
    state = useInsightsStore.getState();
    expect(state.currentSessionId).toBeNull();
    expect(state.sessionStates.has(sessionBId)).toBe(false);

    // Verify sessions A and C are still present
    const sessionAState = store.getSessionState(sessionAId);
    const sessionCState = store.getSessionState(sessionCId);
    expect(sessionAState).toBeDefined();
    expect(sessionCState).toBeDefined();
  });
});
