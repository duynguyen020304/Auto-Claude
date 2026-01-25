/**
 * Integration tests for rapid session switching
 * Tests state isolation between sessions during rapid switches
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useInsightsStore } from '../insights-store';

describe('insights-store - rapid session switching', () => {
  beforeEach(() => {
    // Reset store state before each test
    useInsightsStore.getState().clearSession();
  });

  it('should isolate state between two sessions', () => {
    const store = useInsightsStore.getState();

    // Set up session A with active generation state
    const sessionAId = 'session-a';
    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'streaming', message: 'Receiving...' }, sessionAId);
    store.setPendingMessage('Message from A', sessionAId);
    store.appendStreamingContent('Content from A', sessionAId);

    // Verify session A state (current session)
    let state = useInsightsStore.getState();
    expect(state.status.phase).toBe('streaming');
    expect(state.pendingMessage).toBe('Message from A');
    expect(state.streamingContent).toBe('Content from A');

    // Verify session A state in sessionStates map
    let sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState?.status.phase).toBe('streaming');
    expect(sessionAState?.pendingMessage).toBe('Message from A');
    expect(sessionAState?.streamingContent).toBe('Content from A');

    // Switch to session B
    const sessionBId = 'session-b';
    store.setCurrentSessionId(sessionBId);
    store.setStatus({ phase: 'idle', message: '' }, sessionBId);
    store.setPendingMessage('Message from B', sessionBId);
    store.appendStreamingContent('Content from B', sessionBId);

    // Verify session B state (current session)
    state = useInsightsStore.getState();
    expect(state.status.phase).toBe('idle');
    expect(state.pendingMessage).toBe('Message from B');
    expect(state.streamingContent).toBe('Content from B');

    // Verify session B state in sessionStates map
    let sessionBState = store.getSessionState(sessionBId);
    expect(sessionBState?.status.phase).toBe('idle');
    expect(sessionBState?.pendingMessage).toBe('Message from B');
    expect(sessionBState?.streamingContent).toBe('Content from B');

    // Verify session A state is still preserved in sessionStates map
    sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState?.status.phase).toBe('streaming');
    expect(sessionAState?.pendingMessage).toBe('Message from A');
    expect(sessionAState?.streamingContent).toBe('Content from A');

    // Verify session A and B states are isolated from each other
    expect(sessionAState?.status.phase).not.toBe(sessionBState?.status.phase);
    expect(sessionAState?.pendingMessage).not.toBe(sessionBState?.pendingMessage);
    expect(sessionAState?.streamingContent).not.toBe(sessionBState?.streamingContent);
  });

  it('should reject state updates for non-current session', () => {
    const store = useInsightsStore.getState();

    // Set up session A as current
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'idle', message: '' }, sessionAId);

    // Try to update session B while A is current (should be rejected)
    store.setStatus({ phase: 'streaming', message: 'Updating B' }, sessionBId);

    // Verify current session (A) state remains unchanged
    let state = useInsightsStore.getState();
    expect(state.status.phase).toBe('idle');
    expect(state.currentSessionId).toBe(sessionAId);

    // Verify session B state in sessionStates map
    const sessionBState = store.getSessionState(sessionBId);
    expect(sessionBState).toBeUndefined();
  });

  it('should preserve session state when switching rapidly between sessions', () => {
    const store = useInsightsStore.getState();

    // Create three sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';
    const sessionCId = 'session-c';

    // Set up session A
    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'complete', message: '' }, sessionAId);
    store.setPendingMessage('Pending A', sessionAId);
    store.appendStreamingContent('Content A', sessionAId);
    store.addToolUsage({ name: 'tool-a', input: 'input-a' }, sessionAId);

    // Set up session B
    store.setCurrentSessionId(sessionBId);
    store.setStatus({ phase: 'thinking', message: 'Thinking...' }, sessionBId);
    store.setPendingMessage('Pending B', sessionBId);
    store.appendStreamingContent('Content B', sessionBId);
    store.addToolUsage({ name: 'tool-b', input: 'input-b' }, sessionBId);

    // Set up session C
    store.setCurrentSessionId(sessionCId);
    store.setStatus({ phase: 'streaming', message: 'Streaming...' }, sessionCId);
    store.setPendingMessage('Pending C', sessionCId);
    store.appendStreamingContent('Content C', sessionCId);
    store.addToolUsage({ name: 'tool-c', input: 'input-c' }, sessionCId);

    // Verify all three session states are preserved in sessionStates map
    const sessionAState = store.getSessionState(sessionAId);
    const sessionBState = store.getSessionState(sessionBId);
    const sessionCState = store.getSessionState(sessionCId);

    // Verify session A state
    expect(sessionAState?.status.phase).toBe('complete');
    expect(sessionAState?.pendingMessage).toBe('Pending A');
    expect(sessionAState?.streamingContent).toBe('Content A');
    expect(sessionAState?.toolsUsed.length).toBe(1);
    expect(sessionAState?.toolsUsed[0].name).toBe('tool-a');

    // Verify session B state
    expect(sessionBState?.status.phase).toBe('thinking');
    expect(sessionBState?.pendingMessage).toBe('Pending B');
    expect(sessionBState?.streamingContent).toBe('Content B');
    expect(sessionBState?.toolsUsed.length).toBe(1);
    expect(sessionBState?.toolsUsed[0].name).toBe('tool-b');

    // Verify session C state (current session)
    let state = useInsightsStore.getState();
    expect(state.status.phase).toBe('streaming');
    expect(state.pendingMessage).toBe('Pending C');
    expect(state.streamingContent).toBe('Content C');
    expect(state.toolsUsed.length).toBe(1);
    expect(state.toolsUsed[0].name).toBe('tool-c');

    // Also verify session C in sessionStates map
    expect(sessionCState?.status.phase).toBe('streaming');
    expect(sessionCState?.pendingMessage).toBe('Pending C');
    expect(sessionCState?.streamingContent).toBe('Content C');
    expect(sessionCState?.toolsUsed.length).toBe(1);
    expect(sessionCState?.toolsUsed[0].name).toBe('tool-c');
  });

  it('should handle abort during rapid session switching', () => {
    const store = useInsightsStore.getState();

    // Create session A with active generation
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'streaming', message: 'Receiving...' }, sessionAId);

    // Simulate abort controller for session A
    const abortController = new AbortController();
    useInsightsStore.setState((state) => ({
      abortControllers: new Map(state.abortControllers).set(sessionAId, abortController)
    }));

    // Verify abort controller exists
    let state = useInsightsStore.getState();
    expect(state.abortControllers.has(sessionAId)).toBe(true);
    expect(abortController.signal.aborted).toBe(false);

    // Abort session A
    store.abortGeneration(sessionAId);

    // Verify abort controller was removed and signal was aborted
    state = useInsightsStore.getState();
    expect(state.abortControllers.has(sessionAId)).toBe(false);
    expect(abortController.signal.aborted).toBe(true);

    // Verify session A status was reset
    const sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState?.status.phase).toBe('idle');
  });

  it('should cleanup session state without affecting other sessions', () => {
    const store = useInsightsStore.getState();

    // Create two sessions with different states
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    // Set up session A with active state
    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'streaming', message: 'Receiving...' }, sessionAId);
    store.setPendingMessage('Pending A', sessionAId);
    store.appendStreamingContent('Content A', sessionAId);
    store.addToolUsage({ name: 'tool-a', input: 'input-a' }, sessionAId);

    // Set up session B with active state
    store.setCurrentSessionId(sessionBId);
    store.setStatus({ phase: 'thinking', message: 'Thinking...' }, sessionBId);
    store.setPendingMessage('Pending B', sessionBId);
    store.appendStreamingContent('Content B', sessionBId);
    store.addToolUsage({ name: 'tool-b', input: 'input-b' }, sessionBId);

    // Cleanup session A
    store.cleanupSessionState(sessionAId);

    // Verify session A state is cleaned
    const sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState?.status.phase).toBe('idle');
    expect(sessionAState?.pendingMessage).toBe('');
    expect(sessionAState?.streamingContent).toBe('');
    expect(sessionAState?.toolsUsed.length).toBe(0);

    // Verify session B state is unaffected
    store.setCurrentSessionId(sessionBId);
    let state = useInsightsStore.getState();
    expect(state.status.phase).toBe('thinking');
    expect(state.pendingMessage).toBe('Pending B');
    expect(state.streamingContent).toBe('Content B');
    expect(state.toolsUsed.length).toBe(1);
    expect(state.toolsUsed[0].name).toBe('tool-b');
  });

  it('should handle tool usage isolation between sessions', () => {
    const store = useInsightsStore.getState();

    // Create two sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    // Add tools to session A
    store.setCurrentSessionId(sessionAId);
    store.addToolUsage({ name: 'read-file', input: 'file1.txt' }, sessionAId);
    store.addToolUsage({ name: 'write-file', input: 'file2.txt' }, sessionAId);

    let state = useInsightsStore.getState();
    expect(state.toolsUsed.length).toBe(2);

    // Verify session A tools in sessionStates map
    let sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState?.toolsUsed.length).toBe(2);
    expect(sessionAState?.toolsUsed[0].name).toBe('read-file');
    expect(sessionAState?.toolsUsed[1].name).toBe('write-file');

    // Switch to session B and add different tools
    store.setCurrentSessionId(sessionBId);
    store.addToolUsage({ name: 'search', input: 'query' }, sessionBId);
    store.addToolUsage({ name: 'bash', input: 'ls -la' }, sessionBId);

    state = useInsightsStore.getState();
    expect(state.toolsUsed.length).toBe(2);
    expect(state.toolsUsed[0].name).toBe('search');

    // Verify session B tools in sessionStates map
    let sessionBState = store.getSessionState(sessionBId);
    expect(sessionBState?.toolsUsed.length).toBe(2);
    expect(sessionBState?.toolsUsed[0].name).toBe('search');
    expect(sessionBState?.toolsUsed[1].name).toBe('bash');

    // Clear tools in session B
    store.clearToolsUsed(sessionBId);

    state = useInsightsStore.getState();
    expect(state.toolsUsed.length).toBe(0);

    // Verify session B tools are cleared in sessionStates map
    sessionBState = store.getSessionState(sessionBId);
    expect(sessionBState?.toolsUsed.length).toBe(0);

    // Verify session A tools are still preserved in sessionStates map
    sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState?.toolsUsed.length).toBe(2);
    expect(sessionAState?.toolsUsed[0].name).toBe('read-file');
    expect(sessionAState?.toolsUsed[1].name).toBe('write-file');
  });

  it('should handle streaming content isolation during rapid switches', () => {
    const store = useInsightsStore.getState();

    // Create two sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    // Start streaming in session A
    store.setCurrentSessionId(sessionAId);
    store.appendStreamingContent('Hello ', sessionAId);
    store.appendStreamingContent('from ', sessionAId);
    store.appendStreamingContent('session A', sessionAId);

    let state = useInsightsStore.getState();
    expect(state.streamingContent).toBe('Hello from session A');

    // Verify session A streaming content in sessionStates map
    let sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState?.streamingContent).toBe('Hello from session A');

    // Switch to session B and start streaming
    store.setCurrentSessionId(sessionBId);
    store.clearStreamingContent(sessionBId);
    store.appendStreamingContent('Greetings ', sessionBId);
    store.appendStreamingContent('from ', sessionBId);
    store.appendStreamingContent('session B', sessionBId);

    state = useInsightsStore.getState();
    expect(state.streamingContent).toBe('Greetings from session B');

    // Verify session B streaming content in sessionStates map
    let sessionBState = store.getSessionState(sessionBId);
    expect(sessionBState?.streamingContent).toBe('Greetings from session B');

    // Verify session A streaming content is still preserved in sessionStates map
    sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState?.streamingContent).toBe('Hello from session A');

    // Verify streaming content is isolated between sessions
    expect(sessionAState?.streamingContent).not.toBe(sessionBState?.streamingContent);

    // Switch back to session A and clear its content
    store.setCurrentSessionId(sessionAId);
    store.clearStreamingContent(sessionAId);

    // Verify session A streaming content is cleared in sessionStates map
    sessionAState = store.getSessionState(sessionAId);
    expect(sessionAState?.streamingContent).toBe('');

    // Verify session B streaming content is still preserved in sessionStates map
    sessionBState = store.getSessionState(sessionBId);
    expect(sessionBState?.streamingContent).toBe('Greetings from session B');
  });
});
