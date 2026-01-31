import { EventEmitter } from 'events';
import type {
  InsightsSession,
  InsightsSessionSummary,
  InsightsChatMessage,
  InsightsModelConfig,
} from '../shared/types';
import { InsightsConfig } from './insights/config';
import { InsightsPaths } from './insights/paths';
import { SessionStorage } from './insights/session-storage';
import { SessionManager } from './insights/session-manager';
import { InsightsExecutor } from './insights/insights-executor';
import { SessionQueue } from './insights/session-queue';
import type { ActiveSession } from './insights/session-queue';

/**
 * Service for AI-powered codebase insights chat
 *
 * This service coordinates between multiple specialized modules:
 * - InsightsConfig: Manages configuration and environment
 * - InsightsPaths: Provides consistent path resolution
 * - SessionStorage: Handles filesystem persistence
 * - SessionManager: Manages session lifecycle and cache
 * - InsightsExecutor: Executes Python insights runner
 */
export class InsightsService extends EventEmitter {
  private config: InsightsConfig;
  private paths: InsightsPaths;
  private storage: SessionStorage;
  private sessionManager: SessionManager;
  private executor: InsightsExecutor;
  private sessionQueue: SessionQueue;

  constructor() {
    super();

    // Initialize modules
    this.config = new InsightsConfig();
    this.paths = new InsightsPaths();
    this.storage = new SessionStorage(this.paths);
    this.sessionManager = new SessionManager(this.storage, this.paths);
    // Initialize session queue with config from InsightsConfig
    this.sessionQueue = new SessionQueue(this.config.getSessionQueueConfig());
    this.executor = new InsightsExecutor(this.config, this.sessionQueue);

    // Forward executor events with both sessionId and projectId for proper routing
    this.executor.on('status', (sessionId, status) => {
      const projectId = this.sessionQueue.getProjectIdForActiveSession(sessionId);
      if (projectId) {
        this.emit('status', sessionId, projectId, status);
      } else {
        // Fallback to sessionId-only if session not found in queue
        this.emit('status', sessionId, sessionId, status);
      }
    });
    this.executor.on('stream-chunk', (sessionId, chunk) => {
      const projectId = this.sessionQueue.getProjectIdForActiveSession(sessionId);
      if (projectId) {
        this.emit('stream-chunk', sessionId, projectId, chunk);
      } else {
        // Fallback to sessionId-only if session not found in queue
        this.emit('stream-chunk', sessionId, sessionId, chunk);
      }
    });
    this.executor.on('error', (sessionId, error) => {
      const projectId = this.sessionQueue.getProjectIdForActiveSession(sessionId);
      if (projectId) {
        this.emit('error', sessionId, projectId, error);
      } else {
        // Fallback to sessionId-only if session not found in queue
        this.emit('error', sessionId, sessionId, error);
      }
    });
    this.executor.on('sdk-rate-limit', (sessionId, info) => {
      this.emit('sdk-rate-limit', info);
    });
  }

  /**
   * Configure paths for Python and auto-claude source
   */
  configure(pythonPath?: string, autoBuildSourcePath?: string): void {
    this.config.configure(pythonPath, autoBuildSourcePath);
  }

  /**
   * Load current session from disk or cache
   */
  loadSession(projectId: string, projectPath: string): InsightsSession | null {
    return this.sessionManager.loadSession(projectId, projectPath);
  }

  /**
   * List all sessions for a project
   */
  listSessions(projectPath: string): InsightsSessionSummary[] {
    return this.sessionManager.listSessions(projectPath);
  }

  /**
   * Create a new session
   */
  createNewSession(projectId: string, projectPath: string): InsightsSession {
    return this.sessionManager.createNewSession(projectId, projectPath);
  }

  /**
   * Switch to a different session
   */
  switchSession(projectId: string, projectPath: string, sessionId: string): InsightsSession | null {
    return this.sessionManager.switchSession(projectId, projectPath, sessionId);
  }

  /**
   * Delete a session
   */
  deleteSession(projectId: string, projectPath: string, sessionId: string): boolean {
    return this.sessionManager.deleteSession(projectId, projectPath, sessionId);
  }

  /**
   * Rename a session
   */
  renameSession(projectPath: string, sessionId: string, newTitle: string): boolean {
    return this.sessionManager.renameSession(projectPath, sessionId, newTitle);
  }

  /**
   * Clear current session (delete messages but keep the session)
   */
  clearSession(projectId: string, projectPath: string): void {
    this.sessionManager.clearSession(projectId, projectPath);
  }

