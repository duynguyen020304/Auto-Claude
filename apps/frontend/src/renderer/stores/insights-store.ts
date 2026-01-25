import { create } from 'zustand';
import type {
  InsightsSession,
  InsightsSessionSummary,
  InsightsChatMessage,
  InsightsChatStatus,
  InsightsStreamChunk,
  InsightsToolUsage,
  InsightsModelConfig,
  TaskMetadata,
  Task,
} from '../../shared/types';

interface ToolUsage {
  name: string;
  input?: string;
}

// Per-session streaming state
export interface InsightsSessionState {
  status: InsightsChatStatus;
  pendingMessage: string;
  streamingContent: string;
  currentTool: ToolUsage | null;
  toolsUsed: InsightsToolUsage[];
}

interface InsightsState {
  // Data
  currentSessionId: string | null; // Current session ID
  session: InsightsSession | null;
  sessions: InsightsSessionSummary[]; // List of all sessions
  sessionStates: Map<string, InsightsSessionState>; // Per-session streaming state
  isLoadingSessions: boolean;
  abortControllers: Map<string, AbortController>; // sessionId -> AbortController mapping for active generations

  // Current session state (mirrored from sessionStates for easy access)
  status: InsightsChatStatus;
  pendingMessage: string;
  streamingContent: string;
  currentTool: ToolUsage | null;
  toolsUsed: InsightsToolUsage[];

  // Actions
  setCurrentSessionId: (sessionId: string | null) => void;
  setSession: (session: InsightsSession | null) => void;
  setSessions: (sessions: InsightsSessionSummary[]) => void;
  setStatus: (status: InsightsChatStatus, sessionId?: string) => void;
  resetStatus: () => void;
  setPendingMessage: (message: string, sessionId?: string) => void;
  addMessage: (message: InsightsChatMessage) => void;
  updateLastAssistantMessage: (content: string) => void;
  appendStreamingContent: (content: string, sessionId?: string) => void;
  clearStreamingContent: (sessionId?: string) => void;
  setCurrentTool: (tool: ToolUsage | null, sessionId?: string) => void;
  addToolUsage: (tool: ToolUsage, sessionId?: string) => void;
  clearToolsUsed: (sessionId?: string) => void;
  finalizeStreamingMessage: (suggestedTask?: InsightsChatMessage['suggestedTask'], sessionId?: string) => void;
  clearSession: () => void;
  setLoadingSessions: (loading: boolean) => void;
  abortGeneration: (sessionId: string) => void;
  cleanupSessionState: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;

  // Selectors
  getCurrentSessionState: () => InsightsSessionState | undefined;
  getSessionState: (sessionId: string) => InsightsSessionState | undefined;
}

const initialStatus: InsightsChatStatus = {
  phase: 'idle',
  message: ''
};

/**
 * Creates a fresh session state with default values.
 * Used when initializing a new session or when switching to a session that has no prior state.
 *
 * @returns A new InsightsSessionState object with all fields set to their initial values
 */
function createInitialSessionState(): InsightsSessionState {
  return {
    status: initialStatus,
    pendingMessage: '',
    streamingContent: '',
    currentTool: null,
    toolsUsed: [],
  };
}

