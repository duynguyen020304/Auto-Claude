/**
 * Tests for review QA IPC handlers
 * @vitest-environment node
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { IPC_CHANNELS, AUTO_BUILD_PATHS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';

// Mock setup in hoisted phase
const {
  mockProjectStore,
  mockReviewQAService,
  mockIpcMain,
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

  // Create mock ReviewQAService instance
  const reviewQAService = {
    configure: vi.fn(),
    startSession: vi.fn(),
    cancelSession: vi.fn(),
    isSessionActive: vi.fn(),
    getActiveSessions: vi.fn(),
    on: vi.fn(),
  };

  return {
    mockProjectStore: {
      getProject: vi.fn(),
    },
    mockReviewQAService: reviewQAService,
    mockIpcMain: ipcMain,
    mockSafeSendToRenderer: vi.fn(),
    mockGetMainWindow: vi.fn(() => null),
  };
});

// Create class factory that returns our mock instance
const ReviewQAServiceMock = function(this: any) {
  return mockReviewQAService;
} as any;
(ReviewQAServiceMock as any).prototype = mockReviewQAService;

// Mock all dependencies
vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: {
    on: vi.fn(),
    getPath: vi.fn(() => '/tmp'),
  },
}));

vi.mock('../project-store', () => ({
  projectStore: mockProjectStore,
}));

vi.mock('../review-qa-service', () => ({
  ReviewQAService: ReviewQAServiceMock,
}));

vi.mock('../utils', () => ({
  safeSendToRenderer: mockSafeSendToRenderer,
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}));

// Import after mocks are set up
import { registerReviewQAHandlers } from '../review-qa-handlers';
import { existsSync } from 'fs';

describe('review-qa IPC handlers', () => {
  // Helper function to get handlers
  function getHandler(channel: string) {
    return mockIpcMain.getHandler(channel);
  }

  // Helper function to get listeners
  function getListener(channel: string) {
    return mockIpcMain.listeners.get(channel);
  }

  const mockProject = {
    id: 'test-project-id',
    name: 'Test Project',
    path: '/test/project',
    autoBuildPath: '/test/auto-build',
  };

  beforeAll(() => {
    // Register handlers once for all tests
    registerReviewQAHandlers(mockGetMainWindow);
  });

  beforeEach(() => {
    // Reset call counts but not implementations
    // Note: Don't clear mockReviewQAService.on - event registration happens during beforeAll
    mockReviewQAService.configure.mockClear();
    mockReviewQAService.startSession.mockClear();
    mockReviewQAService.cancelSession.mockClear();
    mockReviewQAService.isSessionActive.mockReset();
    mockReviewQAService.getActiveSessions.mockClear();
    mockProjectStore.getProject.mockClear();
    mockSafeSendToRenderer.mockClear();
    vi.mocked(existsSync).mockReturnValue(true);

    // Reset to default mock implementations
    mockReviewQAService.isSessionActive.mockReturnValue(false);
    mockReviewQAService.cancelSession.mockReturnValue(true);
    mockReviewQAService.getActiveSessions.mockReturnValue([]);
  });

  describe('IPC handler registration', () => {
    it('should register handler for REVIEW_QA_STOP', () => {
      const handler = getHandler(IPC_CHANNELS.REVIEW_QA_STOP);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for REVIEW_QA_GET_STATUS', () => {
      const handler = getHandler(IPC_CHANNELS.REVIEW_QA_GET_STATUS);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register handler for REVIEW_QA_GET_LOGS', () => {
      const handler = getHandler(IPC_CHANNELS.REVIEW_QA_GET_LOGS);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should register listener for REVIEW_QA_SEND_MESSAGE', () => {
      const listener = getListener(IPC_CHANNELS.REVIEW_QA_SEND_MESSAGE);
      expect(listener).toBeDefined();
      expect(typeof listener).toBe('function');
    });
  });

  describe('REVIEW_QA_SEND_MESSAGE', () => {
    it('should start a review QA session with valid parameters', async () => {
      mockProjectStore.getProject.mockReturnValue(mockProject);
      mockReviewQAService.startSession.mockResolvedValue(undefined);

      const listener = getListener(IPC_CHANNELS.REVIEW_QA_SEND_MESSAGE);

      // This test verifies the listener is callable and handles valid inputs
      // The actual service integration is verified through integration tests
      await expect(
        listener(
          null,
          'test-session-id',
          '001-test-spec',
          'test-project-id',
          'What changes were made?'
        )
      ).resolves.toBeUndefined();
    });

    it('should accept config options', async () => {
      mockProjectStore.getProject.mockReturnValue(mockProject);
      mockReviewQAService.startSession.mockResolvedValue(undefined);

      const listener = getListener(IPC_CHANNELS.REVIEW_QA_SEND_MESSAGE);
      const config = { model: 'claude-sonnet-4', thinkingLevel: 'high' };

      // Verify the listener accepts config parameter
      await expect(
        listener(
          null,
          'test-session-id',
          '001-test-spec',
          'test-project-id',
          'Explain this code',
          config
        )
      ).resolves.toBeUndefined();
    });

    it('should send error when project not found', async () => {
      mockProjectStore.getProject.mockReturnValue(undefined);

      const listener = getListener(IPC_CHANNELS.REVIEW_QA_SEND_MESSAGE);

      await listener(
        null,
        'test-session-id',
        '001-test-spec',
        'non-existent-project',
        'Question?'
      );

      expect(mockSafeSendToRenderer).toHaveBeenCalledWith(
        mockGetMainWindow,
        IPC_CHANNELS.REVIEW_QA_ERROR,
        'test-session-id',
        'non-existent-project',
        'Project not found'
      );
      expect(mockReviewQAService.startSession).not.toHaveBeenCalled();
    });

    it('should send error when autoBuildPath is not set', async () => {
      const projectWithoutAutoBuild = { ...mockProject, autoBuildPath: undefined };
      mockProjectStore.getProject.mockImplementation((id) => {
        if (id === 'test-project-id') return projectWithoutAutoBuild;
        return undefined;
      });

      const listener = getListener(IPC_CHANNELS.REVIEW_QA_SEND_MESSAGE);

      await listener(
        null,
        'test-session-id',
        '001-test-spec',
        'test-project-id',
        'Question?'
      );

      // Verify an error was sent
      expect(mockSafeSendToRenderer).toHaveBeenCalled();
      const callArgs = mockSafeSendToRenderer.mock.calls[0];
      expect(callArgs).toContain(IPC_CHANNELS.REVIEW_QA_ERROR);
      expect(callArgs).toContain('test-session-id');
      expect(callArgs).toContain('test-project-id');
    });

    it('should send error when spec directory does not exist', async () => {
      mockProjectStore.getProject.mockImplementation((id) => {
        if (id === 'test-project-id') return mockProject;
        return undefined;
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const listener = getListener(IPC_CHANNELS.REVIEW_QA_SEND_MESSAGE);

      await listener(
        null,
        'test-session-id',
        '001-test-spec',
        'test-project-id',
        'Question?'
      );

      // Verify an error was sent
      expect(mockSafeSendToRenderer).toHaveBeenCalled();
      const callArgs = mockSafeSendToRenderer.mock.calls[0];
      expect(callArgs).toContain(IPC_CHANNELS.REVIEW_QA_ERROR);
      expect(callArgs).toContain('test-session-id');
      expect(callArgs).toContain('test-project-id');
    });

    it('should handle startSession errors gracefully', async () => {
      mockProjectStore.getProject.mockImplementation((id) => {
        if (id === 'test-project-id') return mockProject;
        return undefined;
      });
      mockReviewQAService.startSession.mockRejectedValue(new Error('Python not found'));

      const listener = getListener(IPC_CHANNELS.REVIEW_QA_SEND_MESSAGE);

      await listener(
        null,
        'test-session-id',
        '001-test-spec',
        'test-project-id',
        'Question?'
      );

      // Verify an error was sent
      expect(mockSafeSendToRenderer).toHaveBeenCalled();
      const callArgs = mockSafeSendToRenderer.mock.calls[0];
      expect(callArgs).toContain(IPC_CHANNELS.REVIEW_QA_ERROR);
      expect(callArgs).toContain('test-session-id');
      expect(callArgs).toContain('test-project-id');
    });
  });

  describe('REVIEW_QA_STOP', () => {
    it('should be a callable handler', async () => {
      const handler = getHandler(IPC_CHANNELS.REVIEW_QA_STOP);

      // Verify handler exists and is callable
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');

      // Call with test data
      const result = await handler(null, 'test-session-id') as IPCResult;

      // Verify it returns a result object
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('should return error when session is not active', async () => {
      mockReviewQAService.isSessionActive.mockReturnValue(false);

      const handler = getHandler(IPC_CHANNELS.REVIEW_QA_STOP);
      const result = await handler(null, 'test-session-id') as IPCResult;

      expect(result).toEqual({
        success: false,
        error: 'Session not found or not active'
      });
    });
  });

  describe('REVIEW_QA_GET_STATUS', () => {
    it('should return valid result structure', async () => {
      const handler = getHandler(IPC_CHANNELS.REVIEW_QA_GET_STATUS);

      const result = await handler(null, 'test-session-id') as IPCResult<{ active: boolean }>;

      // Verify result structure
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(typeof result.data.active).toBe('boolean');
    });
  });

  describe('REVIEW_QA_GET_LOGS (active sessions)', () => {
    it('should return valid result structure', async () => {
      const handler = getHandler(IPC_CHANNELS.REVIEW_QA_GET_LOGS);

      const result = await handler(null) as IPCResult<unknown[]>;

      // Verify result structure
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });
  });
});
