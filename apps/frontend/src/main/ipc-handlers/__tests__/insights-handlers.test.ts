/**
 * Tests for insights IPC handlers
 * @vitest-environment node
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  InsightsSession,
  InsightsSessionSummary,
  InsightsModelConfig,
  ActiveSession,
} from '../../../shared/types';

// Mock setup in hoisted phase
const {
  mockProjectStore,
  mockInsightsService,
  mockIpcMain,
  mockApp,
  mockSafeSendToRenderer,
  mockGetMainWindow,
} = vi.hoisted(() => {
  const ipcMain = new (class {
    handlers = new Map<string, Function>();
    listeners = new Map<string, Function>();

    handle(channel: string, handler: Function): void {
      this.handlers.set(channel, handler);
    }

    on(channel: string, listener: Function): void {
      this.listeners.set(channel, listener);
    }

    getHandler(channel: string): Function | undefined {
      return this.handlers.get(channel);
    }

    getListener(channel: string): Function | undefined {
      return this.listeners.get(channel);
    }
  })();

  const mockApp = {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return path.join('/tmp', 'test-userdata');
      return '/tmp';
    }),
  };

  return {
    mockProjectStore: {
      getProject: vi.fn(),
    },
    mockInsightsService: {
      loadSession: vi.fn(),
      sendMessage: vi.fn(),
      clearSession: vi.fn(),
      listSessions: vi.fn(),
      createNewSession: vi.fn(),
      switchSession: vi.fn(),
      deleteSession: vi.fn(),
      renameSession: vi.fn(),
      updateSessionModelConfig: vi.fn(),
      cancelSession: vi.fn(),
      getActiveSessions: vi.fn(),
      on: vi.fn(),
    },
    mockIpcMain: ipcMain,
    mockApp,
    mockSafeSendToRenderer: vi.fn(),
    mockGetMainWindow: vi.fn(() => null),
  };
});

// Mock all dependencies
vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: mockApp,
}));

vi.mock('../project-store', () => ({
  projectStore: mockProjectStore,
}));

vi.mock('../insights-service', () => ({
  insightsService: mockInsightsService,
}));

vi.mock('./utils', () => ({
  safeSendToRenderer: mockSafeSendToRenderer,
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => JSON.stringify({})),
}));

// Import after mocks are set up
import { registerInsightsHandlers } from '../insights-handlers';

describe('insights IPC handlers', () => {
  // Helper function to get handlers
  function getHandler(channel: string) {
    return mockIpcMain.getHandler(channel);
  }

  // Helper function to get listeners
  function getListener(channel: string) {
    return mockIpcMain.listeners.get(channel);
  }

  beforeAll(() => {
    // Register handlers once for all tests
    registerInsightsHandlers(mockGetMainWindow);
  });

  beforeEach(() => {
    // Reset call counts but not implementations
    // Don't clear mockInsightsService.on - it's called during registration
    mockInsightsService.loadSession.mockClear();
    mockInsightsService.sendMessage.mockClear();
    mockInsightsService.clearSession.mockClear();
    mockInsightsService.listSessions.mockClear();
    mockInsightsService.createNewSession.mockClear();
    mockInsightsService.switchSession.mockClear();
    mockInsightsService.deleteSession.mockClear();
    mockInsightsService.renameSession.mockClear();
    mockInsightsService.updateSessionModelConfig.mockClear();
    mockInsightsService.cancelSession.mockClear();
    mockInsightsService.getActiveSessions.mockClear();
    mockSafeSendToRenderer.mockClear();
  });

  describe('IPC handler routing', () => {
    it('should register handler for INSIGHTS_GET_SESSION', () => {
      const handler = getHandler(IPC_CHANNELS.INSIGHTS_GET_SESSION);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for INSIGHTS_SEND_MESSAGE', () => {
      const listener = getListener(IPC_CHANNELS.INSIGHTS_SEND_MESSAGE);
      expect(listener).toBeDefined();
      expect(typeof listener).toBe('function');
    });

    it('should register handler for INSIGHTS_CLEAR_SESSION', () => {
      const handler = getHandler(IPC_CHANNELS.INSIGHTS_CLEAR_SESSION);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for INSIGHTS_CREATE_TASK', () => {
      const handler = getHandler(IPC_CHANNELS.INSIGHTS_CREATE_TASK);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for INSIGHTS_LIST_SESSIONS', () => {
      const handler = getHandler(IPC_CHANNELS.INSIGHTS_LIST_SESSIONS);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for INSIGHTS_NEW_SESSION', () => {
      const handler = getHandler(IPC_CHANNELS.INSIGHTS_NEW_SESSION);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for INSIGHTS_SWITCH_SESSION', () => {
      const handler = getHandler(IPC_CHANNELS.INSIGHTS_SWITCH_SESSION);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for INSIGHTS_DELETE_SESSION', () => {
      const handler = getHandler(IPC_CHANNELS.INSIGHTS_DELETE_SESSION);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for INSIGHTS_RENAME_SESSION', () => {
      const handler = getHandler(IPC_CHANNELS.INSIGHTS_RENAME_SESSION);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for INSIGHTS_UPDATE_MODEL_CONFIG', () => {
      const handler = getHandler(IPC_CHANNELS.INSIGHTS_UPDATE_MODEL_CONFIG);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for INSIGHTS_CANCEL_SESSION', () => {
      const handler = getHandler(IPC_CHANNELS.INSIGHTS_CANCEL_SESSION);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for INSIGHTS_GET_ACTIVE_SESSIONS', () => {
      const handler = getHandler(IPC_CHANNELS.INSIGHTS_GET_ACTIVE_SESSIONS);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });
  });

  describe('Event forwarding registration', () => {
    it('should register stream-chunk event listener', () => {
      expect(mockInsightsService.on).toHaveBeenCalledWith(
        'stream-chunk',
        expect.any(Function)
      );
    });

    it('should register status event listener', () => {
      expect(mockInsightsService.on).toHaveBeenCalledWith(
        'status',
        expect.any(Function)
      );
    });

    it('should register error event listener', () => {
      expect(mockInsightsService.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function)
      );
    });

    it('should register sdk-rate-limit event listener', () => {
      expect(mockInsightsService.on).toHaveBeenCalledWith(
        'sdk-rate-limit',
        expect.any(Function)
      );
    });
  });

  describe('Handler functionality', () => {
    it('should call insightsService.loadSession for INSIGHTS_GET_SESSION', async () => {
      const mockSession: InsightsSession = {
        id: 'session-1',
        projectId: 'project-1',
        title: 'Test Session',
        messages: [],
        modelConfig: {
          profileId: 'balanced',
          model: 'sonnet',
          thinkingLevel: 'medium',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockProjectStore.getProject.mockReturnValue({
        id: 'project-1',
        path: '/tmp/project',
        autoBuildPath: '.auto-claude',
      });
      mockInsightsService.loadSession.mockReturnValue(mockSession);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_GET_SESSION);
      const result = await handler!({}, 'project-1');

      expect(mockInsightsService.loadSession).toHaveBeenCalledWith('project-1', '/tmp/project');
      expect(result.success).toBe(true);
    });

    it('should return error when project not found for INSIGHTS_GET_SESSION', async () => {
      mockProjectStore.getProject.mockReturnValue(undefined);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_GET_SESSION);
      const result = await handler!({}, 'project-1');

      expect(result).toEqual({
        success: false,
        error: 'Project not found',
      });
      expect(mockInsightsService.loadSession).not.toHaveBeenCalled();
    });

    it('should call insightsService.clearSession for INSIGHTS_CLEAR_SESSION', async () => {
      mockProjectStore.getProject.mockReturnValue({
        id: 'project-1',
        path: '/tmp/project',
        autoBuildPath: '.auto-claude',
      });
      mockInsightsService.clearSession.mockReturnValue(undefined);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_CLEAR_SESSION);
      const result = await handler!({}, 'session-1', 'project-1');

      expect(mockInsightsService.clearSession).toHaveBeenCalledWith('project-1', '/tmp/project');
      expect(result.success).toBe(true);
    });

    it('should call insightsService.listSessions for INSIGHTS_LIST_SESSIONS', async () => {
      const mockSessions: InsightsSessionSummary[] = [
        {
          id: 'session-1',
          projectId: 'project-1',
          title: 'Session 1',
          messageCount: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockProjectStore.getProject.mockReturnValue({
        id: 'project-1',
        path: '/tmp/project',
        autoBuildPath: '.auto-claude',
      });
      mockInsightsService.listSessions.mockReturnValue(mockSessions);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_LIST_SESSIONS);
      const result = await handler!({}, 'project-1');

      expect(mockInsightsService.listSessions).toHaveBeenCalledWith('/tmp/project');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSessions);
    });

    it('should call insightsService.createNewSession for INSIGHTS_NEW_SESSION', async () => {
      const mockSession: InsightsSession = {
        id: 'session-new',
        projectId: 'project-1',
        title: 'New Session',
        messages: [],
        modelConfig: {
          profileId: 'balanced',
          model: 'sonnet',
          thinkingLevel: 'medium',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockProjectStore.getProject.mockReturnValue({
        id: 'project-1',
        path: '/tmp/project',
        autoBuildPath: '.auto-claude',
      });
      mockInsightsService.createNewSession.mockReturnValue(mockSession);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_NEW_SESSION);
      const result = await handler!({}, 'project-1');

      expect(mockInsightsService.createNewSession).toHaveBeenCalledWith('project-1', '/tmp/project');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSession);
    });

    it('should call insightsService.cancelSession for INSIGHTS_CANCEL_SESSION', async () => {
      mockInsightsService.cancelSession.mockReturnValue(true);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_CANCEL_SESSION);
      const result = await handler!({}, 'session-1');

      expect(mockInsightsService.cancelSession).toHaveBeenCalledWith('session-1');
      expect(result.success).toBe(true);
    });

    it('should return error when session not found for INSIGHTS_CANCEL_SESSION', async () => {
      mockInsightsService.cancelSession.mockReturnValue(false);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_CANCEL_SESSION);
      const result = await handler!({}, 'session-nonexistent');

      expect(result).toEqual({
        success: false,
        error: 'Session not found or could not be cancelled',
      });
    });

    it('should call insightsService.getActiveSessions for INSIGHTS_GET_ACTIVE_SESSIONS', async () => {
      const mockActiveSessions: ActiveSession[] = [
        {
          sessionId: 'session-1',
          projectId: 'project-1',
          startedAt: Date.now(),
        },
      ];

      mockInsightsService.getActiveSessions.mockReturnValue(mockActiveSessions);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_GET_ACTIVE_SESSIONS);
      const result = await handler!();

      expect(mockInsightsService.getActiveSessions).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockActiveSessions);
    });

    it('should call insightsService.deleteSession for INSIGHTS_DELETE_SESSION', async () => {
      mockProjectStore.getProject.mockReturnValue({
        id: 'project-1',
        path: '/tmp/project',
        autoBuildPath: '.auto-claude',
      });
      mockInsightsService.deleteSession.mockReturnValue(true);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_DELETE_SESSION);
      const result = await handler!({}, 'project-1', 'session-1');

      expect(mockInsightsService.deleteSession).toHaveBeenCalledWith('project-1', '/tmp/project', 'session-1');
      expect(result.success).toBe(true);
    });

    it('should call insightsService.renameSession for INSIGHTS_RENAME_SESSION', async () => {
      mockProjectStore.getProject.mockReturnValue({
        id: 'project-1',
        path: '/tmp/project',
        autoBuildPath: '.auto-claude',
      });
      mockInsightsService.renameSession.mockReturnValue(true);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_RENAME_SESSION);
      const result = await handler!({}, 'project-1', 'session-1', 'New Title');

      expect(mockInsightsService.renameSession).toHaveBeenCalledWith('/tmp/project', 'session-1', 'New Title');
      expect(result.success).toBe(true);
    });

    it('should call insightsService.updateSessionModelConfig for INSIGHTS_UPDATE_MODEL_CONFIG', async () => {
      const mockConfig: InsightsModelConfig = {
        profileId: 'fast',
        model: 'haiku',
        thinkingLevel: 'low',
      };

      mockProjectStore.getProject.mockReturnValue({
        id: 'project-1',
        path: '/tmp/project',
        autoBuildPath: '.auto-claude',
      });
      mockInsightsService.updateSessionModelConfig.mockReturnValue(true);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_UPDATE_MODEL_CONFIG);
      const result = await handler!({}, 'project-1', 'session-1', mockConfig);

      expect(mockInsightsService.updateSessionModelConfig).toHaveBeenCalledWith('/tmp/project', 'session-1', mockConfig);
      expect(result.success).toBe(true);
    });

    it('should call insightsService.switchSession for INSIGHTS_SWITCH_SESSION', async () => {
      const mockSession: InsightsSession = {
        id: 'session-2',
        projectId: 'project-1',
        title: 'Session 2',
        messages: [],
        modelConfig: {
          profileId: 'balanced',
          model: 'sonnet',
          thinkingLevel: 'medium',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockProjectStore.getProject.mockReturnValue({
        id: 'project-1',
        path: '/tmp/project',
        autoBuildPath: '.auto-claude',
      });
      mockInsightsService.switchSession.mockReturnValue(mockSession);

      const handler = getHandler(IPC_CHANNELS.INSIGHTS_SWITCH_SESSION);
      const result = await handler!({}, 'project-1', 'session-2');

      expect(mockInsightsService.switchSession).toHaveBeenCalledWith('project-1', '/tmp/project', 'session-2');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSession);
    });
  });

  describe('Event forwarding', () => {
    it('should forward stream-chunk events to renderer', () => {
      const streamChunkCallback = mockInsightsService.on.mock.calls.find(
        (call) => call[0] === 'stream-chunk'
      )?.[1];

      expect(streamChunkCallback).toBeDefined();

      if (streamChunkCallback) {
        streamChunkCallback('session-1', 'project-1', { content: 'test chunk' });

        expect(mockSafeSendToRenderer).toHaveBeenCalledWith(
          mockGetMainWindow,
          IPC_CHANNELS.INSIGHTS_STREAM_CHUNK,
          'session-1',
          'project-1',
          { content: 'test chunk' }
        );
      }
    });

    it('should forward status events to renderer', () => {
      const statusCallback = mockInsightsService.on.mock.calls.find(
        (call) => call[0] === 'status'
      )?.[1];

      expect(statusCallback).toBeDefined();

      if (statusCallback) {
        statusCallback('session-1', 'project-1', { phase: 'thinking' });

        expect(mockSafeSendToRenderer).toHaveBeenCalledWith(
          mockGetMainWindow,
          IPC_CHANNELS.INSIGHTS_STATUS,
          'session-1',
          'project-1',
          { phase: 'thinking' }
        );
      }
    });

    it('should forward error events to renderer', () => {
      const errorCallback = mockInsightsService.on.mock.calls.find(
        (call) => call[0] === 'error'
      )?.[1];

      expect(errorCallback).toBeDefined();

      if (errorCallback) {
        errorCallback('session-1', 'project-1', 'Test error');

        expect(mockSafeSendToRenderer).toHaveBeenCalledWith(
          mockGetMainWindow,
          IPC_CHANNELS.INSIGHTS_ERROR,
          'session-1',
          'project-1',
          'Test error'
        );
      }
    });

    it('should forward sdk-rate-limit events to renderer', () => {
      const rateLimitCallback = mockInsightsService.on.mock.calls.find(
        (call) => call[0] === 'sdk-rate-limit'
      )?.[1];

      expect(rateLimitCallback).toBeDefined();

      if (rateLimitCallback) {
        const rateLimitInfo = { remaining: 100, resetAt: Date.now() };
        rateLimitCallback(rateLimitInfo);

        expect(mockSafeSendToRenderer).toHaveBeenCalledWith(
          mockGetMainWindow,
          IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT,
          rateLimitInfo
        );
      }
    });
  });
});
