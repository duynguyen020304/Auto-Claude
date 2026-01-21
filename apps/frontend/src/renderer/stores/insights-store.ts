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
  FileMention
} from '../../shared/types';

interface ToolUsage {
  name: string;
  input?: string;
}

// Per-session streaming state
interface InsightsSessionState {
  status: InsightsChatStatus;
  pendingMessage: string;
  streamingContent: string;
  currentTool: ToolUsage | null;
  toolsUsed: InsightsToolUsage[];
  fileMentions: FileMention[];
}

interface InsightsState {
  // Data
  currentSessionId: string | null; // Current session ID
  session: InsightsSession | null;
  sessions: InsightsSessionSummary[]; // List of all sessions
  sessionStates: Map<string, InsightsSessionState>; // Per-session streaming state
  isLoadingSessions: boolean;
  generatingSessionIds: Map<string, string>; // projectId -> sessionId mapping for active generations
  abortControllers: Map<string, AbortController>; // sessionId -> AbortController mapping for active generations

  // Current session state (mirrored from sessionStates for easy access)
  status: InsightsChatStatus;
  pendingMessage: string;
  streamingContent: string;
  currentTool: ToolUsage | null;
  toolsUsed: InsightsToolUsage[];
  fileMentions: FileMention[];

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
  addFileMention: (mention: FileMention, sessionId?: string) => void;
  removeFileMention: (id: string, sessionId?: string) => void;
  clearFileMentions: (sessionId?: string) => void;
  finalizeStreamingMessage: (suggestedTask?: InsightsChatMessage['suggestedTask'], sessionId?: string) => void;
  clearSession: () => void;
  setLoadingSessions: (loading: boolean) => void;
  abortGeneration: (sessionId: string) => void;
  cleanupSessionState: (sessionId: string) => void;

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
    fileMentions: []
  };
}

