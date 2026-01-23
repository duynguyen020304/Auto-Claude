/**
 * Tests for insights-store concurrent session state updates
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useInsightsStore } from '../insights-store';

describe('insights-store - concurrent session state updates', () => {
  beforeEach(() => {
    // Reset store state before each test
    useInsightsStore.getState().clearSession();
  });

  it('should handle concurrent status updates to different sessions', () => {
    const store = useInsightsStore.getState();

    // Setup two sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'thinking', message: 'Processing A' });

    store.setCurrentSessionId(sessionBId);
    store.setStatus({ phase: 'streaming', message: 'Streaming B' });

    // Update both sessions concurrently by specifying sessionId
    store.setStatus({ phase: 'complete', message: 'Done A' }, sessionAId);
    store.setStatus({ phase: 'error', message: 'Error B' }, sessionBId);

    // Verify both sessions updated correctly
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);

    expect(stateA?.status.phase).toBe('complete');
    expect(stateA?.status.message).toBe('Done A');

    expect(stateB?.status.phase).toBe('error');
    expect(stateB?.status.message).toBe('Error B');
  });

  it('should handle concurrent streaming content updates to different sessions', () => {
    const store = useInsightsStore.getState();

    // Setup two sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    store.setCurrentSessionId(sessionAId);
    store.appendStreamingContent('Start A ');

    store.setCurrentSessionId(sessionBId);
    store.appendStreamingContent('Start B ');

    // Simulate concurrent streaming by alternating updates
    store.appendStreamingContent('chunk 1A ', sessionAId);
    store.appendStreamingContent('chunk 1B ', sessionBId);
    store.appendStreamingContent('chunk 2A ', sessionAId);
    store.appendStreamingContent('chunk 2B ', sessionBId);
    store.appendStreamingContent('end A', sessionAId);
    store.appendStreamingContent('end B', sessionBId);

    // Verify both sessions have correct streaming content
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);

    expect(stateA?.streamingContent).toBe('Start A chunk 1A chunk 2A end A');
    expect(stateB?.streamingContent).toBe('Start B chunk 1B chunk 2B end B');
  });

  it('should handle concurrent tool updates to different sessions', () => {
    const store = useInsightsStore.getState();

    // Setup two sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    store.setCurrentSessionId(sessionAId);
    store.setCurrentTool({ name: 'tool-a-1', input: 'input-a-1' });
    store.addToolUsage({ name: 'tool-a-1', input: 'input-a-1' });

    store.setCurrentSessionId(sessionBId);
    store.setCurrentTool({ name: 'tool-b-1', input: 'input-b-1' });
    store.addToolUsage({ name: 'tool-b-1', input: 'input-b-1' });

    // Add more tools concurrently
    store.addToolUsage({ name: 'tool-a-2', input: 'input-a-2' }, sessionAId);
    store.addToolUsage({ name: 'tool-b-2', input: 'input-b-2' }, sessionBId);
    store.addToolUsage({ name: 'tool-a-3', input: 'input-a-3' }, sessionAId);

    // Switch tools concurrently
    store.setCurrentTool({ name: 'tool-a-current', input: 'input-a-current' }, sessionAId);
    store.setCurrentTool({ name: 'tool-b-current', input: 'input-b-current' }, sessionBId);

    // Verify both sessions have correct tool states
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);

    expect(stateA?.currentTool?.name).toBe('tool-a-current');
    expect(stateA?.toolsUsed).toHaveLength(3);
    expect(stateA?.toolsUsed[0].name).toBe('tool-a-1');
    expect(stateA?.toolsUsed[1].name).toBe('tool-a-2');
    expect(stateA?.toolsUsed[2].name).toBe('tool-a-3');

    expect(stateB?.currentTool?.name).toBe('tool-b-current');
    expect(stateB?.toolsUsed).toHaveLength(2);
    expect(stateB?.toolsUsed[0].name).toBe('tool-b-1');
    expect(stateB?.toolsUsed[1].name).toBe('tool-b-2');
  });

  it('should handle concurrent file mention updates to different sessions', () => {
    const store = useInsightsStore.getState();

    // Setup two sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    store.setCurrentSessionId(sessionAId);
    store.addFileMention({ id: 'file-1', filePath: '/path/to/file1.ts' });

    store.setCurrentSessionId(sessionBId);
    store.addFileMention({ id: 'file-2', filePath: '/path/to/file2.ts' });

    // Add more file mentions concurrently
    store.addFileMention({ id: 'file-3', filePath: '/path/to/file3.ts' }, sessionAId);
    store.addFileMention({ id: 'file-4', filePath: '/path/to/file4.ts' }, sessionBId);
    store.addFileMention({ id: 'file-5', filePath: '/path/to/file5.ts' }, sessionAId);

    // Verify both sessions have correct file mentions
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);

    expect(stateA?.fileMentions).toHaveLength(3);
    expect(stateA?.fileMentions.map((f) => f.id)).toEqual(['file-1', 'file-3', 'file-5']);

    expect(stateB?.fileMentions).toHaveLength(2);
    expect(stateB?.fileMentions.map((f) => f.id)).toEqual(['file-2', 'file-4']);
  });

  it('should handle rapid concurrent updates without data loss', () => {
    const store = useInsightsStore.getState();

    // Setup three sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';
    const sessionCId = 'session-c';

    store.setCurrentSessionId(sessionAId);
    store.setCurrentSessionId(sessionBId);
    store.setCurrentSessionId(sessionCId);

    // Perform rapid concurrent updates
    for (let i = 0; i < 10; i++) {
      store.appendStreamingContent(`A${i} `, sessionAId);
      store.appendStreamingContent(`B${i} `, sessionBId);
      store.appendStreamingContent(`C${i} `, sessionCId);
      store.addToolUsage({ name: `tool-a-${i}`, input: `input-a-${i}` }, sessionAId);
      store.addToolUsage({ name: `tool-b-${i}`, input: `input-b-${i}` }, sessionBId);
      store.addToolUsage({ name: `tool-c-${i}`, input: `input-c-${i}` }, sessionCId);
    }

    // Verify all updates persisted correctly
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);
    const stateC = store.getSessionState(sessionCId);

    expect(stateA?.streamingContent).toContain('A0 ');
    expect(stateA?.streamingContent).toContain('A9 ');
    expect(stateA?.toolsUsed).toHaveLength(10);

    expect(stateB?.streamingContent).toContain('B0 ');
    expect(stateB?.streamingContent).toContain('B9 ');
    expect(stateB?.toolsUsed).toHaveLength(10);

    expect(stateC?.streamingContent).toContain('C0 ');
    expect(stateC?.streamingContent).toContain('C9 ');
    expect(stateC?.toolsUsed).toHaveLength(10);
  });

  it('should handle concurrent mixed operations on different sessions', () => {
    const store = useInsightsStore.getState();

    // Setup two sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    store.setCurrentSessionId(sessionAId);
    store.setCurrentSessionId(sessionBId);

    // Perform mixed operations concurrently
    store.setStatus({ phase: 'thinking', message: 'Thinking A' }, sessionAId);
    store.appendStreamingContent('Streaming B', sessionBId);
    store.setPendingMessage('Pending A', sessionAId);
    store.setCurrentTool({ name: 'tool-b', input: 'input-b' }, sessionBId);
    store.addFileMention({ id: 'file-1', filePath: '/file1.ts' }, sessionAId);
    store.setStatus({ phase: 'streaming', message: 'Streaming B' }, sessionBId);
    store.appendStreamingContent('Streaming A', sessionAId);
    store.setPendingMessage('Pending B', sessionBId);
    store.setCurrentTool({ name: 'tool-a', input: 'input-a' }, sessionAId);
    store.addFileMention({ id: 'file-2', filePath: '/file2.ts' }, sessionBId);

    // Verify all states are correct
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);

    expect(stateA?.status.phase).toBe('thinking');
    expect(stateA?.status.message).toBe('Thinking A');
    expect(stateA?.pendingMessage).toBe('Pending A');
    expect(stateA?.streamingContent).toBe('Streaming A');
    expect(stateA?.currentTool?.name).toBe('tool-a');
    expect(stateA?.fileMentions).toHaveLength(1);
    expect(stateA?.fileMentions[0].id).toBe('file-1');

    expect(stateB?.status.phase).toBe('streaming');
    expect(stateB?.status.message).toBe('Streaming B');
    expect(stateB?.pendingMessage).toBe('Pending B');
    expect(stateB?.streamingContent).toBe('Streaming B');
    expect(stateB?.currentTool?.name).toBe('tool-b');
    expect(stateB?.fileMentions).toHaveLength(1);
    expect(stateB?.fileMentions[0].id).toBe('file-2');
  });

  it('should handle concurrent clears and resets without affecting other sessions', () => {
    const store = useInsightsStore.getState();

    // Setup two sessions with state
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'streaming', message: 'Streaming A' });
    store.appendStreamingContent('Content A');
    store.setPendingMessage('Pending A');
    store.addToolUsage({ name: 'tool-a', input: 'input-a' });

    store.setCurrentSessionId(sessionBId);
    store.setStatus({ phase: 'thinking', message: 'Thinking B' });
    store.appendStreamingContent('Content B');
    store.setPendingMessage('Pending B');
    store.addToolUsage({ name: 'tool-b', input: 'input-b' });

    // Clear streaming content for session A while session B is current
    store.clearStreamingContent(sessionAId);

    // Clear tools for session B while session A is current
    store.clearToolsUsed(sessionBId);

    // Verify clears only affected their respective sessions
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);

    expect(stateA?.streamingContent).toBe('');
    expect(stateA?.status.phase).toBe('streaming');
    expect(stateA?.pendingMessage).toBe('Pending A');
    expect(stateA?.toolsUsed).toHaveLength(1);

    expect(stateB?.streamingContent).toBe('Content B');
    expect(stateB?.status.phase).toBe('thinking');
    expect(stateB?.pendingMessage).toBe('Pending B');
    expect(stateB?.toolsUsed).toHaveLength(0);
  });

  it('should handle concurrent finalize operations on different sessions', () => {
    const store = useInsightsStore.getState();

    // Setup two sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    const sessionA = {
      id: sessionAId,
      projectId: 'proj-1',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const sessionB = {
      id: sessionBId,
      projectId: 'proj-1',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    store.setSession(sessionA);
    store.appendStreamingContent('Final content A');
    store.addToolUsage({ name: 'tool-a', input: 'input-a' });

    store.setSession(sessionB);
    store.appendStreamingContent('Final content B');
    store.addToolUsage({ name: 'tool-b', input: 'input-b' });

    // Finalize both sessions
    store.finalizeStreamingMessage(undefined, sessionAId);
    store.finalizeStreamingMessage(undefined, sessionBId);

    // Verify both sessions finalized correctly
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);

    expect(stateA?.streamingContent).toBe('');
    expect(stateA?.toolsUsed).toHaveLength(0);

    expect(stateB?.streamingContent).toBe('');
    expect(stateB?.toolsUsed).toHaveLength(0);

    // Verify only the current session's message was added to state.session
    // Session A is not the current session, so its message was not added
    // Session B is the current session, so only its message was added
    const storeState = useInsightsStore.getState();
    expect(storeState.session?.messages).toHaveLength(1);
    expect(storeState.session?.messages[0].content).toBe('Final content B');
    expect(storeState.session?.messages[0].toolsUsed).toHaveLength(1);
    expect(storeState.session?.messages[0].toolsUsed?.[0].name).toBe('tool-b');
  });

  it('should handle concurrent session cleanup without affecting other sessions', () => {
    const store = useInsightsStore.getState();

    // Setup three sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';
    const sessionCId = 'session-c';

    store.setCurrentSessionId(sessionAId);
    store.setStatus({ phase: 'streaming', message: 'Streaming A' });
    store.appendStreamingContent('Content A');
    store.setPendingMessage('Pending A');
    store.addToolUsage({ name: 'tool-a', input: 'input-a' });
    store.addFileMention({ id: 'file-1', filePath: '/file1.ts' });

    store.setCurrentSessionId(sessionBId);
    store.setStatus({ phase: 'thinking', message: 'Thinking B' });
    store.appendStreamingContent('Content B');
    store.setPendingMessage('Pending B');
    store.addToolUsage({ name: 'tool-b', input: 'input-b' });
    store.addFileMention({ id: 'file-2', filePath: '/file2.ts' });

    store.setCurrentSessionId(sessionCId);
    store.setStatus({ phase: 'complete', message: 'Complete C' });
    store.appendStreamingContent('Content C');
    store.setPendingMessage('Pending C');
    store.addToolUsage({ name: 'tool-c', input: 'input-c' });
    store.addFileMention({ id: 'file-3', filePath: '/file3.ts' });

    // Cleanup session B
    store.cleanupSessionState(sessionBId);

    // Verify session B was cleaned up but A and C are unaffected
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);
    const stateC = store.getSessionState(sessionCId);

    expect(stateA?.status.phase).toBe('streaming');
    expect(stateA?.streamingContent).toBe('Content A');
    expect(stateA?.pendingMessage).toBe('Pending A');
    expect(stateA?.toolsUsed).toHaveLength(1);
    expect(stateA?.fileMentions).toHaveLength(1);

    expect(stateB?.status.phase).toBe('idle');
    expect(stateB?.streamingContent).toBe('');
    expect(stateB?.pendingMessage).toBe('');
    expect(stateB?.toolsUsed).toHaveLength(0);
    expect(stateB?.fileMentions).toHaveLength(0);

    expect(stateC?.status.phase).toBe('complete');
    expect(stateC?.streamingContent).toBe('Content C');
    expect(stateC?.pendingMessage).toBe('Pending C');
    expect(stateC?.toolsUsed).toHaveLength(1);
    expect(stateC?.fileMentions).toHaveLength(1);
  });

  it('should handle concurrent file add and remove operations', () => {
    const store = useInsightsStore.getState();

    // Setup two sessions
    const sessionAId = 'session-a';
    const sessionBId = 'session-b';

    store.setCurrentSessionId(sessionAId);
    store.addFileMention({ id: 'file-1', filePath: '/file1.ts' });
    store.addFileMention({ id: 'file-2', filePath: '/file2.ts' });
    store.addFileMention({ id: 'file-3', filePath: '/file3.ts' });

    store.setCurrentSessionId(sessionBId);
    store.addFileMention({ id: 'file-4', filePath: '/file4.ts' });
    store.addFileMention({ id: 'file-5', filePath: '/file5.ts' });

    // Perform concurrent adds and removes
    store.addFileMention({ id: 'file-6', filePath: '/file6.ts' }, sessionAId);
    store.removeFileMention('file-2', sessionAId);
    store.addFileMention({ id: 'file-7', filePath: '/file7.ts' }, sessionBId);
    store.removeFileMention('file-5', sessionBId);
    store.addFileMention({ id: 'file-8', filePath: '/file8.ts' }, sessionAId);
    store.removeFileMention('file-1', sessionAId);

    // Verify final states
    const stateA = store.getSessionState(sessionAId);
    const stateB = store.getSessionState(sessionBId);

    expect(stateA?.fileMentions.map((f) => f.id)).toEqual(['file-3', 'file-6', 'file-8']);
    expect(stateB?.fileMentions.map((f) => f.id)).toEqual(['file-4', 'file-7']);
  });
});
