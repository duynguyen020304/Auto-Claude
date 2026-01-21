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
  setStatus: (status: InsightsChatStatus) => void;
  resetStatus: () => void;
  setPendingMessage: (message: string) => void;
  addMessage: (message: InsightsChatMessage) => void;
  updateLastAssistantMessage: (content: string) => void;
  appendStreamingContent: (content: string) => void;
  clearStreamingContent: () => void;
  setCurrentTool: (tool: ToolUsage | null) => void;
  addToolUsage: (tool: ToolUsage) => void;
  clearToolsUsed: () => void;
  addFileMention: (mention: FileMention) => void;
  removeFileMention: (id: string) => void;
  clearFileMentions: () => void;
  finalizeStreamingMessage: (suggestedTask?: InsightsChatMessage['suggestedTask']) => void;
  clearSession: () => void;
  setLoadingSessions: (loading: boolean) => void;

  // Selectors
  getCurrentSessionState: () => InsightsSessionState | undefined;
  getSessionState: (sessionId: string) => InsightsSessionState | undefined;
}

const initialStatus: InsightsChatStatus = {
  phase: 'idle',
  message: ''
};

// Helper function to create initial session state
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
    console.log('[InsightsStore] setSession called', {
      sessionId: session?.id || 'null',
      previousSessionId: _get().session?.id || 'null',
      currentStatus: _get().sessionStates.get(_get().currentSessionId || '')?.status,
      isStreaming: (_get().sessionStates.get(_get().currentSessionId || '')?.streamingContent.length || 0) > 0
    });

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

  setSessions: (sessions) => set({ sessions }),

  setStatus: (status) => {
    const currentSessionId = _get().currentSessionId;
    console.log('[InsightsStore] setStatus called', {
      newPhase: status.phase,
      previousPhase: _get().status.phase,
      hasStreamingContent: _get().streamingContent.length > 0,
      streamingContentLength: _get().streamingContent.length
    });

    return set((state) => {
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
    console.log('[InsightsStore] resetStatus called', {
      previousPhase: _get().status.phase,
      wasStreaming: _get().streamingContent.length > 0
    });

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

  setPendingMessage: (message) =>
    set((state) => {
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

  appendStreamingContent: (content) =>
    set((state) => {
      if (!state.currentSessionId) return state;

      const sessionState = state.sessionStates.get(state.currentSessionId);
      if (!sessionState) return state;

      const newContent = sessionState.streamingContent + content;
      console.log('[InsightsStore] appendStreamingContent called', {
        contentLength: content.length,
        previousLength: sessionState.streamingContent.length,
        newLength: newContent.length,
        statusPhase: sessionState.status.phase
      });

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

  clearStreamingContent: () => {
    const currentSessionId = _get().currentSessionId;
    console.log('[InsightsStore] clearStreamingContent called', {
      previousLength: _get().streamingContent.length,
      statusPhase: _get().status.phase
    });

    return set((state) => {
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

  setCurrentTool: (tool) =>
    set((state) => {
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

  addToolUsage: (tool) =>
    set((state) => {
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

  clearToolsUsed: () =>
    set((state) => {
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

  addFileMention: (mention) =>
    set((state) => {
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

  removeFileMention: (id) =>
    set((state) => {
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

  clearFileMentions: () =>
    set((state) => {
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

  finalizeStreamingMessage: (suggestedTask) =>
    set((state) => {
      if (!state.currentSessionId) return state;

      const sessionState = state.sessionStates.get(state.currentSessionId);
      if (!sessionState) return state;

      const content = sessionState.streamingContent;
      const toolsUsed = sessionState.toolsUsed.length > 0 ? [...sessionState.toolsUsed] : undefined;

      console.log('[InsightsStore] finalizeStreamingMessage called', {
        contentLength: content.length,
        hasSuggestedTask: !!suggestedTask,
        toolsUsedCount: sessionState.toolsUsed.length,
        statusPhase: sessionState.status.phase,
        sessionId: state.session?.id || 'null'
      });

      if (!content && !suggestedTask && !toolsUsed) {
        console.log('[InsightsStore] finalizeStreamingMessage - no content to finalize');
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
        console.log('[InsightsStore] finalizeStreamingMessage - creating new session');
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

      console.log('[InsightsStore] finalizeStreamingMessage - adding message to session', {
        sessionId: state.session.id,
        messageCount: state.session.messages.length
      });

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
    console.log('[InsightsStore] clearSession called', {
      previousSessionId: _get().session?.id || 'null',
      statusPhase: _get().status.phase,
      streamingContentLength: _get().streamingContent.length,
      toolsUsedCount: _get().toolsUsed.length
    });
    return set({
      session: null,
      currentSessionId: null,
      sessionStates: new Map<string, InsightsSessionState>(),
      status: initialStatus,
      pendingMessage: '',
      streamingContent: '',
      currentTool: null,
      toolsUsed: [],
      fileMentions: []
    });
  },

  // Selectors
  getCurrentSessionState: () => {
    const state = _get();
    if (!state.currentSessionId) return undefined;
    return state.sessionStates.get(state.currentSessionId);
  },

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
  console.log('[InsightsStore] sendMessage called', {
    projectId,
    messageLength: message.length,
    hasSession: !!useInsightsStore.getState().session,
    sessionId: useInsightsStore.getState().session?.id || 'null'
  });

  const store = useInsightsStore.getState();
  const session = store.session;

  // Add user message to session
  const userMessage: InsightsChatMessage = {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: message,
    timestamp: new Date()
  };
  store.addMessage(userMessage);

  // Clear pending and set status
  store.setPendingMessage('');
  store.clearStreamingContent();
  store.clearToolsUsed(); // Clear tools from previous response
  store.setStatus({
    phase: 'thinking',
    message: 'Processing your message...'
  });

  // Use provided modelConfig, or fall back to session's config
  const configToUse = modelConfig || session?.modelConfig;

  console.log('[InsightsStore] sendMessage - sending to main process', {
    hasConfig: !!configToUse
  });

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

  console.log('[InsightsStore] ===== switchSession START =====', {
    projectId,
    targetSessionId: sessionId,
    currentSessionId: store.session?.id || 'null',
    currentStatusPhase: store.status.phase,
    streamingContentLength: store.streamingContent.length,
    toolsUsedCount: store.toolsUsed.length,
    isGenerating: store.status.phase === 'thinking' || store.status.phase === 'streaming'
  });

  // Log the state that will be preserved for current session
  if (store.currentSessionId) {
    const currentState = store.sessionStates.get(store.currentSessionId);
    console.log('[InsightsStore] switchSession - preserving state for current session', {
      sessionId: store.currentSessionId,
      statusPhase: currentState?.status.phase,
      streamingContentLength: currentState?.streamingContent.length || 0,
      hasStreamingContent: (currentState?.streamingContent.length || 0) > 0
    });
  }

  const result = await window.electronAPI.switchInsightsSession(projectId, sessionId);

  console.log('[InsightsStore] switchSession - main process result', {
    success: result.success,
    hasData: !!result.data,
    newSessionId: result.data?.id || 'null'
  });

  if (result.success && result.data) {
    // Before switching, log what state exists for target session
    const storeBefore = useInsightsStore.getState();
    const targetStateBefore = storeBefore.sessionStates.get(sessionId);
    console.log('[InsightsStore] switchSession - target session state BEFORE setSession', {
      sessionId,
      hasState: !!targetStateBefore,
      statusPhase: targetStateBefore?.status.phase,
      streamingContentLength: targetStateBefore?.streamingContent.length || 0
    });

    useInsightsStore.getState().setSession(result.data);

    // NOTE: No need to manually clear/restore streaming state anymore!
    // The setSession() action now automatically loads the session's state
    // from the sessionStates map into the top-level fields.

    console.log('[InsightsStore] switchSession - switched to new session', {
      newStatusPhase: useInsightsStore.getState().status.phase,
      newStreamingContentLength: useInsightsStore.getState().streamingContent.length,
      statePreserved: (useInsightsStore.getState().streamingContent.length > 0)
    });

    console.log('[InsightsStore] ===== switchSession END =====');
  } else {
    console.log('[InsightsStore] switchSession - failed', {
      success: result.success
    });
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

// IPC listener setup - call this once when the app initializes
export function setupInsightsListeners(): () => void {
  const store = useInsightsStore.getState;

  console.log('[InsightsStore] setupInsightsListeners - setting up IPC listeners');

  // Listen for streaming chunks
  const unsubStreamChunk = window.electronAPI.onInsightsStreamChunk(
    (_projectId, chunk: InsightsStreamChunk) => {
      console.log('[InsightsStore] onInsightsStreamChunk received', {
        chunkType: chunk.type,
        currentSessionId: store().session?.id || 'null',
        currentStatusPhase: store().status.phase,
        streamingContentLength: store().streamingContent.length
      });

      switch (chunk.type) {
        case 'text':
          if (chunk.content) {
            console.log('[InsightsStore] stream chunk - text', {
              contentLength: chunk.content.length
            });
            store().appendStreamingContent(chunk.content);
            store().setCurrentTool(null); // Clear tool when receiving text
            store().setStatus({
              phase: 'streaming',
              message: 'Receiving response...'
            });
          }
          break;
        case 'tool_start':
          if (chunk.tool) {
            console.log('[InsightsStore] stream chunk - tool_start', {
              toolName: chunk.tool.name
            });
            store().setCurrentTool({
              name: chunk.tool.name,
              input: chunk.tool.input
            });
            // Record this tool usage for history
            store().addToolUsage({
              name: chunk.tool.name,
              input: chunk.tool.input
            });
            store().setStatus({
              phase: 'streaming',
              message: `Using ${chunk.tool.name}...`
            });
          }
          break;
        case 'tool_end':
          console.log('[InsightsStore] stream chunk - tool_end');
          store().setCurrentTool(null);
          break;
        case 'task_suggestion':
          console.log('[InsightsStore] stream chunk - task_suggestion', {
            hasSuggestedTask: !!chunk.suggestedTask
          });
          // Finalize the message with task suggestion
          store().setCurrentTool(null);
          store().finalizeStreamingMessage(chunk.suggestedTask);
          break;
        case 'done':
          console.log('[InsightsStore] stream chunk - done', {
            streamingContentLength: store().streamingContent.length
          });
          // Finalize any remaining content
          store().setCurrentTool(null);
          store().finalizeStreamingMessage();
          store().setStatus({
            phase: 'complete',
            message: ''
          });
          break;
        case 'error':
          console.log('[InsightsStore] stream chunk - error', {
            error: chunk.error
          });
          store().setCurrentTool(null);
          store().setStatus({
            phase: 'error',
            error: chunk.error
          });
          break;
      }
    }
  );

  // Listen for status updates
  const unsubStatus = window.electronAPI.onInsightsStatus((_projectId, status) => {
    console.log('[InsightsStore] onInsightsStatus received', {
      statusPhase: status.phase,
      hasError: !!status.error
    });
    store().setStatus(status);
  });

  // Listen for errors
  const unsubError = window.electronAPI.onInsightsError((_projectId, error) => {
    console.log('[InsightsStore] onInsightsError received', {
      error
    });
    store().setStatus({
      phase: 'error',
      error
    });
  });

  // Return cleanup function
  return () => {
    console.log('[InsightsStore] cleanup - removing IPC listeners');
    unsubStreamChunk();
    unsubStatus();
    unsubError();
  };
}

export function resetStatus(): void {
  useInsightsStore.getState().resetStatus();
}