  /**
   * Send a message and get AI response
   * @param sessionIdOrProjectId - Session ID (new) or Project ID (old, for backward compatibility)
   * @param projectIdOrPath - Project ID (new) or Project Path (old, for backward compatibility)
   * @param projectPathOrMessage - Project Path (new) or Message (old, for backward compatibility)
   * @param messageOrConfig - Message (new) or Model Config (old, for backward compatibility)
   * @param modelConfig - Model Config (optional)
   */
  async sendMessage(
    sessionIdOrProjectId: string,
    projectIdOrPath?: string,
    projectPathOrMessage?: string,
    messageOrConfig?: string | InsightsModelConfig,
    modelConfig?: InsightsModelConfig
  ): Promise<void> {
    // Detect which signature is being used based on parameter types
    // Old: (projectId: string, projectPath: string, message: string, modelConfig?)
    // New: (sessionId: string, projectId: string, projectPath: string, message: string, modelConfig?)

    let session: InsightsSession | null;
    let targetProjectId: string;
    let targetProjectPath: string;
    let targetMessage: string;
    let targetModelConfig: InsightsModelConfig | undefined;

    // Check if using new signature by looking at parameter types
    const usingNewSignature =
      projectIdOrPath !== undefined &&
      projectPathOrMessage !== undefined &&
      typeof messageOrConfig === 'string';

    if (usingNewSignature) {
      // New signature: sendMessage(sessionId, projectId, projectPath, message, modelConfig?)
      targetProjectId = projectIdOrPath;
      targetProjectPath = projectPathOrMessage;
      targetMessage = messageOrConfig as string;
      targetModelConfig = modelConfig;

      // Load session by ID
      session = this.storage.loadSessionById(targetProjectPath, sessionIdOrProjectId);
      if (!session) {
        this.emit('error', targetProjectId, `Session ${sessionIdOrProjectId} not found`);
        return;
      }
    } else {
      // Old signature: sendMessage(projectId, projectPath, message, modelConfig?)
      // for backward compatibility during phased migration
      targetProjectId = sessionIdOrProjectId;
      targetProjectPath = projectIdOrPath!;
      targetMessage = projectPathOrMessage as string;
      targetModelConfig = messageOrConfig as InsightsModelConfig | undefined;

      // Load or create session (old behavior)
      session = this.sessionManager.loadSession(targetProjectId, targetProjectPath);
      if (!session) {
        session = this.sessionManager.createNewSession(targetProjectId, targetProjectPath);
      }
    }

    // Validate auto-claude source
    const autoBuildSource = this.config.getAutoBuildSourcePath();
    if (!autoBuildSource) {
      this.emit('error', targetProjectId, 'Auto Claude source not found');
      return;
    }

    // Auto-generate title from first user message if still default
    if (session.messages.length === 0 && session.title === 'New Conversation') {
      session.title = this.storage.generateTitle(targetMessage);
    }

    // Add user message
    const userMessage: InsightsChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: targetMessage,
      timestamp: new Date(),
    };
    session.messages.push(userMessage);
    session.updatedAt = new Date();
    this.sessionManager.saveSession(targetProjectPath, session);

    // Build conversation history for context
    const conversationHistory = session.messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    // Use provided modelConfig or fall back to session's config
    const configToUse = targetModelConfig || session.modelConfig;

    try {
      // Execute insights query
      const roadmapItemId = session.roadmapContext?.featureId;
      const result = await this.executor.execute(
        session.id,
        targetProjectId,
        targetProjectPath,
        targetMessage,
        conversationHistory,
        configToUse,
        undefined, // priority - use default
        roadmapItemId
      );

      // Add assistant message to session
      const assistantMessage: InsightsChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: result.fullResponse,
        timestamp: new Date(),
        suggestedTask: result.suggestedTask,
        toolsUsed: result.toolsUsed.length > 0 ? result.toolsUsed : undefined
      };

      session.messages.push(assistantMessage);
      session.updatedAt = new Date();
      this.sessionManager.saveSession(targetProjectPath, session);

      // Emit session-updated event for real-time UI updates
      this.emit('session-updated', targetProjectId, session);
    } catch (error) {
      // Error already emitted by executor
      console.error('[InsightsService] Error executing insights:', error);
    }
  }

  /**
   * Update model configuration for a session
   */
  updateSessionModelConfig(projectPath: string, sessionId: string, modelConfig: InsightsModelConfig): boolean {
    return this.sessionManager.updateSessionModelConfig(projectPath, sessionId, modelConfig);
  }

  /**
   * Cancel a session by ID
   * Handles both queued sessions (waiting to start) and active sessions (currently running)
   * @param sessionId - Session ID to cancel
   * @returns true if session was cancelled, false if session was not found
   */
  cancelSession(sessionId: string): boolean {
    // First, try to cancel from queue if it's waiting
    if (this.sessionQueue.isQueued(sessionId)) {
      return this.sessionQueue.cancel(sessionId);
    }

    // If not in queue, check if it's active and cancel the running process
    if (this.sessionQueue.isActive(sessionId)) {
      const projectId = this.sessionQueue.getProjectIdForActiveSession(sessionId);
      if (!projectId) {
        console.error(`[InsightsService] Session ${sessionId} is active but has no project ID`);
        return false;
      }
      return this.executor.cancelSession(sessionId, projectId);
    }

    // Session not found in queue or active
    return false;
  }

  /**
   * Get list of currently active (running) sessions
   * @returns Array of active sessions with metadata
   */
  getActiveSessions(): ActiveSession[] {
    return this.sessionQueue.getActiveSessions();
  }
}

// Singleton instance
export const insightsService = new InsightsService();
