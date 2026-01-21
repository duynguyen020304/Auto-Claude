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

interface InsightsState {
  // Data
  session: InsightsSession | null;
  sessions: InsightsSessionSummary[]; // List of all sessions
  status: InsightsChatStatus;
  pendingMessage: string;
  streamingContent: string; // Accumulates streaming response
  currentTool: ToolUsage | null; // Currently executing tool
  toolsUsed: InsightsToolUsage[]; // Tools used during current response
  isLoadingSessions: boolean;
  fileMentions: FileMention[]; // File mentions for current message

  // Actions
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
}

const initialStatus: InsightsChatStatus = {
  phase: 'idle',
  message: ''
};

export const useInsightsStore = create<InsightsState>((set, _get) => ({
  // Initial state
  session: null,
  sessions: [],
  status: initialStatus,
  pendingMessage: '',
  streamingContent: '',
  currentTool: null,
  toolsUsed: [],
  isLoadingSessions: false,
  fileMentions: [],

  // Actions
  setSession: (session) => {
    console.log('[InsightsStore] setSession called', {
      sessionId: session?.id || 'null',
      previousSessionId: _get().session?.id || 'null',
      currentStatus: _get().status,
      isStreaming: _get().streamingContent.length > 0
    });
    return set({ session });
  },

  setSessions: (sessions) => set({ sessions }),

  setStatus: (status) => {
    console.log('[InsightsStore] setStatus called', {
      newPhase: status.phase,
      previousPhase: _get().status.phase,
      hasStreamingContent: _get().streamingContent.length > 0,
      streamingContentLength: _get().streamingContent.length
    });
    return set({ status });
  },

  resetStatus: () => {
    console.log('[InsightsStore] resetStatus called', {
      previousPhase: _get().status.phase,
      wasStreaming: _get().streamingContent.length > 0
    });
    return set({ status: initialStatus });
  },

  setLoadingSessions: (loading) => set({ isLoadingSessions: loading }),

  setPendingMessage: (message) => set({ pendingMessage: message }),

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
      const newContent = state.streamingContent + content;
      console.log('[InsightsStore] appendStreamingContent called', {
        contentLength: content.length,
        previousLength: state.streamingContent.length,
        newLength: newContent.length,
        statusPhase: state.status.phase
      });
      return { streamingContent: newContent };
    }),

  clearStreamingContent: () => {
    console.log('[InsightsStore] clearStreamingContent called', {
      previousLength: _get().streamingContent.length,
      statusPhase: _get().status.phase
    });
    return set({ streamingContent: '' });
  },

  setCurrentTool: (tool) => set({ currentTool: tool }),

  addToolUsage: (tool) =>
    set((state) => ({
      toolsUsed: [
        ...state.toolsUsed,
        {
          name: tool.name,
          input: tool.input,
          timestamp: new Date()
        }
      ]
    })),

  clearToolsUsed: () => set({ toolsUsed: [] }),

  addFileMention: (mention) =>
    set((state) => {
      // Check if mention with same ID already exists
      if (state.fileMentions.some((m) => m.id === mention.id)) {
        return state;
      }
      return {
        fileMentions: [...state.fileMentions, mention]
      };
    }),

  removeFileMention: (id) =>
    set((state) => ({
      fileMentions: state.fileMentions.filter((m) => m.id !== id)
    })),

  clearFileMentions: () => set({ fileMentions: [] }),

  finalizeStreamingMessage: (suggestedTask) =>
    set((state) => {
      const content = state.streamingContent;
      const toolsUsed = state.toolsUsed.length > 0 ? [...state.toolsUsed] : undefined;

      console.log('[InsightsStore] finalizeStreamingMessage called', {
        contentLength: content.length,
        hasSuggestedTask: !!suggestedTask,
        toolsUsedCount: state.toolsUsed.length,
        statusPhase: state.status.phase,
        sessionId: state.session?.id || 'null'
      });

      if (!content && !suggestedTask && !toolsUsed) {
        console.log('[InsightsStore] finalizeStreamingMessage - no content to finalize');
        return { streamingContent: '', toolsUsed: [] };
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
        return {
          streamingContent: '',
          toolsUsed: [],
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

      return {
        streamingContent: '',
        toolsUsed: [],
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
      status: initialStatus,
      pendingMessage: '',
      streamingContent: '',
      currentTool: null,
      toolsUsed: [],
      fileMentions: []
    });
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

  console.log('[InsightsStore] switchSession called', {
    projectId,
    targetSessionId: sessionId,
    currentSessionId: store.session?.id || 'null',
    currentStatusPhase: store.status.phase,
    streamingContentLength: store.streamingContent.length,
    toolsUsedCount: store.toolsUsed.length,
    isGenerating: store.status.phase === 'thinking' || store.status.phase === 'streaming'
  });

  const result = await window.electronAPI.switchInsightsSession(projectId, sessionId);

  console.log('[InsightsStore] switchSession - main process result', {
    success: result.success,
    hasData: !!result.data,
    newSessionId: result.data?.id || 'null'
  });

  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);

    console.log('[InsightsStore] switchSession - CLEARING streaming state', {
      streamingContentLength: useInsightsStore.getState().streamingContent.length,
      wasStreaming: useInsightsStore.getState().streamingContent.length > 0
    });

    // Reset streaming state when switching sessions
    useInsightsStore.getState().clearStreamingContent();
    useInsightsStore.getState().clearToolsUsed();
    useInsightsStore.getState().clearFileMentions();
    useInsightsStore.getState().setCurrentTool(null);
    useInsightsStore.getState().setStatus({ phase: 'idle', message: '' });

    console.log('[InsightsStore] switchSession - state cleared', {
      newStatusPhase: useInsightsStore.getState().status.phase,
      newStreamingContentLength: useInsightsStore.getState().streamingContent.length
    });
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