export const useInsightsStore = create<InsightsState>((set, _get) => ({
  // Initial state
  currentSessionId: null,
  session: null,
  sessions: [],
  sessionStates: new Map<string, InsightsSessionState>(),
  isLoadingSessions: false,
  abortControllers: new Map<string, AbortController>(),
  status: initialStatus,
  pendingMessage: '',
  streamingContent: '',
  currentTool: null,
  toolsUsed: [],

  // Actions
  setCurrentSessionId: (sessionId) =>
    set((state) => {
      // Ensure session state exists for the given session ID
      if (sessionId && !state.sessionStates.has(sessionId)) {
        const newSessionStates = new Map(state.sessionStates);
        const newSessionState = createInitialSessionState();
        newSessionStates.set(sessionId, newSessionState);
        return {
          currentSessionId: sessionId,
          sessionStates: newSessionStates,
          status: newSessionState.status,
          pendingMessage: newSessionState.pendingMessage,
          streamingContent: newSessionState.streamingContent,
          currentTool: newSessionState.currentTool,
          toolsUsed: newSessionState.toolsUsed,
        };
      }
      return { currentSessionId: sessionId };
    }),

  setSession: (session) => {
    const sessionId = session?.id || null;

    return set((state) => {
      // Ensure session state exists for the given session ID
      if (sessionId && !state.sessionStates.has(sessionId)) {
        const newSessionStates = new Map(state.sessionStates);
        const newSessionState = createInitialSessionState();
        newSessionStates.set(sessionId, newSessionState);
        return {
          currentSessionId: sessionId,
          session,
          sessionStates: newSessionStates,
          status: newSessionState.status,
          pendingMessage: newSessionState.pendingMessage,
          streamingContent: newSessionState.streamingContent,
          currentTool: newSessionState.currentTool,
          toolsUsed: newSessionState.toolsUsed,
        };
      }

      // Restore session state from sessionStates map
      const sessionState = sessionId ? state.sessionStates.get(sessionId) : null;
      if (sessionState) {
        return {
          currentSessionId: sessionId,
          session,
          status: sessionState.status,
          pendingMessage: sessionState.pendingMessage,
          streamingContent: sessionState.streamingContent,
          currentTool: sessionState.currentTool,
          toolsUsed: sessionState.toolsUsed,
        };
      }

      return { currentSessionId: sessionId, session };
    });
  },

  setSessions: (sessions) =>
    set((state) => {
      // Get the set of current session IDs
      const currentSessionIds = new Set(sessions.map((s) => s.id));

      // Clean up sessionStates: remove entries for deleted sessions
      const newSessionStates = new Map<string, InsightsSessionState>();
      for (const [sessionId, sessionState] of state.sessionStates.entries()) {
        // Keep session state if session still exists or is the current session
        // (current session might be mid-creation and not yet in the sessions list)
        if (currentSessionIds.has(sessionId) || sessionId === state.currentSessionId) {
          newSessionStates.set(sessionId, sessionState);
        }
      }

      // Clean up abortControllers: remove entries for deleted sessions
      const newAbortControllers = new Map<string, AbortController>();
      for (const [sessionId, abortController] of state.abortControllers.entries()) {
        // Keep abort controller if the session still exists
        if (currentSessionIds.has(sessionId)) {
          newAbortControllers.set(sessionId, abortController);
        }
      }

      return {
        sessions,
        sessionStates: newSessionStates,
        abortControllers: newAbortControllers
      };
    }),

  setStatus: (status, sessionId) =>
    set((state) => {
      // Determine target session ID and whether to update top-level field
      const targetSessionId = sessionId || state.currentSessionId;
      const shouldUpdateTopLevel = !sessionId || sessionId === state.currentSessionId;

      const updates: Partial<InsightsState> = {};

      // Update top-level field if appropriate
      if (shouldUpdateTopLevel) {
        updates.status = status;
      }

      // Update sessionStates map if we have a target session
      if (targetSessionId) {
        const sessionState = state.sessionStates.get(targetSessionId);
        if (sessionState) {
          const newSessionStates = new Map(state.sessionStates);
          newSessionStates.set(targetSessionId, {
            ...sessionState,
            status
          });
          updates.sessionStates = newSessionStates;
        }
      }

      return updates;
    }),

  resetStatus: () => {
    const currentSessionId = _get().currentSessionId;

    return set((state) => {
      // Update top-level field
      const updates: Partial<InsightsState> = { status: initialStatus };

      // Also update in sessionStates map
      if (currentSessionId && state.sessionStates.has(currentSessionId)) {
        const sessionState = state.sessionStates.get(currentSessionId);
        if (sessionState) {
          const newSessionStates = new Map(state.sessionStates);
          newSessionStates.set(currentSessionId, {
            ...sessionState,
            status: initialStatus
          });
          updates.sessionStates = newSessionStates;
        }
      }

      return updates;
    });
  },

  setLoadingSessions: (loading) => set({ isLoadingSessions: loading }),

  setPendingMessage: (message, sessionId) =>
    set((state) => {
      // Determine target session ID and whether to update top-level field
      const targetSessionId = sessionId || state.currentSessionId;
      const shouldUpdateTopLevel = !sessionId || sessionId === state.currentSessionId;

      const updates: Partial<InsightsState> = {};

      // Update top-level field if appropriate
      if (shouldUpdateTopLevel) {
        updates.pendingMessage = message;
      }

      // Update sessionStates map if we have a target session
      if (targetSessionId) {
        const sessionState = state.sessionStates.get(targetSessionId);
        if (sessionState) {
          const newSessionStates = new Map(state.sessionStates);
          newSessionStates.set(targetSessionId, {
            ...sessionState,
            pendingMessage: message
          });
          updates.sessionStates = newSessionStates;
        }
      }

      return updates;
    }),

  addMessage: (message) =>
    set((state) => {
      if (!state.session) {
        // Create new session if none exists
        return {
          session: {
            id: `session-${Date.now()}`,
            projectId: '',
            messages: [message],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }

      // Update the session in the sessions list (for sidebar)
      const newSessions = state.sessions.map((s) =>
        s.id === state.session?.id
          ? { ...s, messageCount: s.messageCount + 1, updatedAt: new Date() }
          : s
      );

      return {
        session: {
          ...state.session,
          messages: [...state.session.messages, message],
          updatedAt: new Date()
        },
        sessions: newSessions
      };
    }),

  updateLastAssistantMessage: (content) =>
    set((state) => {
      if (!state.session || state.session.messages.length === 0) return state;

      const messages = [...state.session.messages];
      const lastIndex = messages.length - 1;
      const lastMessage = messages[lastIndex];

      if (lastMessage.role === 'assistant') {
        messages[lastIndex] = { ...lastMessage, content };
      }

      return {
        session: {
          ...state.session,
          messages,
          updatedAt: new Date()
        }
      };
    }),

  appendStreamingContent: (content, sessionId) =>
    set((state) => {
      // Determine target session ID and whether to update top-level field
      const targetSessionId = sessionId || state.currentSessionId;
      const shouldUpdateTopLevel = !sessionId || sessionId === state.currentSessionId;

      const updates: Partial<InsightsState> = {};

      // Update sessionStates map if we have a target session
      if (targetSessionId) {
        const sessionState = state.sessionStates.get(targetSessionId);
        if (sessionState) {
          const newContent = sessionState.streamingContent + content;

          const newSessionStates = new Map(state.sessionStates);
          newSessionStates.set(targetSessionId, {
            ...sessionState,
            streamingContent: newContent
          });
          updates.sessionStates = newSessionStates;

          // Update top-level field if appropriate
          if (shouldUpdateTopLevel) {
            updates.streamingContent = newContent;
          }
        }
      }

      return updates;
    }),

  clearStreamingContent: (sessionId) =>
    set((state) => {
      // Determine target session ID and whether to update top-level field
      const targetSessionId = sessionId || state.currentSessionId;
      const shouldUpdateTopLevel = !sessionId || sessionId === state.currentSessionId;

      const updates: Partial<InsightsState> = {};

      // Update top-level field if appropriate
      if (shouldUpdateTopLevel) {
        updates.streamingContent = '';
      }

      // Update sessionStates map if we have a target session
      if (targetSessionId) {
        const sessionState = state.sessionStates.get(targetSessionId);
        if (sessionState) {
          const newSessionStates = new Map(state.sessionStates);
          newSessionStates.set(targetSessionId, {
            ...sessionState,
            streamingContent: ''
          });
          updates.sessionStates = newSessionStates;
        }
      }

      return updates;
    }),

  setCurrentTool: (tool, sessionId) =>
    set((state) => {
      // Determine target session ID and whether to update top-level field
      const targetSessionId = sessionId || state.currentSessionId;
      const shouldUpdateTopLevel = !sessionId || sessionId === state.currentSessionId;

      const updates: Partial<InsightsState> = {};

      // Update top-level field if appropriate
      if (shouldUpdateTopLevel) {
        updates.currentTool = tool;
      }

      // Update sessionStates map if we have a target session
      if (targetSessionId) {
        const sessionState = state.sessionStates.get(targetSessionId);
        if (sessionState) {
          const newSessionStates = new Map(state.sessionStates);
          newSessionStates.set(targetSessionId, {
            ...sessionState,
            currentTool: tool
          });
          updates.sessionStates = newSessionStates;
        }
      }

      return updates;
    }),

  addToolUsage: (tool, sessionId) =>
    set((state) => {
      // Determine target session ID and whether to update top-level field
      const targetSessionId = sessionId || state.currentSessionId;
      const shouldUpdateTopLevel = !sessionId || sessionId === state.currentSessionId;

      const updates: Partial<InsightsState> = {};

      // Update sessionStates map if we have a target session
      if (targetSessionId) {
        const sessionState = state.sessionStates.get(targetSessionId);
        if (sessionState) {
          const newToolsUsed = [
            ...sessionState.toolsUsed,
            {
              name: tool.name,
              input: tool.input,
              timestamp: new Date()
            }
          ];

          const newSessionStates = new Map(state.sessionStates);
          newSessionStates.set(targetSessionId, {
            ...sessionState,
            toolsUsed: newToolsUsed
          });
          updates.sessionStates = newSessionStates;

          // Update top-level field if appropriate
          if (shouldUpdateTopLevel) {
            updates.toolsUsed = newToolsUsed;
          }
        }
      }

      return updates;
    }),

  clearToolsUsed: (sessionId) =>
    set((state) => {
      // Determine target session ID and whether to update top-level field
      const targetSessionId = sessionId || state.currentSessionId;
      const shouldUpdateTopLevel = !sessionId || sessionId === state.currentSessionId;

      const updates: Partial<InsightsState> = {};

      // Update top-level field if appropriate
      if (shouldUpdateTopLevel) {
        updates.toolsUsed = [];
      }

      // Update sessionStates map if we have a target session
      if (targetSessionId) {
        const sessionState = state.sessionStates.get(targetSessionId);
        if (sessionState) {
          const newSessionStates = new Map(state.sessionStates);
          newSessionStates.set(targetSessionId, {
            ...sessionState,
            toolsUsed: []
          });
          updates.sessionStates = newSessionStates;
        }
      }

      return updates;
    }),

  finalizeStreamingMessage: (suggestedTask, sessionId) =>
    set((state) => {
      // Determine target session ID and whether to update top-level field
      const targetSessionId = sessionId || state.currentSessionId;
      const shouldUpdateTopLevel = !sessionId || sessionId === state.currentSessionId;

      const updates: Partial<InsightsState> = {};

      // Update sessionStates map if we have a target session
      if (targetSessionId) {
        const sessionState = state.sessionStates.get(targetSessionId);
        if (sessionState) {
          const content = sessionState.streamingContent;
          const toolsUsed = sessionState.toolsUsed.length > 0 ? [...sessionState.toolsUsed] : undefined;

          // Reset streaming state in sessionStates map
          const newSessionStates = new Map(state.sessionStates);
          newSessionStates.set(targetSessionId, {
            ...sessionState,
            streamingContent: '',
            toolsUsed: []
          });
          updates.sessionStates = newSessionStates;

          // Update top-level mirrored fields only if updating the current session
          if (shouldUpdateTopLevel) {
            updates.streamingContent = '';
            updates.toolsUsed = [];
          }

          // If no content, suggested task, or tools, just reset streaming state
          if (!content && !suggestedTask && !toolsUsed) {
            return updates;
          }

          // Only add the message to state.session if the target session IS the current session
          // For background sessions, the backend handles persistence and the message will load
          // when the user switches to that session
          if (targetSessionId !== state.currentSessionId) {
            // Background session completed - just reset streaming state
            // Message will be loaded from backend when user switches to that session
            return updates;
          }

          const newMessage: InsightsChatMessage = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content,
            timestamp: new Date(),
            suggestedTask,
            toolsUsed
          };

          // If no session exists, create one
          if (!state.session) {
            return {
              ...updates,
              session: {
                id: `session-${Date.now()}`,
                projectId: '',
                messages: [newMessage],
                createdAt: new Date(),
                updatedAt: new Date()
              }
            };
          }

          // Add message to existing session (only for current session)
          // Update the session in the sessions list (for sidebar)
          const newSessions = state.sessions.map((s) =>
            s.id === state.session?.id
              ? { ...s, messageCount: s.messageCount + 1, updatedAt: new Date() }
              : s
          );
          return {
            ...updates,
            session: {
              ...state.session,
              messages: [...state.session.messages, newMessage],
              updatedAt: new Date()
            },
            sessions: newSessions
          };
        }
      }

      return updates;
    }),

  clearSession: () => {
    return set({
      session: null,
      currentSessionId: null,
      sessionStates: new Map<string, InsightsSessionState>(),
      abortControllers: new Map<string, AbortController>(),
      status: initialStatus,
      pendingMessage: '',
      streamingContent: '',
      currentTool: null,
      toolsUsed: [],
    });
  },

  /**
   * Aborts an ongoing generation for the specified session.
   * Cleans up the abort controller and resets session status.
   * Also cancels the backend Python process via IPC.
   *
   * @param sessionId - The ID of the session whose generation should be aborted
   * @param projectId - The project ID for the session (required for IPC cancel)
   */
  abortGeneration: (sessionId: string, projectId?: string) =>
    set((state) => {
      // Cancel the backend session via IPC if we have a projectId and are in browser environment
      if (projectId && typeof window !== 'undefined' && window.electronAPI?.cancelInsightsSession) {
        window.electronAPI.cancelInsightsSession(projectId, sessionId).catch((err) => {
          console.error('[InsightsStore] Failed to cancel backend session:', err);
        });
      }

      // Abort the controller for this session
      const abortController = state.abortControllers.get(sessionId);
      if (abortController) {
        abortController.abort();
      }

      // Remove the abort controller
      const newAbortControllers = new Map(state.abortControllers);
      newAbortControllers.delete(sessionId);

      // Update status for the session
      const sessionState = state.sessionStates.get(sessionId);
      const updates: Partial<InsightsState> = {
        abortControllers: newAbortControllers
      };

      if (sessionState) {
        const newStatus: InsightsChatStatus = {
          phase: 'idle',
          message: ''
        };

        const newSessionStates = new Map(state.sessionStates);
        newSessionStates.set(sessionId, {
          ...sessionState,
          status: newStatus
        });
        updates.sessionStates = newSessionStates;

        if (state.currentSessionId === sessionId) {
          updates.status = newStatus;
        }
      }

      return updates;
    }),

  /**
   * Cleans up the state for a specific session.
   * Resets the session's streaming state to initial values.
   * If the session is the current session, also resets the top-level fields.
   *
   * @param sessionId - The ID of the session to clean up
   */
  cleanupSessionState: (sessionId) =>
    set((state) => {
      // Get fresh initial state
      const initialState = createInitialSessionState();

      // Update the session in the sessionStates map
      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(sessionId, initialState);

      const updates: Partial<InsightsState> = {
        sessionStates: newSessionStates
      };

      // If this is the current session, also reset top-level fields
      if (state.currentSessionId === sessionId) {
        updates.status = initialState.status;
        updates.pendingMessage = initialState.pendingMessage;
        updates.streamingContent = initialState.streamingContent;
        updates.currentTool = initialState.currentTool;
        updates.toolsUsed = initialState.toolsUsed;
      }

      return updates;
    }),

  /**
   * Removes a session from the store completely.
   * This includes:
   * - Aborting any active generation for the session (including backend cancellation)
   * - Removing the session state from sessionStates
   * - Removing the session from abortControllers
   * - Clearing the current session if it's the one being removed
   *
   * @param sessionId - The ID of the session to remove
   * @param projectId - The project ID for the session (optional, will be looked up if not provided)
   */
  removeSession: (sessionId: string, projectId?: string) =>
    set((state) => {
      const updates: Partial<InsightsState> = {};

      // Cancel the backend session via IPC if we have a projectId and are in browser environment
      if (projectId && typeof window !== 'undefined' && window.electronAPI?.cancelInsightsSession) {
        window.electronAPI.cancelInsightsSession(projectId, sessionId).catch((err) => {
          console.error('[InsightsStore] Failed to cancel backend session during remove:', err);
        });
      }

      // Abort any active generation for this session
      const abortController = state.abortControllers.get(sessionId);
      if (abortController) {
        abortController.abort();
      }

      // Remove from sessionStates
      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.delete(sessionId);
      updates.sessionStates = newSessionStates;

      // Remove from abortControllers
      const newAbortControllers = new Map(state.abortControllers);
      newAbortControllers.delete(sessionId);
      updates.abortControllers = newAbortControllers;

      // If this is the current session, clear it
      if (state.currentSessionId === sessionId) {
        updates.currentSessionId = null;
        updates.session = null;
        updates.status = initialStatus;
        updates.pendingMessage = '';
        updates.streamingContent = '';
        updates.currentTool = null;
        updates.toolsUsed = [];
      }

      return updates;
    }),

  // Selectors
  /**
   * Gets the state for the currently active session.
   * Returns undefined if there is no active session.
   *
   * @returns The current session's state, or undefined if no session is active
   */
  getCurrentSessionState: () => {
    const state = _get();
    if (!state.currentSessionId) return undefined;
    return state.sessionStates.get(state.currentSessionId);
  },

  /**
   * Gets the state for a specific session by ID.
   * Returns undefined if the session has no recorded state.
   *
   * @param sessionId - The ID of the session to retrieve state for
   * @returns The session's state, or undefined if no state exists for that session
   */
  getSessionState: (sessionId: string) => {
    return _get().sessionStates.get(sessionId);
  }
}));

// Helper functions

export async function loadInsightsSessions(projectId: string): Promise<void> {
  const store = useInsightsStore.getState();
  store.setLoadingSessions(true);

  try {
    const result = await window.electronAPI.listInsightsSessions(projectId);
    if (result.success && result.data) {
      store.setSessions(result.data);
    } else {
      store.setSessions([]);
    }
  } finally {
    store.setLoadingSessions(false);
  }
}

export async function loadInsightsSession(projectId: string): Promise<void> {
  const result = await window.electronAPI.getInsightsSession(projectId);
  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);
  } else {
    useInsightsStore.getState().setSession(null);
  }
  // Also load the sessions list
  await loadInsightsSessions(projectId);
}

