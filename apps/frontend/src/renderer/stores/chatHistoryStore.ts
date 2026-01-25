import { create } from 'zustand';
import type { ChatHistory, ChatHistoryCreate, ChatHistoryUpdate, Message } from '../../shared/types';

interface ChatHistoryState {
  chatHistories: ChatHistory[];
  selectedChatId: number | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setChatHistories: (histories: ChatHistory[] | ((prevHistories: ChatHistory[]) => ChatHistory[])) => void;
  addChatHistory: (history: ChatHistory) => void;
  updateChatHistory: (chatId: number, updates: Partial<ChatHistory>) => void;
  deleteChatHistory: (chatId: number) => void;
  selectChat: (chatId: number | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearChatHistories: () => void;

  // Selectors
  getSelectedChat: () => ChatHistory | undefined;
  getChatById: (chatId: number) => ChatHistory | undefined;
}

/**
 * Helper to find chat history index by id.
 * Returns -1 if not found.
 */
function findChatHistoryIndex(histories: ChatHistory[], chatId: number): number {
  return histories.findIndex((h) => h.id === chatId);
}

/**
 * Helper to update a single chat history efficiently.
 * Uses slice instead of map to avoid iterating all histories.
 */
function updateChatHistoryAtIndex(
  histories: ChatHistory[],
  index: number,
  updater: (history: ChatHistory) => ChatHistory
): ChatHistory[] {
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
 * Validates chat history data structure before processing.
 * Returns true if valid, false if invalid.
 */
function validateChatHistoryData(history: ChatHistoryCreate): boolean {
  // Validate title
  if (!history.title || typeof history.title !== 'string' || history.title.trim() === '') {
    console.warn('[validateChatHistoryData] Invalid chat history: missing or empty title');
    return false;
  }

  // Validate messages array
  if (!history.messages || !Array.isArray(history.messages)) {
    console.warn('[validateChatHistoryData] Invalid chat history: missing or invalid messages array');
    return false;
  }

  // Validate each message
  for (let i = 0; i < history.messages.length; i++) {
    const message = history.messages[i];
    if (!message || typeof message !== 'object') {
      console.warn(`[validateChatHistoryData] Invalid message at index ${i}: not an object`);
      return false;
    }

    // Validate role
    if (message.role !== 'user' && message.role !== 'assistant') {
      console.warn(`[validateChatHistoryData] Invalid message at index ${i}: invalid role "${message.role}"`);
      return false;
    }

    // Validate content
    if (!message.content || typeof message.content !== 'string') {
      console.warn(`[validateChatHistoryData] Invalid message at index ${i}: missing or invalid content`);
      return false;
    }
  }

  return true;
}

export const useChatHistoryStore = create<ChatHistoryState>((set, get) => ({
  chatHistories: [],
  selectedChatId: null,
  isLoading: false,
  error: null,

  setChatHistories: (histories) =>
    set((state) => ({
      chatHistories: typeof histories === 'function' ? histories(state.chatHistories) : histories
    })),

  addChatHistory: (history) =>
    set((state) => ({
      chatHistories: [...state.chatHistories, history]
    })),

  updateChatHistory: (chatId, updates) =>
    set((state) => {
      const index = findChatHistoryIndex(state.chatHistories, chatId);
      if (index === -1) return state;

      return {
        chatHistories: updateChatHistoryAtIndex(state.chatHistories, index, (h) => ({
          ...h,
          ...updates,
          updated_at: new Date().toISOString()
        }))
      };
    }),

  deleteChatHistory: (chatId) =>
    set((state) => ({
      chatHistories: state.chatHistories.filter((h) => h.id !== chatId),
      // Clear selection if this chat was selected
      selectedChatId: state.selectedChatId === chatId ? null : state.selectedChatId
    })),

  selectChat: (chatId) => set({ selectedChatId: chatId }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearChatHistories: () => set({ chatHistories: [], selectedChatId: null }),

  getSelectedChat: () => {
    const state = get();
    return state.chatHistories.find((h) => h.id === state.selectedChatId);
  },

  getChatById: (chatId) => {
    const state = get();
    return state.chatHistories.find((h) => h.id === chatId);
  }
}));

// ============================================
// Async Actions (Backend API Calls)
// ============================================

/**
 * Load all chat histories for the authenticated user
 * @param queryParams - Optional query parameters for filtering, sorting, and pagination
 */
export async function loadChatHistories(
  queryParams?: {
    search?: string;
    date_start?: string;
    date_end?: string;
    sort?: 'newest' | 'oldest';
    page?: number;
    limit?: number;
  }
): Promise<void> {
  const store = useChatHistoryStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.getChatHistories(queryParams);

    if (result.success && result.data) {
      store.setChatHistories(result.data.items);
    } else {
      store.setError(result.error || 'Failed to load chat histories');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Create a new chat history
 * @param data - Chat history creation data
 * @returns The created chat history or null if failed
 */
export async function createChatHistory(data: ChatHistoryCreate): Promise<ChatHistory | null> {
  const store = useChatHistoryStore.getState();

  // Validate data before sending to backend
  if (!validateChatHistoryData(data)) {
    store.setError('Invalid chat history data');
    return null;
  }

  try {
    const result = await window.electronAPI.createChatHistory(data);

    if (result.success && result.data) {
      store.addChatHistory(result.data);
      return result.data;
    } else {
      store.setError(result.error || 'Failed to create chat history');
      return null;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Update an existing chat history
 * @param chatId - Chat history ID to update
 * @param updates - Partial updates to apply
 * @returns True if successful, false otherwise
 */
export async function updateChatHistory(chatId: number, updates: ChatHistoryUpdate): Promise<boolean> {
  const store = useChatHistoryStore.getState();

  try {
    const result = await window.electronAPI.updateChatHistory(chatId, updates);

    if (result.success && result.data) {
      // Update local state with the returned data
      store.updateChatHistory(chatId, result.data);
      return true;
    } else {
      store.setError(result.error || 'Failed to update chat history');
      return false;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

/**
 * Delete a chat history
 * @param chatId - Chat history ID to delete
 * @returns True if successful, false otherwise
 */
export async function deleteChatHistory(chatId: number): Promise<boolean> {
  const store = useChatHistoryStore.getState();

  try {
    const result = await window.electronAPI.deleteChatHistory(chatId);

    if (result.success) {
      // Remove from local state
      store.deleteChatHistory(chatId);
      return true;
    } else {
      store.setError(result.error || 'Failed to delete chat history');
      return false;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

/**
 * Add a message to a chat history
 * Convenience function that fetches the current chat, appends the message, and updates it
 * @param chatId - Chat history ID
 * @param message - Message to add
 * @returns True if successful, false otherwise
 */
export async function addMessageToChat(chatId: number, message: Message): Promise<boolean> {
  const store = useChatHistoryStore.getState();
  const chat = store.getChatById(chatId);

  if (!chat) {
    store.setError('Chat history not found');
    return false;
  }

  // Validate message
  if (!message.role || !message.content || (message.role !== 'user' && message.role !== 'assistant')) {
    store.setError('Invalid message data');
    return false;
  }

  // Create updated messages array with timestamp
  const updatedMessages: Message[] = [
    ...chat.messages,
    {
      ...message,
      timestamp: message.timestamp || new Date().toISOString()
    }
  ];

  return updateChatHistory(chatId, { messages: updatedMessages });
}

/**
 * Get a single chat history by ID
 * Loads from backend if not in local state
 * @param chatId - Chat history ID
 * @returns The chat history or undefined if not found
 */
export async function getChatHistory(chatId: number): Promise<ChatHistory | undefined> {
  const store = useChatHistoryStore.getState();

  // Check if already in local state
  const existingChat = store.getChatById(chatId);
  if (existingChat) {
    return existingChat;
  }

  // Load from backend
  try {
    const result = await window.electronAPI.getChatHistory(chatId);

    if (result.success && result.data) {
      // Add to local state
      store.addChatHistory(result.data);
      return result.data;
    } else {
      store.setError(result.error || 'Failed to load chat history');
      return undefined;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return undefined;
  }
}
