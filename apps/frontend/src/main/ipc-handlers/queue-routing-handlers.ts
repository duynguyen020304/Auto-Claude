/**
 * Queue Routing IPC Handlers
 *
 * Handles IPC communication for the rate limit recovery queue routing system.
 * Provides profile-aware task distribution to enable overnight autonomous operation.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { AgentManager } from '../agent/agent-manager';
import type { ProfileAssignmentReason, RunningTasksByProfile, ClaudeProfile } from '../../shared/types';
import type { ClaudeProfileManager } from '../claude-profile-manager';

/**
 * Register queue routing IPC handlers
 */
export function registerQueueRoutingHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null,
  profileManager?: ClaudeProfileManager
): void {
  // Get running tasks grouped by profile
  ipcMain.handle(
    IPC_CHANNELS.QUEUE_GET_RUNNING_TASKS_BY_PROFILE,
    async (): Promise<{ success: boolean; data?: RunningTasksByProfile; error?: string }> => {
      try {
        const data = agentManager.getRunningTasksByProfile();
        return { success: true, data };
      } catch (error) {
        console.error('[QueueRouting] Failed to get running tasks by profile:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Get best profile for a task
  ipcMain.handle(
    IPC_CHANNELS.QUEUE_GET_BEST_PROFILE_FOR_TASK,
    async (
      _event,
      options?: {
        /** Profile ID to exclude (e.g., one that just hit rate limit) */
        excludeProfileId?: string;
        /** Maximum tasks per profile before load balancing (default: 2) */
        perProfileMaxTasks?: number;
        /** Usage threshold (0-1) before considering profile "busy" (default: 0.85) */
        profileThreshold?: number;
        /** API profile ID from task metadata ('auto' for rotation strategy, or specific profile ID) */
        apiProfileId?: string;
      }
    ): Promise<{ success: boolean; data?: ClaudeProfile | null; error?: string }> => {
      try {
        // If no profile manager is available, return null (no preference)
        if (!profileManager) {
          console.log('[QueueRouting] Profile manager not available, returning null');
          return { success: true, data: null };
        }

        // Handle explicit profile selection vs 'auto' rotation strategy
        if (options?.apiProfileId && options.apiProfileId !== 'auto') {
          // Specific profile requested - find and return it
          const profile = profileManager.getProfile(options.apiProfileId);
          if (profile) {
            console.log('[QueueRouting] Using specific profile from task metadata:', {
              profileId: profile.id,
              profileName: profile.name
            });
            return { success: true, data: profile };
          } else {
            console.warn('[QueueRouting] Requested profile not found:', options.apiProfileId);
            return { success: true, data: null };
          }
        }

        // 'auto' profile selection or no profile specified - use rotation strategy
        const settings = profileManager.getAutoSwitchSettings();

        // If auto-switching is disabled, return null (no preference)
        if (!settings.enabled) {
          console.log('[QueueRouting] Auto-switching disabled, returning null');
          return { success: true, data: null };
        }

        // Use getBestAvailableProfile which internally handles:
        // - Rotation strategy from settings (priority, round-robin, least-used, random, weighted, time-based)
        // - Profile authentication status
        // - Rate limit status
        // - Usage thresholds (session and weekly)
        const selectionResult = profileManager.getBestAvailableProfile(
          options?.excludeProfileId
        );

        // Persist rotation state if provided (for round-robin, time-based strategies)
        if (selectionResult.stateUpdates) {
          profileManager.updateAutoSwitchSettings(selectionResult.stateUpdates);
          console.log('[QueueRouting] Persisted rotation state:', selectionResult.stateUpdates);
        }

        const bestProfile = selectionResult.profile;

        if (bestProfile) {
          const strategy = settings.rotationStrategy || 'priority';
          console.log('[QueueRouting] Best profile selected using rotation strategy:', {
            profileId: bestProfile.id,
            profileName: bestProfile.name,
            strategy,
            excludedId: options?.excludeProfileId,
            apiProfileId: options?.apiProfileId || 'not specified'
          });
        } else {
          console.log('[QueueRouting] No suitable profile found for task routing');
        }

        return { success: true, data: bestProfile };
      } catch (error) {
        console.error('[QueueRouting] Failed to get best profile for task:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Assign a profile to a task
  ipcMain.handle(
    IPC_CHANNELS.QUEUE_ASSIGN_PROFILE_TO_TASK,
    async (
      _event,
      taskId: string,
      profileId: string,
      profileName: string,
      reason: ProfileAssignmentReason
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        agentManager.assignProfileToTask(taskId, profileId, profileName, reason);
        return { success: true };
      } catch (error) {
        console.error('[QueueRouting] Failed to assign profile to task:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Update session ID for a task
  ipcMain.handle(
    IPC_CHANNELS.QUEUE_UPDATE_TASK_SESSION,
    async (
      _event,
      taskId: string,
      sessionId: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        agentManager.updateTaskSession(taskId, sessionId);
        return { success: true };
      } catch (error) {
        console.error('[QueueRouting] Failed to update task session:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Get session ID for a task
  ipcMain.handle(
    IPC_CHANNELS.QUEUE_GET_TASK_SESSION,
    async (
      _event,
      taskId: string
    ): Promise<{ success: boolean; data?: string | null; error?: string }> => {
      try {
        const sessionId = agentManager.getTaskSessionId(taskId);
        return { success: true, data: sessionId ?? null };
      } catch (error) {
        console.error('[QueueRouting] Failed to get task session:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Forward events from agent manager to renderer

  // Profile swapped event
  agentManager.on('profile-swapped', (taskId: string, swap: unknown) => {
    const win = getMainWindow();
    if (win) {
      win.webContents.send(IPC_CHANNELS.QUEUE_PROFILE_SWAPPED, { taskId, swap });
    }
  });

  // Session captured event
  agentManager.on('session-captured', (taskId: string, sessionId: string) => {
    const win = getMainWindow();
    if (win) {
      win.webContents.send(IPC_CHANNELS.QUEUE_SESSION_CAPTURED, {
        taskId,
        sessionId,
        capturedAt: new Date().toISOString()
      });
    }
  });

  // Queue blocked event (no available profiles)
  agentManager.on('queue-blocked-no-profiles', (info: { reason: string }) => {
    const win = getMainWindow();
    if (win) {
      win.webContents.send(IPC_CHANNELS.QUEUE_BLOCKED_NO_PROFILES, {
        ...info,
        timestamp: new Date().toISOString()
      });
    }
  });

  console.log('[QueueRouting] IPC handlers registered');
}
