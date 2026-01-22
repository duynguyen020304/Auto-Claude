/**
 * Rolling window rate limiter with per-project tracking
 *
 * Features:
 * - Per-project rate limiting using rolling time windows
 * - Automatic cleanup of old timestamps to prevent memory leaks
 * - Millisecond precision using Date.now()
 * - Independent tracking per project
 *
 * @example
 * ```ts
 * const limiter = new RollingWindowRateLimiter();
 *
 * // Check if session can start for project-1
 * // Limit: 10 sessions per 60 seconds (60000ms)
 * if (limiter.canStartSession('project-1', 10, 60000)) {
 *   // Session allowed - timestamp automatically recorded
 *   startSession();
 * } else {
 *   // Rate limit exceeded - must wait
 *   notifyUser('Rate limit exceeded, please wait');
 * }
 *
 * // Get current usage for a project
 * const usage = limiter.getUsage('project-1', 60000);
 * console.log(`Current usage: ${usage}/10 sessions`);
 *
 * // Clear timestamps for a project (e.g., after config change)
 * limiter.clearProject('project-1');
 *
 * // Clear all timestamps (e.g., app shutdown)
 * limiter.clearAll();
 * ```
 */
export class RollingWindowRateLimiter {
  /**
   * Map of project ID to array of timestamps (milliseconds since epoch)
   * Each timestamp represents a session start time
   */
  private windows = new Map<string, number[]>();

  /**
   * Check if a session can start for the given project based on rate limit
   *
   * This method:
   * 1. Cleans up old timestamps outside the rolling window (prevents memory leaks)
   * 2. Checks if the rate limit would be exceeded
   * 3. Records the current timestamp if under limit
   *
   * @param projectId - Project ID to check against rate limit
   * @param limit - Maximum number of sessions allowed in the time window
   * @param windowMs - Time window duration in milliseconds (e.g., 60000 for 1 minute)
   * @returns true if session can start (under rate limit), false if limit exceeded
   *
   * @example
   * ```ts
   * const limiter = new RollingWindowRateLimiter();
   *
   * // Allow up to 10 sessions per minute
   * if (limiter.canStartSession('project-1', 10, 60000)) {
   *   console.log('Session allowed');
   * } else {
   *   console.log('Rate limit exceeded');
   * }
   * ```
   */
  canStartSession(projectId: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const timestamps = this.windows.get(projectId) || [];

    // Clean up old timestamps outside the rolling window
    // This prevents memory leaks by removing timestamps that are no longer relevant
    const validTimestamps = timestamps.filter(t => now - t < windowMs);

    // Check if adding a new session would exceed the limit
    if (validTimestamps.length >= limit) {
      // Update window with cleaned timestamps (even though we're rejecting)
      // This ensures future checks work correctly
      // Remove project from map if no valid timestamps remain
      if (validTimestamps.length === 0) {
        this.windows.delete(projectId);
      } else {
        this.windows.set(projectId, validTimestamps);
      }
      return false;
    }

    // Add current timestamp and store
    validTimestamps.push(now);
    this.windows.set(projectId, validTimestamps);
    return true;
  }

  /**
   * Get the current usage count for a project within the time window
   *
   * This method does NOT modify the internal state or add timestamps.
   * It only reports how many sessions have been recorded.
   *
   * @param projectId - Project ID to check usage for
   * @param windowMs - Time window duration in milliseconds
   * @returns Number of sessions recorded within the time window
   *
   * @example
   * ```ts
   * const limiter = new RollingWindowRateLimiter();
   *
   * // Check current usage (limit: 10, window: 60000ms)
   * const usage = limiter.getUsage('project-1', 60000);
   * console.log(`Current usage: ${usage}/10`);
   * ```
   */
  getUsage(projectId: string, windowMs: number): number {
    const now = Date.now();
    const timestamps = this.windows.get(projectId) || [];

    // Filter and count timestamps within the window
    // Does NOT modify internal state
    return timestamps.filter(t => now - t < windowMs).length;
  }