export function sendMessage(projectId: string, message: string, modelConfig?: InsightsModelConfig): void {
  const store = useInsightsStore.getState();
  const session = store.session;

  if (!session?.id) {
    console.error('[InsightsStore] sendMessage - no active session');
    return;
  }

  // Create and store abort controller for this session
  const abortController = new AbortController();
  useInsightsStore.setState((state) => ({
    abortControllers: new Map(state.abortControllers).set(session.id, abortController)
  }));

  // Ensure session state exists for the current session
  if (!store.sessionStates.has(session.id)) {
    useInsightsStore.setState((state) => {
      const newSessionStates = new Map(state.sessionStates);
      const newSessionState = createInitialSessionState();
      newSessionStates.set(session.id, newSessionState);
      return {
        sessionStates: newSessionStates
      };
    });
  }

  // Add user message to session
  const userMessage: InsightsChatMessage = {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: message,
    timestamp: new Date()
  };
  store.addMessage(userMessage);

  // Clear pending and set status
  store.setPendingMessage('', session.id);
  store.clearStreamingContent(session.id);
  store.clearToolsUsed(session.id); // Clear tools from previous response
  store.setStatus({
    phase: 'thinking',
    message: 'Processing your message...'
  }, session.id);

  // Use provided modelConfig, or fall back to session's config
  const configToUse = modelConfig || session?.modelConfig;

  // Send to main process
  window.electronAPI.sendInsightsMessage(session.id, projectId, message, configToUse);
}

