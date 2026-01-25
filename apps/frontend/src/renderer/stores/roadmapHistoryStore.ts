import { create } from 'zustand';
import type { RoadmapHistory, RoadmapHistoryCreate, RoadmapHistoryUpdate } from '../../shared/types';

interface RoadmapHistoryState {
  roadmapHistories: RoadmapHistory[];
  selectedRoadmapId: number | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setRoadmapHistories: (histories: RoadmapHistory[] | ((prevHistories: RoadmapHistory[]) => RoadmapHistory[])) => void;
  addRoadmapHistory: (history: RoadmapHistory) => void;
  updateRoadmapHistory: (roadmapId: number, updates: Partial<RoadmapHistory>) => void;
  deleteRoadmapHistory: (roadmapId: number) => void;
  selectRoadmap: (roadmapId: number | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearRoadmapHistories: () => void;

  // Selectors
  getSelectedRoadmap: () => RoadmapHistory | undefined;
  getRoadmapById: (roadmapId: number) => RoadmapHistory | undefined;
}

/**
 * Helper to find roadmap history index by id.
 * Returns -1 if not found.
 */
function findRoadmapHistoryIndex(histories: RoadmapHistory[], roadmapId: number): number {
  return histories.findIndex((h) => h.id === roadmapId);
}

/**
 * Helper to update a single roadmap history efficiently.
 * Uses slice instead of map to avoid iterating all histories.
 */
function updateRoadmapHistoryAtIndex(
  histories: RoadmapHistory[],
  index: number,
  updater: (history: RoadmapHistory) => RoadmapHistory
): RoadmapHistory[] {
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
 * Validates roadmap history data structure before processing.
 * Returns true if valid, false if invalid.
 */
function validateRoadmapHistoryData(history: RoadmapHistoryCreate): boolean {
  // Validate title
  if (!history.title || typeof history.title !== 'string' || history.title.trim() === '') {
    console.warn('[validateRoadmapHistoryData] Invalid roadmap history: missing or empty title');
    return false;
  }

  // Validate version
  if (!history.version || typeof history.version !== 'string' || history.version.trim() === '') {
    console.warn('[validateRoadmapHistoryData] Invalid roadmap history: missing or empty version');
    return false;
  }

  // Validate content
  if (!history.content || typeof history.content !== 'string') {
    console.warn('[validateRoadmapHistoryData] Invalid roadmap history: missing or invalid content');
    return false;
  }

  return true;
}

export const useRoadmapHistoryStore = create<RoadmapHistoryState>((set, get) => ({
  roadmapHistories: [],
  selectedRoadmapId: null,
  isLoading: false,
  error: null,

  setRoadmapHistories: (histories) =>
    set((state) => ({
      roadmapHistories: typeof histories === 'function' ? histories(state.roadmapHistories) : histories
    })),

  addRoadmapHistory: (history) =>
    set((state) => ({
      roadmapHistories: [...state.roadmapHistories, history]
    })),

  updateRoadmapHistory: (roadmapId, updates) =>
    set((state) => {
      const index = findRoadmapHistoryIndex(state.roadmapHistories, roadmapId);
      if (index === -1) return state;

      return {
        roadmapHistories: updateRoadmapHistoryAtIndex(state.roadmapHistories, index, (h) => ({
          ...h,
          ...updates,
          updated_at: new Date().toISOString()
        }))
      };
    }),

  deleteRoadmapHistory: (roadmapId) =>
    set((state) => ({
      roadmapHistories: state.roadmapHistories.filter((h) => h.id !== roadmapId),
      // Clear selection if this roadmap was selected
      selectedRoadmapId: state.selectedRoadmapId === roadmapId ? null : state.selectedRoadmapId
    })),

  selectRoadmap: (roadmapId) => set({ selectedRoadmapId: roadmapId }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearRoadmapHistories: () => set({ roadmapHistories: [], selectedRoadmapId: null }),

  getSelectedRoadmap: () => {
    const state = get();
    return state.roadmapHistories.find((h) => h.id === state.selectedRoadmapId);
  },

  getRoadmapById: (roadmapId) => {
    const state = get();
    return state.roadmapHistories.find((h) => h.id === roadmapId);
  }
}));

// ============================================
// Async Actions (Backend API Calls)
// ============================================

/**
 * Load all roadmap histories for the authenticated user
 * @param queryParams - Optional query parameters for filtering, sorting, and pagination
 */
export async function loadRoadmapHistories(
  queryParams?: {
    search?: string;
    date_start?: string;
    date_end?: string;
    sort?: 'newest' | 'oldest';
    page?: number;
    limit?: number;
  }
): Promise<void> {
  const store = useRoadmapHistoryStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.getRoadmapHistories(queryParams);

    if (result.success && result.data) {
      store.setRoadmapHistories(result.data.items);
    } else {
      store.setError(result.error || 'Failed to load roadmap histories');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Create a new roadmap history
 * @param data - Roadmap history creation data
 * @returns The created roadmap history or null if failed
 */
export async function createRoadmapHistory(data: RoadmapHistoryCreate): Promise<RoadmapHistory | null> {
  const store = useRoadmapHistoryStore.getState();

  // Validate data before sending to backend
  if (!validateRoadmapHistoryData(data)) {
    store.setError('Invalid roadmap history data');
    return null;
  }

  try {
    const result = await window.electronAPI.createRoadmapHistory(data);

    if (result.success && result.data) {
      store.addRoadmapHistory(result.data);
      return result.data;
    } else {
      store.setError(result.error || 'Failed to create roadmap history');
      return null;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Update an existing roadmap history
 * @param roadmapId - Roadmap history ID to update
 * @param updates - Partial updates to apply
 * @returns True if successful, false otherwise
 */
export async function updateRoadmapHistory(roadmapId: number, updates: RoadmapHistoryUpdate): Promise<boolean> {
  const store = useRoadmapHistoryStore.getState();

  try {
    const result = await window.electronAPI.updateRoadmapHistory(roadmapId, updates);

    if (result.success && result.data) {
      // Update local state with the returned data
      store.updateRoadmapHistory(roadmapId, result.data);
      return true;
    } else {
      store.setError(result.error || 'Failed to update roadmap history');
      return false;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

/**
 * Delete a roadmap history
 * @param roadmapId - Roadmap history ID to delete
 * @returns True if successful, false otherwise
 */
export async function deleteRoadmapHistory(roadmapId: number): Promise<boolean> {
  const store = useRoadmapHistoryStore.getState();

  try {
    const result = await window.electronAPI.deleteRoadmapHistory(roadmapId);

    if (result.success) {
      // Remove from local state
      store.deleteRoadmapHistory(roadmapId);
      return true;
    } else {
      store.setError(result.error || 'Failed to delete roadmap history');
      return false;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

/**
 * Get a single roadmap history by ID
 * Loads from backend if not in local state
 * @param roadmapId - Roadmap history ID
 * @returns The roadmap history or undefined if not found
 */
export async function getRoadmapHistory(roadmapId: number): Promise<RoadmapHistory | undefined> {
  const store = useRoadmapHistoryStore.getState();

  // Check if already in local state
  const existingRoadmap = store.getRoadmapById(roadmapId);
  if (existingRoadmap) {
    return existingRoadmap;
  }

  // Load from backend
  try {
    const result = await window.electronAPI.getRoadmapHistory(roadmapId);

    if (result.success && result.data) {
      // Add to local state
      store.addRoadmapHistory(result.data);
      return result.data;
    } else {
      store.setError(result.error || 'Failed to load roadmap history');
      return undefined;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return undefined;
  }
}
