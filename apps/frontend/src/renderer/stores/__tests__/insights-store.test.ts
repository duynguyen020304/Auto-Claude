/**
 * Tests for insights-store actions
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { useInsightsStore } from '../insights-store';

describe('insights-store - resetStatus', () => {
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
