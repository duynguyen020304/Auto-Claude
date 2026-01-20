/**
 * Task Operation Queue
 *
 * Serializes task operations to prevent race conditions between
 * conflicting operations like refresh, delete, start, and update.
 *
 * This prevents issues where:
 * - Refresh conflicts with delete (deleted task reappears)
 * - Refresh conflicts with start (progress lost)
 * - Multiple rapid clicks create overlapping operations
 *
 * Usage:
 * ```typescript
 * const queue = new TaskOperationQueue();
 *
 * // Enqueue operations to ensure they run sequentially
 * await queue.enqueue(() => loadTasks());
 * await queue.enqueue(() => deleteTask(id));
 * await queue.enqueue(() => startTask(id));
 * ```
 *
 * Inspired by:
 * - Operation queue pattern for concurrent request serialization
 * - Mutex pattern for preventing conflicting operations
 */

export interface TaskOperationQueueStats {
  totalOperations: number;
  completedOperations: number;
  failedOperations: number;
  currentQueueLength: number;
  isProcessing: boolean;
}

export interface QueuedOperation<T = unknown> {
  id: string;
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

export class TaskOperationQueue {
  private queue: QueuedOperation[] = [];
  private isProcessing = false;
  private currentOperationId: string | null = null;

  // Statistics for debugging/monitoring
  private stats = {
    totalOperations: 0,
    completedOperations: 0,
    failedOperations: 0,
  };

  /**
   * Enqueue an operation to be executed sequentially
   *
   * Operations are guaranteed to run in the order they are enqueued.
   * Each operation waits for the previous one to complete before starting.
   *
   * @param operation - Async function to execute
   * @returns Promise that resolves with the operation's result
   *
   * @example
   * ```typescript
   * const result = await queue.enqueue(async () => {
   *   return await fetchTasks();
   * });
   * ```
   */
  async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const operationId = this.generateOperationId();

      const queuedOp: QueuedOperation<T> = {
        id: operationId,
        operation,
        resolve: resolve as (value: unknown) => void,
        reject: (error: Error) => reject(error),
        timestamp: Date.now(),
      };

      this.queue.push(queuedOp);
      this.stats.totalOperations++;

      // Start processing if not already running
      if (!this.isProcessing) {
        void this.processQueue();
      }
    });
  }

  /**
   * Process the queue sequentially
   *
   * This is the core logic that ensures operations run one at a time.
   * It waits for each operation to complete before starting the next.
   */
  private async processQueue(): Promise<void> {
    // Guard against concurrent processing
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const queuedOp = this.queue.shift();

        if (!queuedOp) {
          continue;
        }

        this.currentOperationId = queuedOp.id;

        try {
          // Execute the operation
          const result = await queuedOp.operation();

          // Resolve the promise with the result
          queuedOp.resolve(result);

          this.stats.completedOperations++;
        } catch (error) {
          // Reject the promise with the error
          queuedOp.reject(error instanceof Error ? error : new Error(String(error)));

          this.stats.failedOperations++;

          // Log for debugging
          console.error('[TaskOperationQueue] Operation failed:', {
            operationId: queuedOp.id,
            error: error instanceof Error ? error.message : String(error),
            queueLength: this.queue.length,
          });
        }

        this.currentOperationId = null;
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Generate a unique operation ID for tracking
   */
  private generateOperationId(): string {
    return `op-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Check if an operation is currently being processed
   */
  isOperationInProgress(): boolean {
    return this.isProcessing;
  }

  /**
   * Get the ID of the currently running operation
   */
  getCurrentOperationId(): string | null {
    return this.currentOperationId;
  }

  /**
   * Get the current queue length (number of pending operations)
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Clear all pending operations from the queue
   *
   * This does NOT cancel the currently running operation,
   * only prevents future queued operations from executing.
   *
   * @returns Array of operation IDs that were cleared
   */
  clearQueue(): string[] {
    const clearedIds = this.queue.map((op) => op.id);

    // Reject all pending operations
    this.queue.forEach((op) => {
      op.reject(new Error('Operation cancelled - queue cleared'));
    });

    this.queue = [];

    return clearedIds;
  }

  /**
   * Get statistics for monitoring/debugging
   */
  getStats(): TaskOperationQueueStats {
    return {
      totalOperations: this.stats.totalOperations,
      completedOperations: this.stats.completedOperations,
      failedOperations: this.stats.failedOperations,
      currentQueueLength: this.queue.length,
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Reset statistics (useful for testing)
   */
  resetStats(): void {
    this.stats = {
      totalOperations: 0,
      completedOperations: 0,
      failedOperations: 0,
    };
  }

  /**
   * Wait for all currently queued operations to complete
   *
   * This does NOT prevent new operations from being added while waiting.
   * Use with caution to avoid deadlocks.
   */
  async drain(): Promise<void> {
    while (this.isProcessing || this.queue.length > 0) {
      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

/**
 * Global singleton instance for task operations
 *
 * Most use cases should use this singleton to ensure
 * all task operations are serialized through a single queue.
 */
let globalQueueInstance: TaskOperationQueue | null = null;

/**
 * Get the global task operation queue instance
 *
 * @returns The singleton TaskOperationQueue instance
 */
export function getTaskOperationQueue(): TaskOperationQueue {
  if (!globalQueueInstance) {
    globalQueueInstance = new TaskOperationQueue();
  }
  return globalQueueInstance;
}

/**
 * Reset the global task operation queue instance
 *
 * This is primarily useful for testing to ensure test isolation.
 * In production code, you should rarely need to call this.
 */
export function resetGlobalTaskOperationQueue(): void {
  if (globalQueueInstance) {
    globalQueueInstance.clearQueue();
  }
  globalQueueInstance = null;
}