export async function clearSession(projectId: string): Promise<void> {
  const store = useInsightsStore.getState();
  const sessionId = store.currentSessionId;

  if (!sessionId) {
    console.error('[InsightsStore] clearSession - no current session');
    return;
  }

  const result = await window.electronAPI.clearInsightsSession(sessionId, projectId);
  if (result.success) {
    useInsightsStore.getState().clearSession();
    // Reload sessions list and current session
    await loadInsightsSession(projectId);
  }
}

export async function newSession(projectId: string): Promise<void> {
  const result = await window.electronAPI.newInsightsSession(projectId);
  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);
    // Reload sessions list
    await loadInsightsSessions(projectId);
  }
}

export async function switchSession(projectId: string, sessionId: string): Promise<void> {
  // NOTE: For parallel generation, we do NOT abort the current session's generation
  // when switching. The session should continue generating in the background,
  // and its state will be updated via IPC events.
  // Users can explicitly cancel a generation using the abort button if desired.

  const result = await window.electronAPI.switchInsightsSession(projectId, sessionId);

  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);

    // NOTE: No need to manually clear/restore streaming state anymore!
    // The setSession() action now automatically loads the session's state
    // from the sessionStates map into the top-level fields.
  }

  // Refresh the sessions list to update sidebar with latest summaries
  await loadInsightsSessions(projectId);
}

