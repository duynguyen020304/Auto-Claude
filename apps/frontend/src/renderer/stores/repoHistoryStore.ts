import { create } from 'zustand';
import type { RepoHistory, RepoHistoryCreate, RepoHistoryUpdate, RepoHistoryListResponse, HistoryQueryParams } from '../../shared/types';

interface RepoHistoryState {
  // State
  items: RepoHistory[];
  selectedId: number | null;
  isLoading: boolean;
  error: string | null;
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  } | null;

  // Actions
  setItems: (items: RepoHistory[] | ((prevItems: RepoHistory[]) => RepoHistory[])) => void;
  addItem: (item: RepoHistory) => void;
  updateItem: (id: number, updates: Partial<RepoHistory>) => void;
  removeItem: (id: number) => void;
  selectItem: (id: number | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setPagination: (pagination: { total: number; page: number; limit: number; hasMore: boolean }) => void;
  clearItems: () => void;
  clearError: () => void;

  // Selectors
  getSelectedItem: () => RepoHistory | undefined;
  getItemById: (id: number) => RepoHistory | undefined;
  getItemsByRepoName: (repoName: string) => RepoHistory[];
  getItemsByInteractionType: (interactionType: string) => RepoHistory[];
}

/**
 * Helper to find item index by id
 * Returns -1 if not found
 */
function findItemIndex(items: RepoHistory[], id: number): number {
  return items.findIndex((item) => item.id === id);
}

/**
 * Helper to update a single item efficiently
 * Uses slice instead of map to avoid iterating all items
 */
function updateItemAtIndex(items: RepoHistory[], index: number, updater: (item: RepoHistory) => RepoHistory): RepoHistory[] {
  if (index < 0 || index >= items.length) return items;

  const updatedItem = updater(items[index]);

  // If the item reference didn't change, return original array
  if (updatedItem === items[index]) {
    return items;
  }

  // Create new array with only the changed item replaced
  const newItems = [...items];
  newItems[index] = updatedItem;

  return newItems;
}

export const useRepoHistoryStore = create<RepoHistoryState>((set, get) => ({
  items: [],
  selectedId: null,
  isLoading: false,
  error: null,
  pagination: null,

  setItems: (items) =>
    set((state) => ({
      items: typeof items === 'function' ? items(state.items) : items
    })),

  addItem: (item) =>
    set((state) => ({
      items: [...state.items, item]
    })),

  updateItem: (id, updates) =>
    set((state) => {
      const index = findItemIndex(state.items, id);
      if (index === -1) return state;

      return {
        items: updateItemAtIndex(state.items, index, (item) => ({ ...item, ...updates }))
      };
    }),

  removeItem: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId
    })),

  selectItem: (id) => set({ selectedId: id }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  setPagination: (pagination) => set({ pagination }),

  clearItems: () => set({ items: [], selectedId: null, pagination: null }),

  clearError: () => set({ error: null }),

  getSelectedItem: () => {
    const state = get();
    return state.items.find((item) => item.id === state.selectedId);
  },

  getItemById: (id) => {
    const state = get();
    return state.items.find((item) => item.id === id);
  },

  getItemsByRepoName: (repoName) => {
    const state = get();
    return state.items.filter((item) => item.repo_name === repoName);
  },

  getItemsByInteractionType: (interactionType) => {
    const state = get();
    return state.items.filter((item) => item.interaction_type === interactionType);
  }
}));

// ============================================
// API Functions
// ============================================
// NOTE: IPC handlers will be implemented in a later subtask
// These functions are stubs that will be connected to the backend

/**
 * Load repo history items with optional filtering
 * TODO: Connect to IPC handler when implemented
 */
export async function loadRepoHistory(_params?: HistoryQueryParams): Promise<void> {
  // Stub implementation - will be connected to IPC in later subtask
}

/**
 * Create a new repo history item
 * TODO: Connect to IPC handler when implemented
 */
export async function createRepoHistory(_data: RepoHistoryCreate): Promise<RepoHistory | null> {
  // Stub implementation - will be connected to IPC in later subtask
  return null;
}

/**
 * Update a repo history item
 * TODO: Connect to IPC handler when implemented
 */
export async function updateRepoHistory(_id: number, _updates: RepoHistoryUpdate): Promise<boolean> {
  // Stub implementation - will be connected to IPC in later subtask
  return false;
}

/**
 * Delete a repo history item
 * TODO: Connect to IPC handler when implemented
 */
export async function deleteRepoHistory(_id: number): Promise<boolean> {
  // Stub implementation - will be connected to IPC in later subtask
  return false;
}

/**
 * Load more items (pagination)
 * TODO: Connect to IPC handler when implemented
 */
export async function loadMoreRepoHistory(_params?: HistoryQueryParams): Promise<void> {
  // Stub implementation - will be connected to IPC in later subtask
}

/**
 * Refresh repo history (reload current page)
 * TODO: Connect to IPC handler when implemented
 */
export async function refreshRepoHistory(_params?: HistoryQueryParams): Promise<void> {
  // Stub implementation - will be connected to IPC in later subtask
}
