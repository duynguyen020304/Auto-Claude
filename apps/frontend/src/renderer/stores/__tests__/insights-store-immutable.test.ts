import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useInsightsStore } from '../insights-store';

describe('InsightsStore - Map Immutability', () => {
  beforeEach(() => {
    // Reset store before each test
    useInsightsStore.getState().clearSession();
  });

  afterEach(() => {
    // Clean up after each test
    useInsightsStore.getState().clearSession();
  });

  describe('sessionStates Map updates', () => {
    it('should create new Map instance when setting session ID', () => {
      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().setCurrentSessionId('session-1');

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when setting session', () => {
      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().setSession({
        id: 'session-1',
        projectId: 'project-1',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when setting sessions list', () => {
      // First, add a session to the map
      useInsightsStore.getState().setCurrentSessionId('session-1');

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().setSessions([]);

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when updating status', () => {
      // Setup: create a session
      useInsightsStore.getState().setCurrentSessionId('session-1');

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().setStatus({ phase: 'thinking', message: 'Test' });

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when appending streaming content', () => {
      // Setup: create a session
      useInsightsStore.getState().setCurrentSessionId('session-1');

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().appendStreamingContent('test');

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when clearing streaming content', () => {
      // Setup: create a session and add streaming content
      useInsightsStore.getState().setCurrentSessionId('session-1');
      useInsightsStore.getState().appendStreamingContent('test');

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().clearStreamingContent();

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when setting current tool', () => {
      // Setup: create a session
      useInsightsStore.getState().setCurrentSessionId('session-1');

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().setCurrentTool({ name: 'test_tool' });

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when adding tool usage', () => {
      // Setup: create a session
      useInsightsStore.getState().setCurrentSessionId('session-1');

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().addToolUsage({ name: 'test_tool' });

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when clearing tools used', () => {
      // Setup: create a session and add tool usage
      useInsightsStore.getState().setCurrentSessionId('session-1');
      useInsightsStore.getState().addToolUsage({ name: 'test_tool' });

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().clearToolsUsed();

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when adding file mention', () => {
      // Setup: create a session
      useInsightsStore.getState().setCurrentSessionId('session-1');

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().addFileMention({ id: 'file-1', path: '/test' });

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when removing file mention', () => {
      // Setup: create a session and add file mention
      useInsightsStore.getState().setCurrentSessionId('session-1');
      useInsightsStore.getState().addFileMention({ id: 'file-1', path: '/test' });

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().removeFileMention('file-1');

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when clearing file mentions', () => {
      // Setup: create a session and add file mentions
      useInsightsStore.getState().setCurrentSessionId('session-1');
      useInsightsStore.getState().addFileMention({ id: 'file-1', path: '/test' });

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().clearFileMentions();

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when finalizing streaming message', () => {
      // Setup: create a session and add streaming content
      useInsightsStore.getState().setCurrentSessionId('session-1');
      useInsightsStore.getState().appendStreamingContent('test');

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().finalizeStreamingMessage();

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when aborting generation', () => {
      // Setup: create a session and add an abort controller
      useInsightsStore.getState().setCurrentSessionId('session-1');
      useInsightsStore.setState((state) => ({
        abortControllers: new Map(state.abortControllers).set('session-1', new AbortController())
      }));

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().abortGeneration('session-1');

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });

    it('should create new Map instance when cleaning up session state', () => {
      // Setup: create a session
      useInsightsStore.getState().setCurrentSessionId('session-1');

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.sessionStates;

      useInsightsStore.getState().cleanupSessionState('session-1');

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialMap);
    });
  });

  describe('generatingSessionIds Map updates', () => {
    it('should create new Map instance when setting sessions list', () => {
      // Setup: add a generating session
      useInsightsStore.setState((state) => ({
        generatingSessionIds: new Map(state.generatingSessionIds).set('project-1', 'session-1')
      }));

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.generatingSessionIds;

      useInsightsStore.getState().setSessions([]);

      const newState = useInsightsStore.getState();
      expect(newState.generatingSessionIds).not.toBe(initialMap);
    });

    it('should create new Map instance when aborting generation', () => {
      // Setup: add a generating session and abort controller
      useInsightsStore.setState((state) => ({
        generatingSessionIds: new Map(state.generatingSessionIds).set('project-1', 'session-1'),
        abortControllers: new Map(state.abortControllers).set('session-1', new AbortController())
      }));

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.generatingSessionIds;

      useInsightsStore.getState().abortGeneration('session-1');

      const newState = useInsightsStore.getState();
      expect(newState.generatingSessionIds).not.toBe(initialMap);
    });
  });

  describe('abortControllers Map updates', () => {
    it('should create new Map instance when setting sessions list', () => {
      // Setup: add an abort controller
      useInsightsStore.setState((state) => ({
        abortControllers: new Map(state.abortControllers).set('session-1', new AbortController())
      }));

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.abortControllers;

      useInsightsStore.getState().setSessions([]);

      const newState = useInsightsStore.getState();
      expect(newState.abortControllers).not.toBe(initialMap);
    });

    it('should create new Map instance when aborting generation', () => {
      // Setup: add an abort controller
      useInsightsStore.setState((state) => ({
        abortControllers: new Map(state.abortControllers).set('session-1', new AbortController())
      }));

      const initialState = useInsightsStore.getState();
      const initialMap = initialState.abortControllers;

      useInsightsStore.getState().abortGeneration('session-1');

      const newState = useInsightsStore.getState();
      expect(newState.abortControllers).not.toBe(initialMap);
    });
  });

  describe('clearSession resets all Maps', () => {
    it('should create new Map instances for all Maps when clearing session', () => {
      // Setup: create some state
      useInsightsStore.getState().setCurrentSessionId('session-1');
      useInsightsStore.setState((state) => ({
        generatingSessionIds: new Map(state.generatingSessionIds).set('project-1', 'session-1'),
        abortControllers: new Map(state.abortControllers).set('session-1', new AbortController())
      }));

      const initialState = useInsightsStore.getState();
      const initialSessionStates = initialState.sessionStates;
      const initialGeneratingIds = initialState.generatingSessionIds;
      const initialAbortControllers = initialState.abortControllers;

      useInsightsStore.getState().clearSession();

      const newState = useInsightsStore.getState();
      expect(newState.sessionStates).not.toBe(initialSessionStates);
      expect(newState.generatingSessionIds).not.toBe(initialGeneratingIds);
      expect(newState.abortControllers).not.toBe(initialAbortControllers);
    });
  });
});