export async function deleteSession(projectId: string, sessionId: string): Promise<boolean> {
  const result = await window.electronAPI.deleteInsightsSession(projectId, sessionId);
  if (result.success) {
    // Reload sessions list and current session
    await loadInsightsSession(projectId);
    return true;
  }
  return false;
}

export async function renameSession(projectId: string, sessionId: string, newTitle: string): Promise<boolean> {
  const result = await window.electronAPI.renameInsightsSession(projectId, sessionId, newTitle);
  if (result.success) {
    // Reload sessions list to reflect the change
    await loadInsightsSessions(projectId);
    return true;
  }
  return false;
}

export async function updateModelConfig(projectId: string, sessionId: string, modelConfig: InsightsModelConfig): Promise<boolean> {
  const result = await window.electronAPI.updateInsightsModelConfig(projectId, sessionId, modelConfig);
  if (result.success) {
    // Update local session state
    const store = useInsightsStore.getState();
    if (store.session?.id === sessionId) {
      store.setSession({
        ...store.session,
        modelConfig,
        updatedAt: new Date()
      });
    }
    // Reload sessions list to reflect the change
    await loadInsightsSessions(projectId);
    return true;
  }
  return false;
}

export async function createTaskFromSuggestion(
  projectId: string,
  title: string,
  description: string,
  metadata?: TaskMetadata
): Promise<Task | null> {
  const result = await window.electronAPI.createTaskFromInsights(
    projectId,
    title,
    description,
    metadata
  );

  if (result.success && result.data) {
    return result.data;
  }
  return null;
}