  /**
   * Get the timestamp array for a project (for debugging/testing)
   *
   * @param projectId - Project ID to get timestamps for
   * @returns Copy of the timestamps array (empty array if not found)
   *
   * @example
   * ```ts
   * const timestamps = limiter.getTimestamps('project-1');
   * console.log('Recorded timestamps:', timestamps);
   * ```
   */
  getTimestamps(projectId: string): number[] {
    const timestamps = this.windows.get(projectId);
    return timestamps ? [...timestamps] : [];
  }

  /**
   * Clear all timestamps for a specific project
   *
   * Useful when:
   * - Rate limit configuration changes
   * - Project is deleted/archived
   * - Manual reset is needed
   *
   * @param projectId - Project ID to clear timestamps for
   *
   * @example
   * ```ts
   * // Clear timestamps after changing rate limit config
   * limiter.clearProject('project-1');
   * ```
   */
  clearProject(projectId: string): void {
    this.windows.delete(projectId);
  }

  /**
   * Clear all timestamps for all projects
   *
   * Useful when:
   * - App is shutting down
   * - Global reset is needed
   * - All rate limits are being recalibrated
   *
   * @example
   * ```ts
   * // Clear all rate limit data (e.g., on app shutdown)
   * limiter.clearAll();
   * ```
   */
  clearAll(): void {
    this.windows.clear();
  }

  /**
   * Get the number of projects currently being tracked
   *
   * Useful for monitoring and debugging memory usage.
   *
   * @returns Number of projects with recorded timestamps
   *
   * @example
   * ```ts
   * const projectCount = limiter.getProjectCount();
   * console.log(`Tracking ${projectCount} projects`);
   * ```
   */
  getProjectCount(): number {
    return this.windows.size;
  }

  /**
   * Get all project IDs currently being tracked
   *
   * Useful for debugging and monitoring.
   *
   * @returns Array of project IDs
   *
   * @example
   * ```ts
   * const projects = limiter.getTrackedProjects();
   * console.log('Tracked projects:', projects);
   * ```
   */
  getTrackedProjects(): string[] {
    return Array.from(this.windows.keys());
  }

  /**
   * Clean up old timestamps for a specific project
   *
   * This method only removes old timestamps and does NOT add a new one.
   * Use this for manual cleanup if needed (normally automatic in canStartSession).
   *
   * @param projectId - Project ID to clean up
   * @param windowMs - Time window duration in milliseconds
   * @returns Number of timestamps removed
   *
   * @example
   * ```ts
   * // Manual cleanup for a specific project
   * const removed = limiter.cleanup('project-1', 60000);
   * console.log(`Cleaned up ${removed} old timestamps`);
   * ```
   */
  cleanup(projectId: string, windowMs: number): number {
    const timestamps = this.windows.get(projectId);
    if (!timestamps) {
      return 0;
    }

    const now = Date.now();
    const initialLength = timestamps.length;
    const validTimestamps = timestamps.filter(t => now - t < windowMs);

    if (validTimestamps.length === 0) {
      // No valid timestamps remain, remove the project entirely
      this.windows.delete(projectId);
      return initialLength;
    }

    if (validTimestamps.length < initialLength) {
      // Only update if timestamps were actually removed
      this.windows.set(projectId, validTimestamps);
    }

    return initialLength - validTimestamps.length;
  }

  /**
   * Clean up old timestamps for all tracked projects
   *
   * This method iterates through all projects and removes old timestamps.
   * Useful for periodic maintenance to prevent memory buildup.
   *
   * @param windowMs - Time window duration in milliseconds
   * @returns Total number of timestamps removed across all projects
   *
   * @example
   * ```ts
   * // Periodic cleanup for all projects
   * const totalRemoved = limiter.cleanupAll(60000);
   * console.log(`Cleaned up ${totalRemoved} old timestamps across all projects`);
   * ```
   */
  cleanupAll(windowMs: number): number {
    let totalRemoved = 0;

    for (const [projectId, timestamps] of this.windows.entries()) {
      totalRemoved += this.cleanup(projectId, windowMs);
    }

    return totalRemoved;
  }
}
