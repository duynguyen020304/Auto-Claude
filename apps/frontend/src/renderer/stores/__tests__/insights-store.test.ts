/**
 * Tests for insights-store actions
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useInsightsStore } from '../insights-store';

describe('insights-store - resetStatus', () => {
  beforeEach(() => {
    // Reset store state before each test in this suite
    useInsightsStore.getState().clearSession();
  });

  it('should reset status.phase to idle', () => {
    const store = useInsightsStore.getState();

    // Set status to complete
    store.setStatus({ phase: 'complete', message: '' });

    // Get fresh state and verify it's complete
    let updatedStore = useInsightsStore.getState();
    expect(updatedStore.status.phase).toBe('complete');

    // Reset status
    store.resetStatus();

    // Get fresh state and verify it's idle
    updatedStore = useInsightsStore.getState();
    expect(updatedStore.status.phase).toBe('idle');
    expect(updatedStore.status.message).toBe('');
  });

  it('should reset all terminal states to idle', () => {
    const store = useInsightsStore.getState();

    const terminalStates = [
      { phase: 'complete', message: '' },
      { phase: 'thinking', message: 'Processing...' },
      { phase: 'streaming', message: 'Receiving...' },
      { phase: 'error', error: 'Error occurred' }
    ] as const;

    terminalStates.forEach((status) => {
      // Set to terminal state
      store.setStatus(status);

      // Verify it was set
      let updatedStore = useInsightsStore.getState();
      expect(updatedStore.status.phase).toBe(status.phase);

      // Reset
      store.resetStatus();

      // Verify reset to idle
      updatedStore = useInsightsStore.getState();
      expect(updatedStore.status.phase).toBe('idle');
      expect(updatedStore.status.message).toBe('');
    });
  });

  it('should preserve other state when resetting status', () => {
    const store = useInsightsStore.getState();

    // Set various state
    store.setPendingMessage('test message');
    store.setStatus({ phase: 'complete', message: '' });

    // Verify pending message was set
    let updatedStore = useInsightsStore.getState();
    expect(updatedStore.pendingMessage).toBe('test message');

    // Reset status
    store.resetStatus();

    // Get fresh state
    updatedStore = useInsightsStore.getState();

    // Status should be idle
    expect(updatedStore.status.phase).toBe('idle');

    // Other state should be preserved
    expect(updatedStore.pendingMessage).toBe('test message');
  });
});

describe('insights-store - roadmap features', () => {
  beforeEach(() => {
    // Reset store state before each test in this suite
    useInsightsStore.getState().clearSession();
  });

  it('should add a roadmap feature to a session', () => {
    const store = useInsightsStore.getState();
    const sessionId = 'session-1';

    const feature = {
      id: 'feature-1',
      title: 'User Authentication',
      status: 'planned' as const,
      priority: 'must' as const,
      phaseId: 'phase-1'
    };

    // Add feature
    store.addRoadmapFeature(sessionId, feature);

    // Get fresh state and verify feature was added
    const updatedStore = useInsightsStore.getState();
    const features = updatedStore.getRoadmapFeatures(sessionId);

    expect(features).toBeDefined();
    expect(features).toHaveLength(1);
    expect(features?.[0]).toEqual(feature);
  });

  it('should add multiple roadmap features to a session', () => {
    const store = useInsightsStore.getState();
    const sessionId = 'session-1';

    const feature1 = {
      id: 'feature-1',
      title: 'User Authentication',
      status: 'planned' as const,
      priority: 'must' as const,
      phaseId: 'phase-1'
    };

    const feature2 = {
      id: 'feature-2',
      title: 'Database Integration',
      status: 'in_progress' as const,
      priority: 'should' as const
    };

    // Add features
    store.addRoadmapFeature(sessionId, feature1);
    store.addRoadmapFeature(sessionId, feature2);

    // Get fresh state and verify features were added
    const updatedStore = useInsightsStore.getState();
    const features = updatedStore.getRoadmapFeatures(sessionId);

    expect(features).toBeDefined();
    expect(features).toHaveLength(2);
    expect(features?.[0]).toEqual(feature1);
    expect(features?.[1]).toEqual(feature2);
  });

  it('should keep features separate for different sessions', () => {
    const store = useInsightsStore.getState();
    const session1 = 'session-1';
    const session2 = 'session-2';

    const feature1 = {
      id: 'feature-1',
      title: 'User Authentication',
      status: 'planned' as const,
      priority: 'must' as const
    };

    const feature2 = {
      id: 'feature-2',
      title: 'Database Integration',
      status: 'in_progress' as const,
      priority: 'should' as const
    };

    // Add features to different sessions
    store.addRoadmapFeature(session1, feature1);
    store.addRoadmapFeature(session2, feature2);

    // Get fresh state and verify features are separate
    const updatedStore = useInsightsStore.getState();
    const features1 = updatedStore.getRoadmapFeatures(session1);
    const features2 = updatedStore.getRoadmapFeatures(session2);

    expect(features1).toHaveLength(1);
    expect(features1?.[0].id).toBe('feature-1');

    expect(features2).toHaveLength(1);
    expect(features2?.[0].id).toBe('feature-2');
  });

  it('should return undefined for session with no features', () => {
    const store = useInsightsStore.getState();
    const sessionId = 'session-1';

    // Try to get features for session with no features
    const features = store.getRoadmapFeatures(sessionId);

    expect(features).toBeUndefined();
  });

  it('should clear roadmap features for a session', () => {
    const store = useInsightsStore.getState();
    const sessionId = 'session-1';

    const feature = {
      id: 'feature-1',
      title: 'User Authentication',
      status: 'planned' as const,
      priority: 'must' as const
    };

    // Add feature
    store.addRoadmapFeature(sessionId, feature);

    // Verify feature was added
    let updatedStore = useInsightsStore.getState();
    let features = updatedStore.getRoadmapFeatures(sessionId);
    expect(features).toHaveLength(1);

    // Clear features
    store.clearRoadmapFeatures(sessionId);

    // Verify features were cleared
    updatedStore = useInsightsStore.getState();
    features = updatedStore.getRoadmapFeatures(sessionId);
    expect(features).toBeUndefined();
  });

  it('should only clear features for the specified session', () => {
    const store = useInsightsStore.getState();
    const session1 = 'session-1';
    const session2 = 'session-2';

    const feature1 = {
      id: 'feature-1',
      title: 'User Authentication',
      status: 'planned' as const,
      priority: 'must' as const
    };

    const feature2 = {
      id: 'feature-2',
      title: 'Database Integration',
      status: 'in_progress' as const,
      priority: 'should' as const
    };

    // Add features to both sessions
    store.addRoadmapFeature(session1, feature1);
    store.addRoadmapFeature(session2, feature2);

    // Clear features for session1 only
    store.clearRoadmapFeatures(session1);

    // Verify session1 features are cleared but session2 are intact
    const updatedStore = useInsightsStore.getState();
    expect(updatedStore.getRoadmapFeatures(session1)).toBeUndefined();
    expect(updatedStore.getRoadmapFeatures(session2)).toHaveLength(1);
  });
});
