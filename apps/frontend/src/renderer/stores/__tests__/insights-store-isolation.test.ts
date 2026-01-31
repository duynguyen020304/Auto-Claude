/**
 * Tests for insights-store session state isolation
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useInsightsStore } from '../insights-store';

describe('insights-store - session state isolation', () => {
  beforeEach(() => {
    // Reset store state before each test
    useInsightsStore.getState().clearSession();
  });

  it('should maintain separate state for different sessions', () => {
    const store = useInsightsStore.getState();

    // Create session A and set its state
    const sessionAId = 'session-a';
    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'thinking', message: 'Processing A' });
    store.setPendingMessage('Message A');
    store.appendStreamingContent('Streaming A');

    // Create session B and set different state
    const sessionBId = 'session-b';
    store.setCurrentSessionId(sessionBId);
    store.setStatus({ phase: 'streaming', message: 'Streaming B' });
    store.setPendingMessage('Message B');
    store.appendStreamingContent('Streaming B');

    // Get state from sessionStates map (not top-level fields)
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);

    // Verify sessions have different states in the map
    expect(stateA?.status.phase).toBe('thinking');
    expect(stateA?.pendingMessage).toBe('Message A');
    expect(stateA?.streamingContent).toBe('Streaming A');

    expect(stateB?.status.phase).toBe('streaming');
    expect(stateB?.pendingMessage).toBe('Message B');
    expect(stateB?.streamingContent).toBe('Streaming B');
  });

  it('should restore correct state when switching sessions', () => {
    // Setup session A
    const sessionAId = 'session-a';
    const sessionA = {
      id: sessionAId,
      projectId: 'proj-1',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    useInsightsStore.getState().setSession(sessionA);
    useInsightsStore.getState().setStatus({ phase: 'complete', message: 'Done A' });
    useInsightsStore.getState().setPendingMessage('Pending A');

    // Setup session B
    const sessionBId = 'session-b';
    const sessionB = {
      id: sessionBId,
      projectId: 'proj-1',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    useInsightsStore.getState().setSession(sessionB);
    useInsightsStore.getState().setStatus({ phase: 'thinking', message: 'Thinking B' });
    useInsightsStore.getState().setPendingMessage('Pending B');

    // Verify both session states are saved in sessionStates map
    const stateA = useInsightsStore.getState().getSessionState(sessionAId);
    const stateB = useInsightsStore.getState().getSessionState(sessionBId);

    expect(stateA?.status.phase).toBe('complete');
    expect(stateA?.pendingMessage).toBe('Pending A');

    expect(stateB?.status.phase).toBe('thinking');
    expect(stateB?.pendingMessage).toBe('Pending B');

    // Note: setSession should restore session state to top-level fields
    // This is the expected behavior based on the implementation
    // If this test fails, it indicates a bug in setSession not properly restoring state
    useInsightsStore.getState().setSession(sessionA);

    // After switching to session A, top-level fields should match session A's state
    const storeAfterA = useInsightsStore.getState();
    expect(storeAfterA.status.phase).toBe('complete');
    expect(storeAfterA.status.message).toBe('Done A');
    expect(storeAfterA.pendingMessage).toBe('Pending A');

    // Switch to session B
    useInsightsStore.getState().setSession(sessionB);

    // After switching to session B, top-level fields should match session B's state
    const storeAfterB = useInsightsStore.getState();
    expect(storeAfterB.status.phase).toBe('thinking');
    expect(storeAfterB.status.message).toBe('Thinking B');
    expect(storeAfterB.pendingMessage).toBe('Pending B');
  });

  it('should prevent state updates for non-current sessions', () => {
    const store = useInsightsStore.getState();

    // Set current session to A
    const sessionAId = 'session-a';
    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'idle', message: '' });

    // Try to update session B while A is current (should be rejected)
    const sessionBId = 'session-b';

    // These updates should be rejected due to validation guards
    store.setStatus({ phase: 'thinking', message: 'Should not update' }, sessionBId);
    store.setPendingMessage('Should not update', sessionBId);
    store.appendStreamingContent('Should not update', sessionBId);

    // Verify current session (A) state remains unchanged
    expect(store.status.phase).toBe('idle');
    expect(store.pendingMessage).toBe('');
    expect(store.streamingContent).toBe('');
  });

  it('should isolate tool usage between sessions', () => {
    const store = useInsightsStore.getState();

    // Setup session A with tools
    const sessionAId = 'session-a';
    store.setCurrentSessionId(sessionAId);
    store.setCurrentTool({ name: 'tool-a', input: 'input-a' });
    store.addToolUsage({ name: 'tool-a', input: 'input-a' });

    // Setup session B with different tools
    const sessionBId = 'session-b';
    store.setCurrentSessionId(sessionBId);
    store.setCurrentTool({ name: 'tool-b', input: 'input-b' });
    store.addToolUsage({ name: 'tool-b', input: 'input-b' });

    // Get session states
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);

    // Verify tools are isolated
    expect(stateA?.currentTool?.name).toBe('tool-a');
    expect(stateA?.toolsUsed).toHaveLength(1);
    expect(stateA?.toolsUsed[0].name).toBe('tool-a');

    expect(stateB?.currentTool?.name).toBe('tool-b');
    expect(stateB?.toolsUsed).toHaveLength(1);
    expect(stateB?.toolsUsed[0].name).toBe('tool-b');
  });

  it('should handle cleanup without affecting other sessions', () => {
    const store = useInsightsStore.getState();

    // Setup both sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'streaming', message: 'Streaming A' });
    store.setPendingMessage('Pending A');
    store.appendStreamingContent('Content A');

    store.setCurrentSessionId(sessionBId);
    store.setStatus({ phase: 'thinking', message: 'Thinking B' });
    store.setPendingMessage('Pending B');
    store.appendStreamingContent('Content B');

    // Cleanup session B
    store.cleanupSessionState(sessionBId);

    // Verify session B state is reset
    const stateB = store.getSessionState(sessionBId);
    expect(stateB?.status.phase).toBe('idle');
    expect(stateB?.pendingMessage).toBe('');
    expect(stateB?.streamingContent).toBe('');

    // Verify session A state is unaffected
    const stateA = store.getSessionState(sessionAId);
    expect(stateA?.status.phase).toBe('streaming');
    expect(stateA?.pendingMessage).toBe('Pending A');
    expect(stateA?.streamingContent).toBe('Content A');
  });

  it('should initialize session state for new sessions', () => {
    const store = useInsightsStore.getState();

    // Create first session
    const sessionAId = 'session-a';
    store.setCurrentSessionId(sessionAId);

    // Verify session state exists
    let stateA = store.getSessionState(sessionAId);
    expect(stateA).toBeDefined();
    expect(stateA?.status.phase).toBe('idle');
    expect(stateA?.pendingMessage).toBe('');

    // Create second session
    const sessionBId = 'session-b';
    store.setCurrentSessionId(sessionBId);

    // Verify second session has initial state
    const stateB = store.getSessionState(sessionBId);
    expect(stateB).toBeDefined();
    expect(stateB?.status.phase).toBe('idle');
    expect(stateB?.pendingMessage).toBe('');

    // Verify first session still exists and has its state
    stateA = store.getSessionState(sessionAId);
    expect(stateA).toBeDefined();
  });

  it('should handle streaming content isolation during session switches', () => {
    // Start streaming in session A
    const sessionAId = 'session-a';
    const sessionA = {
      id: sessionAId,
      projectId: 'proj-1',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    useInsightsStore.getState().setSession(sessionA);
    useInsightsStore.getState().appendStreamingContent('Hello ');
    useInsightsStore.getState().appendStreamingContent('from A');

    // Switch to session B and stream different content
    const sessionBId = 'session-b';
    const sessionB = {
      id: sessionBId,
      projectId: 'proj-1',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    useInsightsStore.getState().setSession(sessionB);
    useInsightsStore.getState().appendStreamingContent('Hello ');
    useInsightsStore.getState().appendStreamingContent('from B');

    // Verify both session streaming contents are saved in sessionStates map
    const stateA = useInsightsStore.getState().getSessionState(sessionAId);
    const stateB = useInsightsStore.getState().getSessionState(sessionBId);

    expect(stateA?.streamingContent).toBe('Hello from A');
    expect(stateB?.streamingContent).toBe('Hello from B');

    // Switch back to A using setSession and verify state is correctly restored
    useInsightsStore.getState().setSession(sessionA);
    const finalStore = useInsightsStore.getState();
    expect(finalStore.streamingContent).toBe('Hello from A');
  });
});
