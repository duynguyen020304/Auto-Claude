/**
 * Review QA IPC Handlers
 *
 * IPC handlers for AI-powered code explanation during the human review phase.
 * Handles streaming responses from the Python review_qa_runner.py script.
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { ReviewQAService, ReviewQAConfigOptions } from '../review-qa-service';
import { projectStore } from '../project-store';
import { safeSendToRenderer } from './utils';
import {
  IPC_CHANNELS,
  AUTO_BUILD_PATHS,
} from '../../shared/constants';
import type {
  IPCResult,
} from '../../shared/types';
import path from 'path';
import { existsSync } from 'fs';

// Global service instance (initialized during handler registration)
let reviewQAService: ReviewQAService | null = null;

/**
 * Get the spec directory path for a given task
 */
function getSpecDirForTask(projectPath: string, specId: string): string {
  const specsBaseDir = AUTO_BUILD_PATHS.SPECS_DIR;
  return path.join(projectPath, specsBaseDir, specId);
}

/**
 * Register all review QA IPC handlers
 *
 * @param getMainWindow - Function to get the main BrowserWindow
 */
export function registerReviewQAHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  // Initialize the service if not already created
  if (!reviewQAService) {
    reviewQAService = new ReviewQAService();
  }

  // ============================================
  // Review QA Operations
  // ============================================

  /**
   * Start a review QA session and send a question
   * This is a fire-and-forget operation that streams responses via events
   */
  ipcMain.on(
    IPC_CHANNELS.REVIEW_QA_SEND_MESSAGE,
    async (
      _,
      sessionId: string,
      specId: string,
      projectId: string,
      question: string,
      config?: ReviewQAConfigOptions
    ) => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.REVIEW_QA_ERROR,
          sessionId,
          projectId,
          'Project not found'
        );
        return;
      }

      if (!project.autoBuildPath) {
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.REVIEW_QA_ERROR,
          sessionId,
          projectId,
          'Auto Claude not initialized for this project'
        );
        return;
      }

      try {
        // Get spec directory path
        const specDir = getSpecDirForTask(project.path, specId);

        // Verify spec directory exists
        if (!existsSync(specDir)) {
          safeSendToRenderer(
            getMainWindow,
            IPC_CHANNELS.REVIEW_QA_ERROR,
            sessionId,
            projectId,
            `Spec directory not found: ${specId}`
          );
          return;
        }

        // Configure the service with the project's autoBuildPath
        reviewQAService!.configure(undefined, project.autoBuildPath);

        // Start the review QA session
        await reviewQAService!.startSession(
          sessionId,
          specId,
          projectId,
          specDir,
          question,
          config
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[Review QA IPC] Error starting session:', error);
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.REVIEW_QA_ERROR,
          sessionId,
          projectId,
          `Failed to start review QA: ${errorMessage}`
        );
      }
    }
  );

  /**
   * Cancel an active review QA session
   */
  ipcMain.handle(
    IPC_CHANNELS.REVIEW_QA_STOP,
    async (_, sessionId: string): Promise<IPCResult> => {
      if (!reviewQAService) {
        return { success: false, error: 'Review QA service not initialized' };
      }

      if (!reviewQAService.isSessionActive(sessionId)) {
        return { success: false, error: 'Session not found or not active' };
      }

      const cancelled = reviewQAService.cancelSession(sessionId);
      if (cancelled) {
        return { success: true };
      }
      return { success: false, error: 'Failed to cancel session' };
    }
  );

  /**
   * Get the status of a review QA session
   */
  ipcMain.handle(
    IPC_CHANNELS.REVIEW_QA_GET_STATUS,
    async (_, sessionId: string): Promise<IPCResult<{ active: boolean }>> => {
      if (!reviewQAService) {
        return { success: true, data: { active: false } };
      }

      const isActive = reviewQAService.isSessionActive(sessionId);
      return { success: true, data: { active: isActive } };
    }
  );

  /**
   * Get all active review QA sessions
   */
  ipcMain.handle(
    IPC_CHANNELS.REVIEW_QA_GET_LOGS, // Reusing existing channel for session info
    async (): Promise<IPCResult<Array<{ sessionId: string; specId: string; projectId: string }>>> => {
      if (!reviewQAService) {
        return { success: true, data: [] };
      }

      const activeSessions = reviewQAService.getActiveSessions();
      const sessions = activeSessions.map((s) => ({
        sessionId: s.sessionId,
        specId: s.specId,
        projectId: s.projectId,
      }));
      return { success: true, data: sessions };
    }
  );

  // ============================================
  // Review QA Event Forwarding (Service -> Renderer)
  // ============================================

  // Forward streaming chunks to renderer (routed by sessionId, projectId)
  reviewQAService!.on('stream-chunk', (sessionId: string, projectId: string, chunk: unknown) => {
    safeSendToRenderer(
      getMainWindow,
      IPC_CHANNELS.REVIEW_QA_STREAM_CHUNK,
      sessionId,
      projectId,
      chunk
    );
  });

  // Forward status updates to renderer
  reviewQAService!.on('status', (sessionId: string, projectId: string, status: unknown) => {
    safeSendToRenderer(
      getMainWindow,
      IPC_CHANNELS.REVIEW_QA_PROGRESS,
      sessionId,
      projectId,
      status
    );
  });

  // Forward errors to renderer
  reviewQAService!.on('error', (sessionId: string, projectId: string, error: string) => {
    safeSendToRenderer(
      getMainWindow,
      IPC_CHANNELS.REVIEW_QA_ERROR,
      sessionId,
      projectId,
      error
    );
  });
}
