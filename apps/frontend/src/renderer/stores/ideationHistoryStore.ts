import { create } from 'zustand';
import type { IdeationHistory, IdeationHistoryCreate, IdeationHistoryUpdate } from '../../shared/types';

interface IdeationHistoryState {
  ideationHistories: IdeationHistory[];
  selectedIdeationId: number | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setIdeationHistories: (histories: IdeationHistory[] | ((prevHistories: IdeationHistory[]) => IdeationHistory[])) => void;
  addIdeationHistory: (history: IdeationHistory) => void;
  updateIdeationHistory: (ideationId: number, updates: Partial<IdeationHistory>) => void;
  deleteIdeationHistory: (ideationId: number) => void;
  selectIdeation: (ideationId: number | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearIdeationHistories: () => void;

  // Selectors
  getSelectedIdeation: () => IdeationHistory | undefined;
  getIdeationById: (ideationId: number) => IdeationHistory | undefined;
}

/**
 * Helper to find ideation history index by id.
 * Returns -1 if not found.
 */
function findIdeationHistoryIndex(histories: IdeationHistory[], ideationId: number): number {
  return histories.findIndex((h) => h.id === ideationId);
}

/**
 * Helper to update a single ideation history efficiently.
 * Uses slice instead of map to avoid iterating all histories.
 */
function updateIdeationHistoryAtIndex(
  histories: IdeationHistory[],
  index: number,
  updater: (history: IdeationHistory) => IdeationHistory
): IdeationHistory[] {
  if (index < 0 || index >= histories.length) return histories;

  const updatedHistory = updater(histories[index]);

  // If the history reference didn't change, return original array
  if (updatedHistory === histories[index]) {
    return histories;
  }

  // Create new array with only the changed history replaced
  const newHistories = [...histories];
  newHistories[index] = updatedHistory;

  return newHistories;
}

/**
 * Validates ideation history data structure before processing.
 * Returns true if valid, false if invalid.
 */
function validateIdeationHistoryData(history: IdeationHistoryCreate): boolean {
  // Validate title
  if (!history.title || typeof history.title !== 'string' || history.title.trim() === '') {
    console.warn('[validateIdeationHistoryData] Invalid ideation history: missing or empty title');
    return false;
  }

  // Validate content
  if (!history.content || typeof history.content !== 'string') {
    console.warn('[validateIdeationHistoryData] Invalid ideation history: missing or invalid content');
    return false;
  }

  // Validate tags array if provided
  if (history.tags !== undefined) {
    if (!Array.isArray(history.tags)) {
      console.warn('[validateIdeationHistoryData] Invalid ideation history: tags must be an array');
      return false;
    }

    // Validate each tag is a string
    for (let i = 0; i < history.tags.length; i++) {
      const tag = history.tags[i];
      if (typeof tag !== 'string') {
        console.warn(`[validateIdeationHistoryData] Invalid tag at index ${i}: not a string`);
        return false;
      }
    }
  }

  return true;
}

export const useIdeationHistoryStore = create<IdeationHistoryState>((set, get) => ({
  ideationHistories: [],
  selectedIdeationId: null,
  isLoading: false,
  error: null,

  setIdeationHistories: (histories) =>
    set((state) => ({
      ideationHistories: typeof histories === 'function' ? histories(state.ideationHistories) : histories
    })),

  addIdeationHistory: (history) =>
    set((state) => ({
      ideationHistories: [...state.ideationHistories, history]
    })),

  updateIdeationHistory: (ideationId, updates) =>
    set((state) => {
      const index = findIdeationHistoryIndex(state.ideationHistories, ideationId);
      if (index === -1) return state;

      return {
        ideationHistories: updateIdeationHistoryAtIndex(state.ideationHistories, index, (h) => ({
          ...h,
          ...updates,
          updated_at: new Date().toISOString()
        }))
      };
    }),

  deleteIdeationHistory: (ideationId) =>
    set((state) => ({
      ideationHistories: state.ideationHistories.filter((h) => h.id !== ideationId),
      // Clear selection if this ideation was selected
      selectedIdeationId: state.selectedIdeationId === ideationId ? null : state.selectedIdeationId
    })),

  selectIdeation: (ideationId) => set({ selectedIdeationId: ideationId }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearIdeationHistories: () => set({ ideationHistories: [], selectedIdeationId: null }),

  getSelectedIdeation: () => {
    const state = get();
    return state.ideationHistories.find((h) => h.id === state.selectedIdeationId);
  },

  getIdeationById: (ideationId) => {
    const state = get();
    return state.ideationHistories.find((h) => h.id === ideationId);
  }
}));

// ============================================
// Async Actions (Backend API Calls)
// ============================================

/**
 * Load all ideation histories for the authenticated user
 * @param queryParams - Optional query parameters for filtering, sorting, and pagination
 */
export async function loadIdeationHistories(
  queryParams?: {
    search?: string;
    date_start?: string;
    date_end?: string;
    sort?: 'newest' | 'oldest';
    page?: number;
    limit?: number;
  }
): Promise<void> {
  const store = useIdeationHistoryStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.getIdeationHistories(queryParams);

    if (result.success && result.data) {
      store.setIdeationHistories(result.data.items);
    } else {
      store.setError(result.error || 'Failed to load ideation histories');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Create a new ideation history
 * @param data - Ideation history creation data
 * @returns The created ideation history or null if failed
 */
export async function createIdeationHistory(data: IdeationHistoryCreate): Promise<IdeationHistory | null> {
  const store = useIdeationHistoryStore.getState();

  // Validate data before sending to backend
  if (!validateIdeationHistoryData(data)) {
    store.setError('Invalid ideation history data');
    return null;
  }

  try {
    const result = await window.electronAPI.createIdeationHistory(data);

    if (result.success && result.data) {
      store.addIdeationHistory(result.data);
      return result.data;
    } else {
      store.setError(result.error || 'Failed to create ideation history');
      return null;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Update an existing ideation history
 * @param ideationId - Ideation history ID to update
 * @param updates - Partial updates to apply
 * @returns True if successful, false otherwise
 */
export async function updateIdeationHistory(ideationId: number, updates: IdeationHistoryUpdate): Promise<boolean> {
  const store = useIdeationHistoryStore.getState();

  try {
    const result = await window.electronAPI.updateIdeationHistory(ideationId, updates);

    if (result.success && result.data) {
      // Update local state with the returned data
      store.updateIdeationHistory(ideationId, result.data);
      return true;
    } else {
      store.setError(result.error || 'Failed to update ideation history');
      return false;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

/**
 * Delete a ideation history
 * @param ideationId - Ideation history ID to delete
 * @returns True if successful, false otherwise
 */
export async function deleteIdeationHistory(ideationId: number): Promise<boolean> {
  const store = useIdeationHistoryStore.getState();

  try {
    const result = await window.electronAPI.deleteIdeationHistory(ideationId);

    if (result.success) {
      // Remove from local state
      store.deleteIdeationHistory(ideationId);
      return true;
    } else {
      store.setError(result.error || 'Failed to delete ideation history');
      return false;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

/**
 * Get a single ideation history by ID
 * Loads from backend if not in local state
 * @param ideationId - Ideation history ID
 * @returns The ideation history or undefined if not found
 */
export async function getIdeationHistory(ideationId: number): Promise<IdeationHistory | undefined> {
  const store = useIdeationHistoryStore.getState();

  // Check if already in local state
  const existingIdeation = store.getIdeationById(ideationId);
  if (existingIdeation) {
    return existingIdeation;
  }

  // Load from backend
  try {
    const result = await window.electronAPI.getIdeationHistory(ideationId);

    if (result.success && result.data) {
      // Add to local state
      store.addIdeationHistory(result.data);
      return result.data;
    } else {
      store.setError(result.error || 'Failed to load ideation history');
      return undefined;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return undefined;
  }
}
