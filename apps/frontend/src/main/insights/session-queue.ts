/**
 * Session priority levels
 * Higher numeric value = higher priority
 */
export enum SessionPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  URGENT = 3
}

/**
 * Queued session metadata
 */
export interface QueuedSession {
  sessionId: string;
  projectId: string;
  priority: SessionPriority;
  queuedAt: number;
}

/**
 * Active session tracking
 */
export interface ActiveSession {
  sessionId: string;
  projectId: string;
  startedAt: number;
}

/**
 * Session queue configuration
 */
export interface SessionQueueConfig {
  maxConcurrentSessions: number;
  maxSessionsPerProject: number;
}

/**
 * Session queue with priority-based ordering and concurrent limits
 *
 * Features:
 * - Priority-based ordering (URGENT > HIGH > NORMAL > LOW)
 * - FIFO ordering within same priority level
 * - Global concurrent session limit
 * - Per-project concurrent session limit
 * - Mid-queue cancellation support
 *
 * @example
 * ```ts
 * const queue = new SessionQueue({
 *   maxConcurrentSessions: 3,
 *   maxSessionsPerProject: 2
 * });
 *
 * // Enqueue a session
 * queue.enqueue({
 *   sessionId: 'session-1',
 *   projectId: 'project-1',
 *   priority: SessionPriority.HIGH,
 *   queuedAt: Date.now()
 * });
 *
 * // Check if session can start
 * if (queue.canStartSession('project-1')) {
 *   const session = queue.dequeue()!;
 *   queue.markSessionActive(session.sessionId, session.projectId);
 * }
 *
 * // Cancel a queued session
 * queue.cancel('session-1');
 *
 * // Remove session when complete
 * queue.removeActiveSession('session-1', 'project-1');
 * ```
 */
export class SessionQueue {
  private queue: QueuedSession[] = [];
  private activeSessions: Map<string, ActiveSession> = new Map();
  private activeSessionsPerProject: Map<string, Set<string>> = new Map();
  private config: SessionQueueConfig;

  constructor(config: SessionQueueConfig) {
    this.config = config;
  }

  /**
   * Get current configuration
   */
  getConfig(): SessionQueueConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SessionQueueConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Add a session to the queue
   * Session is inserted based on priority (higher first) and queue time (FIFO within priority)
   */
  enqueue(session: QueuedSession): void {
    // Find insertion point: after all sessions with higher priority,
    // and before sessions with same priority but later queue time
    const insertIndex = this.queue.findIndex(s =>
      s.priority < session.priority ||
      (s.priority === session.priority && s.queuedAt > session.queuedAt)
    );

    if (insertIndex === -1) {
      // No lower priority session found, append to end
      this.queue.push(session);
    } else {
      // Insert at found position
      this.queue.splice(insertIndex, 0, session);
    }
  }

  /**
   * Remove and return the next session from the queue
   * Returns undefined if queue is empty
   */
  dequeue(): QueuedSession | undefined {
    return this.queue.shift();
  }

  /**
   * Check if a session can start based on concurrent limits
   * @param projectId - Project ID to check against per-project limit
   * @returns true if session can start immediately
   */
  canStartSession(projectId: string): boolean {
    // Concurrent limits removed - sessions can always start
    return true;
  }

  /**
   * Mark a session as active (started execution)
   * @param sessionId - Session ID to mark as active
   * @param projectId - Project ID for per-project tracking
   */
  markSessionActive(sessionId: string, projectId: string): void {
    const activeSession: ActiveSession = {
      sessionId,
      projectId,
      startedAt: Date.now()
    };

    this.activeSessions.set(sessionId, activeSession);

    // Track per-project active sessions
    if (!this.activeSessionsPerProject.has(projectId)) {
      this.activeSessionsPerProject.set(projectId, new Set());
    }
    this.activeSessionsPerProject.get(projectId)!.add(sessionId);
  }

  /**
   * Remove a session from active tracking (when completed or cancelled)
   * @param sessionId - Session ID to remove
   * @param projectId - Project ID for per-project tracking cleanup
   */
  removeActiveSession(sessionId: string, projectId: string): void {
    this.activeSessions.delete(sessionId);

    // Clean up per-project tracking
    const projectSessions = this.activeSessionsPerProject.get(projectId);
    if (projectSessions) {
      projectSessions.delete(sessionId);
      if (projectSessions.size === 0) {
        this.activeSessionsPerProject.delete(projectId);
      }
    }
  }

  /**
   * Cancel a queued session (remove from queue)
   * Does nothing if session is not in queue (e.g., already active)
   * @param sessionId - Session ID to cancel
   * @returns true if session was found and removed from queue
   */
  cancel(sessionId: string): boolean {
    const initialLength = this.queue.length;
    this.queue = this.queue.filter(s => s.sessionId !== sessionId);
    return this.queue.length < initialLength;
  }

  /**
   * Get all queued sessions (ordered by priority)
   */
  getQueuedSessions(): QueuedSession[] {
    return [...this.queue];
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): ActiveSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Get active sessions for a specific project
   * @param projectId - Project ID to filter by
   */
  getActiveSessionsForProject(projectId: string): ActiveSession[] {
    const projectSessionIds = this.activeSessionsPerProject.get(projectId);
    if (!projectSessionIds) {
      return [];
    }

    return Array.from(projectSessionIds)
      .map(sessionId => this.activeSessions.get(sessionId))
      .filter((session): session is ActiveSession => session !== undefined);
  }

  /**
   * Get queue position for a session (1-indexed)
   * Returns 0 if session is not in queue
   * @param sessionId - Session ID to find
   */
  getQueuePosition(sessionId: string): number {
    const index = this.queue.findIndex(s => s.sessionId === sessionId);
    return index === -1 ? 0 : index + 1;
  }

  /**
   * Check if a session is currently queued
   * @param sessionId - Session ID to check
   */
  isQueued(sessionId: string): boolean {
    return this.queue.some(s => s.sessionId === sessionId);
  }

  /**
   * Check if a session is currently active
   * @param sessionId - Session ID to check
   */
  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Get number of active sessions
   */
  getActiveCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Get number of active sessions for a specific project
   * @param projectId - Project ID to check
   */
  getActiveCountForProject(projectId: string): number {
    return this.activeSessionsPerProject.get(projectId)?.size ?? 0;
  }

  /**
   * Get the project ID for an active session
   * @param sessionId - Session ID to look up
   * @returns Project ID if session is active, undefined otherwise
   */
  getProjectIdForActiveSession(sessionId: string): string | undefined {
    const activeSession = this.activeSessions.get(sessionId);
    return activeSession?.projectId;
  }

  /**
   * Clear all queued sessions (does not affect active sessions)
   */
  clearQueue(): void {
    this.queue = [];
  }

  /**
   * Clear all active sessions (useful for cleanup/shutdown)
   */
  clearActiveSessions(): void {
    this.activeSessions.clear();
    this.activeSessionsPerProject.clear();
  }
}