export function abortGeneration(sessionId: string): void {
  useInsightsStore.getState().abortGeneration(sessionId);
}

export function cleanupSessionState(sessionId: string): void {
  useInsightsStore.getState().cleanupSessionState(sessionId);
}

export function removeSession(sessionId: string): void {
  useInsightsStore.getState().removeSession(sessionId);
}

// IPC listener setup - call this once when the app initializes
export function setupInsightsListeners(): () => void {
  // Listen for streaming chunks
  // Drop chunks for aborted sessions to prevent state pollution
  const unsubStreamChunk = window.electronAPI.onInsightsStreamChunk(
    (sessionId, _projectId, chunk: InsightsStreamChunk) => {
      // Use sessionId directly from IPC event - the backend knows which session
      // this chunk belongs to, so we don't need to look it up by projectId
      if (!sessionId) {
        return;
      }

      const targetSessionId = sessionId;

      // Check if the session has been aborted (no abort controller means it was aborted)
      const store = useInsightsStore.getState();
      const abortController = store.abortControllers.get(targetSessionId);
      if (!abortController) {
        // Session was aborted, drop the chunk
        return;
      }

      switch (chunk.type) {
        case 'text':
          if (chunk.content) {
            // Update streaming content for the target session
            useInsightsStore.setState((state) => {
              const sessionState = state.sessionStates.get(targetSessionId);
              if (!sessionState) return state;

              const newContent = sessionState.streamingContent + chunk.content!;
              const newSessionStates = new Map(state.sessionStates);
              newSessionStates.set(targetSessionId, {
                ...sessionState,
                streamingContent: newContent
              });

              // Update top-level fields if this is the current session
              const updates: Partial<InsightsState> = {
                sessionStates: newSessionStates
              };
              if (state.currentSessionId === targetSessionId) {
                updates.streamingContent = newContent;
              }

              return updates;
            });
            // Clear tool when receiving text
            useInsightsStore.setState((state) => {
              const sessionState = state.sessionStates.get(targetSessionId);
              if (!sessionState) return state;

              const newSessionStates = new Map(state.sessionStates);
              newSessionStates.set(targetSessionId, {
                ...sessionState,
                currentTool: null
              });

              const updates: Partial<InsightsState> = {
                sessionStates: newSessionStates
              };
              if (state.currentSessionId === targetSessionId) {
                updates.currentTool = null;
              }

              return updates;
            });
            // Update status
            useInsightsStore.setState((state) => {
              const sessionState = state.sessionStates.get(targetSessionId);
              if (!sessionState) return state;

              const newStatus: InsightsChatStatus = {
                phase: 'streaming',
                message: 'Receiving response...'
              };

              const newSessionStates = new Map(state.sessionStates);
              newSessionStates.set(targetSessionId, {
                ...sessionState,
                status: newStatus
              });

              const updates: Partial<InsightsState> = {
                sessionStates: newSessionStates
              };
              if (state.currentSessionId === targetSessionId) {
                updates.status = newStatus;
              }

              return updates;
            });
          }
          break;
        case 'tool_start':
          if (chunk.tool) {
            // Set current tool
            useInsightsStore.setState((state) => {
              const sessionState = state.sessionStates.get(targetSessionId);
              if (!sessionState) return state;

              const newTool: ToolUsage = {
                name: chunk.tool!.name,
                input: chunk.tool!.input
              };

              const newSessionStates = new Map(state.sessionStates);
              newSessionStates.set(targetSessionId, {
                ...sessionState,
                currentTool: newTool
              });

              const updates: Partial<InsightsState> = {
                sessionStates: newSessionStates
              };
              if (state.currentSessionId === targetSessionId) {
                updates.currentTool = newTool;
              }

              return updates;
            });
            // Record this tool usage for history
            useInsightsStore.setState((state) => {
              const sessionState = state.sessionStates.get(targetSessionId);
              if (!sessionState) return state;

              const newToolsUsed = [
                ...sessionState.toolsUsed,
                {
                  name: chunk.tool!.name,
                  input: chunk.tool!.input,
                  timestamp: new Date()
                }
              ];

              const newSessionStates = new Map(state.sessionStates);
              newSessionStates.set(targetSessionId, {
                ...sessionState,
                toolsUsed: newToolsUsed
              });

              const updates: Partial<InsightsState> = {
                sessionStates: newSessionStates
              };
              if (state.currentSessionId === targetSessionId) {
                updates.toolsUsed = newToolsUsed;
              }

              return updates;
            });
            // Update status
            useInsightsStore.setState((state) => {
              const sessionState = state.sessionStates.get(targetSessionId);
              if (!sessionState) return state;

              const newStatus: InsightsChatStatus = {
                phase: 'streaming',
                message: `Using ${chunk.tool!.name}...`
              };

              const newSessionStates = new Map(state.sessionStates);
              newSessionStates.set(targetSessionId, {
                ...sessionState,
                status: newStatus
              });

              const updates: Partial<InsightsState> = {
                sessionStates: newSessionStates
              };
              if (state.currentSessionId === targetSessionId) {
                updates.status = newStatus;
              }

              return updates;
            });
          }
          break;
        case 'tool_end':
          useInsightsStore.setState((state) => {
            const sessionState = state.sessionStates.get(targetSessionId);
            if (!sessionState) return state;

            const newSessionStates = new Map(state.sessionStates);
            newSessionStates.set(targetSessionId, {
              ...sessionState,
              currentTool: null
            });

            const updates: Partial<InsightsState> = {
              sessionStates: newSessionStates
            };
            if (state.currentSessionId === targetSessionId) {
              updates.currentTool = null;
            }

            return updates;
          });
          break;
        case 'task_suggestion':
          // Clear current tool
          useInsightsStore.setState((state) => {
            const sessionState = state.sessionStates.get(targetSessionId);
            if (!sessionState) return state;

            const newSessionStates = new Map(state.sessionStates);
            newSessionStates.set(targetSessionId, {
              ...sessionState,
              currentTool: null
            });

            const updates: Partial<InsightsState> = {
              sessionStates: newSessionStates
            };
            if (state.currentSessionId === targetSessionId) {
              updates.currentTool = null;
            }

            return updates;
          });
          // Finalize the message with task suggestion
          store.finalizeStreamingMessage(chunk.suggestedTask, targetSessionId);
          break;
        case 'done':
          // Clear current tool
          useInsightsStore.setState((state) => {
            const sessionState = state.sessionStates.get(targetSessionId);
            if (!sessionState) return state;

            const newSessionStates = new Map(state.sessionStates);
            newSessionStates.set(targetSessionId, {
              ...sessionState,
              currentTool: null
            });

            const updates: Partial<InsightsState> = {
              sessionStates: newSessionStates
            };
            if (state.currentSessionId === targetSessionId) {
              updates.currentTool = null;
            }

            return updates;
          });
          // Finalize any remaining content
          store.finalizeStreamingMessage(undefined, targetSessionId);
          // Update status to complete
          useInsightsStore.setState((state) => {
            const sessionState = state.sessionStates.get(targetSessionId);
            if (!sessionState) return state;

            const newStatus: InsightsChatStatus = {
              phase: 'complete',
              message: ''
            };

            const newSessionStates = new Map(state.sessionStates);
            newSessionStates.set(targetSessionId, {
              ...sessionState,
              status: newStatus
            });

            const updates: Partial<InsightsState> = {
              sessionStates: newSessionStates
            };
            if (state.currentSessionId === targetSessionId) {
              updates.status = newStatus;
            }

            return updates;
          });
          // Remove abort controller to indicate generation is complete
          // This is critical for the UI to correctly show the session as no longer processing
          useInsightsStore.setState((state) => {
            const newAbortControllers = new Map(state.abortControllers);
            newAbortControllers.delete(targetSessionId);
            return { abortControllers: newAbortControllers };
          });
          break;
        case 'error':
          // Clear current tool
          useInsightsStore.setState((state) => {
            const sessionState = state.sessionStates.get(targetSessionId);
            if (!sessionState) return state;

            const newSessionStates = new Map(state.sessionStates);
            newSessionStates.set(targetSessionId, {
              ...sessionState,
              currentTool: null
            });

            const updates: Partial<InsightsState> = {
              sessionStates: newSessionStates
            };
            if (state.currentSessionId === targetSessionId) {
              updates.currentTool = null;
            }

            return updates;
          });
          // Update status to error
          useInsightsStore.setState((state) => {
            const sessionState = state.sessionStates.get(targetSessionId);
            if (!sessionState) return state;

            const newStatus: InsightsChatStatus = {
              phase: 'error',
              error: chunk.error
            };

            const newSessionStates = new Map(state.sessionStates);
            newSessionStates.set(targetSessionId, {
              ...sessionState,
              status: newStatus
            });

            const updates: Partial<InsightsState> = {
              sessionStates: newSessionStates
            };
            if (state.currentSessionId === targetSessionId) {
              updates.status = newStatus;
            }

            return updates;
          });
          // Remove abort controller to indicate generation is complete (even with error)
          useInsightsStore.setState((state) => {
            const newAbortControllers = new Map(state.abortControllers);
            newAbortControllers.delete(targetSessionId);
            return { abortControllers: newAbortControllers };
          });
          break;
      }
    }
  );

  // Listen for status updates
  const unsubStatus = window.electronAPI.onInsightsStatus((sessionId, _projectId, status) => {
    // Use sessionId directly from IPC event
    if (!sessionId) {
      return;
    }

    const targetSessionId = sessionId;

    // Check if the session has been aborted (no abort controller means it was aborted)
    const store = useInsightsStore.getState();
    const abortController = store.abortControllers.get(targetSessionId);
    if (!abortController) {
      // Session was aborted, drop the status update
      return;
    }

    useInsightsStore.setState((state) => {
      const sessionState = state.sessionStates.get(targetSessionId);
      if (!sessionState) return state;

      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(targetSessionId, {
        ...sessionState,
        status
      });

      const updates: Partial<InsightsState> = {
        sessionStates: newSessionStates
      };
      if (state.currentSessionId === targetSessionId) {
        updates.status = status;
      }

      return updates;
    });
  });

  // Listen for errors
  const unsubError = window.electronAPI.onInsightsError((sessionId, _projectId, error) => {
    // Use sessionId directly from IPC event
    if (!sessionId) {
      return;
    }

    const targetSessionId = sessionId;

    // Check if the session has been aborted (no abort controller means it was aborted)
    const store = useInsightsStore.getState();
    const abortController = store.abortControllers.get(targetSessionId);
    if (!abortController) {
      // Session was aborted, drop the error
      return;
    }

    useInsightsStore.setState((state) => {
      const sessionState = state.sessionStates.get(targetSessionId);
      if (!sessionState) return state;

      const newStatus: InsightsChatStatus = {
        phase: 'error',
        error
      };

      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(targetSessionId, {
        ...sessionState,
        status: newStatus
      });

      const updates: Partial<InsightsState> = {
        sessionStates: newSessionStates
      };
      if (state.currentSessionId === targetSessionId) {
        updates.status = newStatus;
      }

      return updates;
    });
  });

  // Return cleanup function
  return () => {
    unsubStreamChunk();
    unsubStatus();
    unsubError();
  };
}

export function resetStatus(): void {
  useInsightsStore.getState().resetStatus();
}
