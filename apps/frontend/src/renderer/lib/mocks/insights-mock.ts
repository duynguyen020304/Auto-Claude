/**
 * Mock implementation for insights operations
 */

import { mockInsightsSessions } from './mock-data';

export const insightsMock = {
  getInsightsSession: async () => ({
    success: true,
    data: mockInsightsSessions.length > 0 ? {
      id: mockInsightsSessions[0].id,
      projectId: mockInsightsSessions[0].projectId,
      messages: [],
      createdAt: mockInsightsSessions[0].createdAt,
      updatedAt: mockInsightsSessions[0].updatedAt
    } : null
  }),

  listInsightsSessions: async () => ({
    success: true,
    data: mockInsightsSessions
  }),

  newInsightsSession: async (projectId: string) => {
    const newSession = {
      id: `session-${Date.now()}`,
      projectId,
      title: 'New conversation',
      messageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    mockInsightsSessions.unshift(newSession);
    return {
      success: true,
      data: {
        id: newSession.id,
        projectId: newSession.projectId,
        messages: [],
        createdAt: newSession.createdAt,
        updatedAt: newSession.updatedAt
      }
    };
  },

  switchInsightsSession: async (_projectId: string, sessionId: string) => {
    const session = mockInsightsSessions.find(s => s.id === sessionId);
    if (session) {
      return {
        success: true,
        data: {
          id: session.id,
          projectId: session.projectId,
          messages: [],
          createdAt: session.createdAt,
          updatedAt: session.updatedAt
        }
      };
    }
    return { success: false, error: 'Session not found' };
  },

  deleteInsightsSession: async (_projectId: string, sessionId: string) => {
    const index = mockInsightsSessions.findIndex(s => s.id === sessionId);
    if (index !== -1) {
      mockInsightsSessions.splice(index, 1);
      console.warn('[Browser Mock] Session deleted:', sessionId);
    }
    return { success: true };
  },

  renameInsightsSession: async (_projectId: string, sessionId: string, newTitle: string) => {
    const session = mockInsightsSessions.find(s => s.id === sessionId);
    if (session) {
      session.title = newTitle;
      console.warn('[Browser Mock] Session renamed:', sessionId, 'to', newTitle);
    }
    return { success: true };
  },

  updateInsightsSession: async (_projectId: string, sessionId: string, updates: unknown) => {
    const session = mockInsightsSessions.find(s => s.id === sessionId);
    if (session) {
      Object.assign(session, updates);
      console.warn('[Browser Mock] Session updated:', sessionId, updates);
      return { success: true, data: session as any };
    }
    return { success: false, error: 'Session not found' };
  },

  updateInsightsModelConfig: async (_projectId: string, _sessionId: string, _modelConfig: unknown) => {
    console.warn('[Browser Mock] updateInsightsModelConfig called');
    return { success: true };
  },

  sendInsightsMessage: (_sessionId: string, _projectId: string, _message: string, _modelConfig?: unknown) => {
    console.warn('[Browser Mock] sendInsightsMessage called');
  },

  clearInsightsSession: async (_sessionId: string, _projectId: string) => ({ success: true }),

  createTaskFromInsights: async (_projectId: string, title: string, description: string) => ({
    success: true,
    data: {
      id: `task-${Date.now()}`,
      projectId: _projectId,
      specId: `00${Date.now()}-insights-task`,
      title,
      description,
      status: 'backlog' as const,
      subtasks: [],
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }),

  cancelInsightsSession: async (_projectId: string, _sessionId: string) => ({ success: true }),

  getActiveInsightsSessions: async () => ({
    success: true,
    data: []
  }),

  onInsightsStreamChunk: () => () => {},
  onInsightsStatus: () => () => {},
  onInsightsError: () => () => {},
  onInsightsSessionUpdated: () => () => {}
};