export const useInsightsStore = create<InsightsState>((set, _get) => ({
  // Initial state
  currentSessionId: null,
  session: null,
  sessions: [],
  sessionStates: new Map<string, InsightsSessionState>(),
  isLoadingSessions: false,
  generatingSessionIds: new Map<string, string>(),
  abortControllers: new Map<string, AbortController>(),
  status: initialStatus,
  pendingMessage: '',
  streamingContent: '',
  currentTool: null,
  toolsUsed: [],
  fileMentions: [],

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
          fileMentions: newSessionState.fileMentions
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
          fileMentions: newSessionState.fileMentions
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
          fileMentions: sessionState.fileMentions
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

      // Clean up generatingSessionIds: remove entries for deleted sessions
      const newGeneratingSessionIds = new Map<string, string>();
      for (const [projectId, generatingSessionId] of state.generatingSessionIds.entries()) {
        // Keep mapping if the generating session still exists
        if (currentSessionIds.has(generatingSessionId)) {
          newGeneratingSessionIds.set(projectId, generatingSessionId);
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
        generatingSessionIds: newGeneratingSessionIds,
        abortControllers: newAbortControllers
      };
    }),

  setStatus: (status, sessionId) => {
    const currentSessionId = _get().currentSessionId;

    return set((state) => {
      // Validation guard: ensure session ID matches
      if (sessionId && currentSessionId !== sessionId) {
        console.warn(`[InsightsStore] Rejected setStatus for session ${sessionId} because current session is ${currentSessionId}`);
        return state;
      }

      // Update top-level field
      const updates: Partial<InsightsState> = { status };

      // Also update in sessionStates map
      if (currentSessionId && state.sessionStates.has(currentSessionId)) {
        const sessionState = state.sessionStates.get(currentSessionId);
        if (sessionState) {
          const newSessionStates = new Map(state.sessionStates);
          newSessionStates.set(currentSessionId, {
            ...sessionState,
            status
          });
          updates.sessionStates = newSessionStates;
        }
      }

      return updates;
    });
  },

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
      // Validation guard: ensure session ID matches
      if (sessionId && state.currentSessionId !== sessionId) {
        console.warn(`[InsightsStore] Rejected setPendingMessage for session ${sessionId} because current session is ${state.currentSessionId}`);
        return state;
      }

      // Update top-level field
      const updates: Partial<InsightsState> = { pendingMessage: message };

      // Also update in sessionStates map
      if (state.currentSessionId && state.sessionStates.has(state.currentSessionId)) {
        const sessionState = state.sessionStates.get(state.currentSessionId);
        if (sessionState) {
          const newSessionStates = new Map(state.sessionStates);
          newSessionStates.set(state.currentSessionId, {
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

      return {
        session: {
          ...state.session,
          messages: [...state.session.messages, message],
          updatedAt: new Date()
        }
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
      // Validation guard: ensure session ID matches
      if (sessionId && state.currentSessionId !== sessionId) {
        console.warn(`[InsightsStore] Rejected appendStreamingContent for session ${sessionId} because current session is ${state.currentSessionId}`);
        return state;
      }

      if (!state.currentSessionId) return state;

      const sessionState = state.sessionStates.get(state.currentSessionId);
      if (!sessionState) return state;

      const newContent = sessionState.streamingContent + content;

      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(state.currentSessionId, {
        ...sessionState,
        streamingContent: newContent
      });

      return {
        streamingContent: newContent,
        sessionStates: newSessionStates
      };
    }),

  clearStreamingContent: (sessionId) => {
    const currentSessionId = _get().currentSessionId;

    return set((state) => {
      // Validation guard: ensure session ID matches
      if (sessionId && state.currentSessionId !== sessionId) {
        console.warn(`[InsightsStore] Rejected clearStreamingContent for session ${sessionId} because current session is ${state.currentSessionId}`);
        return state;
      }

      if (!state.currentSessionId) return state;

      const sessionState = state.sessionStates.get(state.currentSessionId);
      if (!sessionState) return state;

      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(state.currentSessionId, {
        ...sessionState,
        streamingContent: ''
      });

      return {
        streamingContent: '',
        sessionStates: newSessionStates
      };
    });
  },

  setCurrentTool: (tool, sessionId) =>
    set((state) => {
      // Validation guard: ensure session ID matches
      if (sessionId && state.currentSessionId !== sessionId) {
        console.warn(`[InsightsStore] Rejected setCurrentTool for session ${sessionId} because current session is ${state.currentSessionId}`);
        return state;
      }

      if (!state.currentSessionId) return state;

      const sessionState = state.sessionStates.get(state.currentSessionId);
      if (!sessionState) return state;

      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(state.currentSessionId, {
        ...sessionState,
        currentTool: tool
      });

      return {
        currentTool: tool,
        sessionStates: newSessionStates
      };
    }),

  addToolUsage: (tool, sessionId) =>
    set((state) => {
      // Validation guard: ensure session ID matches
      if (sessionId && state.currentSessionId !== sessionId) {
        console.warn(`[InsightsStore] Rejected addToolUsage for session ${sessionId} because current session is ${state.currentSessionId}`);
        return state;
      }

      if (!state.currentSessionId) return state;

      const sessionState = state.sessionStates.get(state.currentSessionId);
      if (!sessionState) return state;

      const newToolsUsed = [
        ...sessionState.toolsUsed,
        {
          name: tool.name,
          input: tool.input,
          timestamp: new Date()
        }
      ];

      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(state.currentSessionId, {
        ...sessionState,
        toolsUsed: newToolsUsed
      });

      return {
        toolsUsed: newToolsUsed,
        sessionStates: newSessionStates
      };
    }),

  clearToolsUsed: (sessionId) =>
    set((state) => {
      // Validation guard: ensure session ID matches
      if (sessionId && state.currentSessionId !== sessionId) {
        console.warn(`[InsightsStore] Rejected clearToolsUsed for session ${sessionId} because current session is ${state.currentSessionId}`);
        return state;
      }

      if (!state.currentSessionId) return state;

      const sessionState = state.sessionStates.get(state.currentSessionId);
      if (!sessionState) return state;

      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(state.currentSessionId, {
        ...sessionState,
        toolsUsed: []
      });

      return {
        toolsUsed: [],
        sessionStates: newSessionStates
      };
    }),

  addFileMention: (mention, sessionId) =>
    set((state) => {
      // Validation guard: ensure session ID matches
      if (sessionId && state.currentSessionId !== sessionId) {
        console.warn(`[InsightsStore] Rejected addFileMention for session ${sessionId} because current session is ${state.currentSessionId}`);
        return state;
      }

      if (!state.currentSessionId) return state;

      const sessionState = state.sessionStates.get(state.currentSessionId);
      if (!sessionState) return state;

      // Check if mention with same ID already exists
      if (sessionState.fileMentions.some((m) => m.id === mention.id)) {
        return state;
      }

      const newFileMentions = [...sessionState.fileMentions, mention];
      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(state.currentSessionId, {
        ...sessionState,
        fileMentions: newFileMentions
      });

      return {
        fileMentions: newFileMentions,
        sessionStates: newSessionStates
      };
    }),

  removeFileMention: (id, sessionId) =>
    set((state) => {
      // Validation guard: ensure session ID matches
      if (sessionId && state.currentSessionId !== sessionId) {
        console.warn(`[InsightsStore] Rejected removeFileMention for session ${sessionId} because current session is ${state.currentSessionId}`);
        return state;
      }

      if (!state.currentSessionId) return state;

      const sessionState = state.sessionStates.get(state.currentSessionId);
      if (!sessionState) return state;

      const newFileMentions = sessionState.fileMentions.filter((m) => m.id !== id);
      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(state.currentSessionId, {
        ...sessionState,
        fileMentions: newFileMentions
      });

      return {
        fileMentions: newFileMentions,
        sessionStates: newSessionStates
      };
    }),

  clearFileMentions: (sessionId) =>
    set((state) => {
      // Validation guard: ensure session ID matches
      if (sessionId && state.currentSessionId !== sessionId) {
        console.warn(`[InsightsStore] Rejected clearFileMentions for session ${sessionId} because current session is ${state.currentSessionId}`);
        return state;
      }

      if (!state.currentSessionId) return state;

      const sessionState = state.sessionStates.get(state.currentSessionId);
      if (!sessionState) return state;

      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(state.currentSessionId, {
        ...sessionState,
        fileMentions: []
      });

      return {
        fileMentions: [],
        sessionStates: newSessionStates
      };
    }),

  finalizeStreamingMessage: (suggestedTask, sessionId) =>
    set((state) => {
      // Validation guard: ensure session ID matches
      if (sessionId && state.currentSessionId !== sessionId) {
        console.warn(`[InsightsStore] Rejected finalizeStreamingMessage for session ${sessionId} because current session is ${state.currentSessionId}`);
        return state;
      }

      if (!state.currentSessionId) return state;

      const sessionState = state.sessionStates.get(state.currentSessionId);
      if (!sessionState) return state;

      const content = sessionState.streamingContent;
      const toolsUsed = sessionState.toolsUsed.length > 0 ? [...sessionState.toolsUsed] : undefined;

      if (!content && !suggestedTask && !toolsUsed) {
        const newSessionStates = new Map(state.sessionStates);
        newSessionStates.set(state.currentSessionId, {
          ...sessionState,
          streamingContent: '',
          toolsUsed: []
        });
        return {
          streamingContent: '',
          toolsUsed: [],
          sessionStates: newSessionStates
        };
      }

      const newMessage: InsightsChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: new Date(),
        suggestedTask,
        toolsUsed
      };

      if (!state.session) {
        const newSessionStates = new Map(state.sessionStates);
        newSessionStates.set(state.currentSessionId, {
          ...sessionState,
          streamingContent: '',
          toolsUsed: []
        });
        return {
          streamingContent: '',
          toolsUsed: [],
          sessionStates: newSessionStates,
          session: {
            id: `session-${Date.now()}`,
            projectId: '',
            messages: [newMessage],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }

      const newSessionStates = new Map(state.sessionStates);
      newSessionStates.set(state.currentSessionId, {
        ...sessionState,
        streamingContent: '',
        toolsUsed: []
      });

      return {
        streamingContent: '',
        toolsUsed: [],
        sessionStates: newSessionStates,
        session: {
          ...state.session,
          messages: [...state.session.messages, newMessage],
          updatedAt: new Date()
        }
      };
    }),

  clearSession: () => {
    return set({
      session: null,
      currentSessionId: null,
      sessionStates: new Map<string, InsightsSessionState>(),
      generatingSessionIds: new Map<string, string>(),
      abortControllers: new Map<string, AbortController>(),
      status: initialStatus,
      pendingMessage: '',
      streamingContent: '',
      currentTool: null,
      toolsUsed: [],
      fileMentions: []
    });
  },

  /**
   * Aborts an ongoing generation for the specified session.
   * Cleans up the abort controller, generating session tracking, and resets session status.
   *
   * @param sessionId - The ID of the session whose generation should be aborted
   */
  abortGeneration: (sessionId) =>
    set((state) => {
      // Abort the controller for this session
      const abortController = state.abortControllers.get(sessionId);
      if (abortController) {
        abortController.abort();
      }

      // Remove the abort controller
      const newAbortControllers = new Map(state.abortControllers);
      newAbortControllers.delete(sessionId);

      // Remove from generating session IDs
      const newGeneratingSessionIds = new Map<string, string>();
      for (const [projectId, generatingSessionId] of state.generatingSessionIds.entries()) {
        if (generatingSessionId !== sessionId) {
          newGeneratingSessionIds.set(projectId, generatingSessionId);
        }
      }

      // Update status for the session
      const sessionState = state.sessionStates.get(sessionId);
      const updates: Partial<InsightsState> = {
        abortControllers: newAbortControllers,
        generatingSessionIds: newGeneratingSessionIds
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
        updates.fileMentions = initialState.fileMentions;
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

  // Store the projectId -> sessionId mapping so IPC chunks know which session to update
  useInsightsStore.setState((state) => ({
    generatingSessionIds: new Map(state.generatingSessionIds).set(projectId, session.id)
  }));

  // Use provided modelConfig, or fall back to session's config
  const configToUse = modelConfig || session?.modelConfig;

  // Send to main process
  window.electronAPI.sendInsightsMessage(projectId, message, configToUse);
}

export async function clearSession(projectId: string): Promise<void> {
  const result = await window.electronAPI.clearInsightsSession(projectId);
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
  const store = useInsightsStore.getState();

  // Abort ongoing generation in the current session before switching
  const currentSessionId = store.currentSessionId;
  if (currentSessionId && currentSessionId !== sessionId) {
    // Check if current session is generating (has an abort controller)
    if (store.abortControllers.has(currentSessionId)) {
      store.abortGeneration(currentSessionId);
    }
  }

  const result = await window.electronAPI.switchInsightsSession(projectId, sessionId);

  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);

    // NOTE: No need to manually clear/restore streaming state anymore!
    // The setSession() action now automatically loads the session's state
    // from the sessionStates map into the top-level fields.
  }
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

// IPC listener setup - call this once when the app initializes
export function setupInsightsListeners(): () => void {
  // Listen for streaming chunks
  // Drop chunks for aborted sessions to prevent state pollution
  const unsubStreamChunk = window.electronAPI.onInsightsStreamChunk(
    (projectId, chunk: InsightsStreamChunk) => {
      // Check if session was aborted and drop chunks accordingly
      const store = useInsightsStore.getState();
      const generatingSessionId = store.generatingSessionIds.get(projectId);

      // If we don't have a tracked session for this project, it means the user
      // switched away from this project. Drop the chunk to prevent cross-project
      // data corruption.
      if (!generatingSessionId) {
        return;
      }

      const targetSessionId = generatingSessionId;

      // Check if the session has been aborted (no abort controller means it was aborted)
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
          // Clear the generating session tracking since generation is complete
          useInsightsStore.setState((state) => {
            const newGeneratingSessionIds = new Map(state.generatingSessionIds);
            newGeneratingSessionIds.delete(projectId);
            return { generatingSessionIds: newGeneratingSessionIds };
          });
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
          // Clear the generating session tracking since generation failed
          useInsightsStore.setState((state) => {
            const newGeneratingSessionIds = new Map(state.generatingSessionIds);
            newGeneratingSessionIds.delete(projectId);
            return { generatingSessionIds: newGeneratingSessionIds };
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
          break;
      }
    }
  );

  // Listen for status updates
  const unsubStatus = window.electronAPI.onInsightsStatus((projectId, status) => {
    const store = useInsightsStore.getState();
    const generatingSessionId = store.generatingSessionIds.get(projectId);

    // If we don't have a tracked session for this project, it means the user
    // switched away from this project. Drop the status update to prevent
    // cross-project data corruption.
    if (!generatingSessionId) {
      return;
    }

    const targetSessionId = generatingSessionId;

    // Check if the session has been aborted (no abort controller means it was aborted)
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
  const unsubError = window.electronAPI.onInsightsError((projectId, error) => {
    const store = useInsightsStore.getState();
    const generatingSessionId = store.generatingSessionIds.get(projectId);

    // If we don't have a tracked session for this project, it means the user
    // switched away from this project. Drop the error to prevent cross-project
    // data corruption.
    if (!generatingSessionId) {
      return;
    }

    const targetSessionId = generatingSessionId;

    // Check if the session has been aborted (no abort controller means it was aborted)
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

    // Clear the generating session tracking since generation failed
    useInsightsStore.setState((state) => {
      const newGeneratingSessionIds = new Map(state.generatingSessionIds);
      newGeneratingSessionIds.delete(projectId);
      return { generatingSessionIds: newGeneratingSessionIds };
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
