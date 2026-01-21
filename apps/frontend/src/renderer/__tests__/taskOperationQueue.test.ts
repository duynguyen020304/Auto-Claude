/**
 * Unit tests for Task Operation Queue
 * Tests operation serialization, error handling, and queue management
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskOperationQueue,
  getTaskOperationQueue,
  resetGlobalTaskOperationQueue,
  type TaskOperationQueueStats,
} from '../lib/taskOperationQueue';

describe('TaskOperationQueue', () => {
  let queue: TaskOperationQueue;

  beforeEach(() => {
    queue = new TaskOperationQueue();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetGlobalTaskOperationQueue();
  });

  describe('enqueue', () => {
    it('should execute operations sequentially', async () => {
      const executionOrder: number[] = [];

      // Enqueue multiple operations
      const op1 = queue.enqueue(async () => {
        executionOrder.push(1);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'result1';
      });

      const op2 = queue.enqueue(async () => {
        executionOrder.push(2);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 'result2';
      });

      const op3 = queue.enqueue(async () => {
        executionOrder.push(3);
        return 'result3';
      });

      // Wait for all to complete
      const results = await Promise.all([op1, op2, op3]);

      // Verify execution order
      expect(executionOrder).toEqual([1, 2, 3]);

      // Verify results
      expect(results).toEqual(['result1', 'result2', 'result3']);
    });

    it('should return operation result', async () => {
      const result = await queue.enqueue(async () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it('should handle synchronous operations', async () => {
      const result = await queue.enqueue(() => {
        return Promise.resolve('sync result');
      });

      expect(result).toBe('sync result');
    });

    it('should propagate operation errors', async () => {
      const error = new Error('Operation failed');

      await expect(
        queue.enqueue(async () => {
          throw error;
        })
      ).rejects.toThrow('Operation failed');
    });

    it('should continue processing after error', async () => {
      const results: string[] = [];

      // First operation fails
      const op1 = queue.enqueue(async () => {
        throw new Error('First operation fails');
      }).catch(() => {
        results.push('op1-errored');
      });

      // Wait for op1 to complete and fail
      await op1;

      // Second operation should still execute
      const op2 = queue.enqueue(async () => {
        results.push('op2-success');
        return 'success';
      });

      await op2;

      expect(results).toEqual(['op1-errored', 'op2-success']);
    });

    it('should handle operations that return undefined', async () => {
      const result = await queue.enqueue(async () => {
        // Operation with no return value
        await new Promise((resolve) => setTimeout(resolve, 5));
      });

      expect(result).toBeUndefined();
    });
  });

  describe('queue state tracking', () => {
    it('should track processing state', async () => {
      expect(queue.isOperationInProgress()).toBe(false);

      const operation = queue.enqueue(async () => {
        // Check that processing is true during operation
        expect(queue.isOperationInProgress()).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Processing should be true immediately after enqueue
      expect(queue.isOperationInProgress()).toBe(true);

      await operation;

      // Processing should be false after completion
      expect(queue.isOperationInProgress()).toBe(false);
    });

    it('should track current operation ID', async () => {
      let currentIdDuringOp: string | null = null;

      await queue.enqueue(async () => {
        currentIdDuringOp = queue.getCurrentOperationId();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });

      expect(currentIdDuringOp).not.toBeNull();
      expect(currentIdDuringOp).toMatch(/^op-\d+-[a-z0-9]+$/);

      // Should be null after completion
      expect(queue.getCurrentOperationId()).toBeNull();
    });

    it('should track queue length', async () => {
      // Queue should be empty initially
      expect(queue.getQueueLength()).toBe(0);

      // Enqueue operations (they start processing immediately)
      queue.enqueue(async () => new Promise((resolve) => setTimeout(resolve, 20)));
      queue.enqueue(async () => new Promise((resolve) => setTimeout(resolve, 20)));
      queue.enqueue(async () => new Promise((resolve) => setTimeout(resolve, 20)));

      // First operation is processing, so queue length is 2
      expect(queue.getQueueLength()).toBeLessThanOrEqual(2);

      // Wait for all to complete
      await queue.drain();

      // Queue should be empty
      expect(queue.getQueueLength()).toBe(0);
    });
  });

  describe('clearQueue', () => {
    it('should clear pending operations', async () => {
      const results: string[] = [];

      // Enqueue first operation
      const op1Promise = queue.enqueue(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        results.push('op1');
        return 'op1';
      });

      // Enqueue more operations (will be cleared)
      const op2Promise = queue.enqueue(async () => {
        results.push('op2');
        return 'op2';
      }).catch(() => {
        results.push('op2-cancelled');
      });

      const op3Promise = queue.enqueue(async () => {
        results.push('op3');
        return 'op3';
      }).catch(() => {
        results.push('op3-cancelled');
      });

      // Wait a bit for first operation to start
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Clear the queue (should cancel op2 and op3)
      const clearedIds = queue.clearQueue();

      expect(clearedIds.length).toBeGreaterThan(0);

      // Wait for cleared operations to reject
      await Promise.allSettled([op2Promise, op3Promise]);

      // Wait for first operation to complete
      await op1Promise;

      // Only first operation should complete successfully
      expect(results).toContain('op1');
      expect(results).toContain('op2-cancelled');
      expect(results).toContain('op3-cancelled');
    });

    it('should reject cleared operations', async () => {
      let opError: Error | null = null;

      const op1 = queue.enqueue(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }).catch(() => {
        // This should not be cancelled
      });

      const op2 = queue.enqueue(async () => {
        return 'should not execute';
      }).catch((error: any) => {
        opError = error;
      });

      // Clear immediately and wait for op2 to reject
      await new Promise((resolve) => setTimeout(resolve, 5));
      queue.clearQueue();

      // Wait for op2 to be rejected
      await op2;

      expect(opError).not.toBeNull();
      if (opError) {
        expect((opError as Error).message).toBe('Operation cancelled - queue cleared');
      }
    });
  });

  describe('statistics', () => {
    it('should track operation statistics', async () => {
      // Successful operation
      await queue.enqueue(async () => 'success');

      // Failed operation
      await queue.enqueue(async () => {
        throw new Error('Failed');
      }).catch(() => {
        // Expected to fail
      });

      // Another successful operation
      await queue.enqueue(async () => 'success2');

      const stats = queue.getStats();

      expect(stats.totalOperations).toBe(3);
      expect(stats.completedOperations).toBe(2);
      expect(stats.failedOperations).toBe(1);
    });

    it('should reset statistics', async () => {
      await queue.enqueue(async () => 'result');

      let stats = queue.getStats();
      expect(stats.totalOperations).toBe(1);

      queue.resetStats();

      stats = queue.getStats();
      expect(stats.totalOperations).toBe(0);
      expect(stats.completedOperations).toBe(0);
      expect(stats.failedOperations).toBe(0);
    });

    it('should include current state in stats', async () => {
      const operation = queue.enqueue(async () => {
        const stats = queue.getStats();
        expect(stats.isProcessing).toBe(true);
        expect(stats.currentQueueLength).toBe(0);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const stats = queue.getStats();
      expect(stats.isProcessing).toBe(true);

      await operation;

      const finalStats = queue.getStats();
      expect(finalStats.isProcessing).toBe(false);
    });
  });

  describe('drain', () => {
    it('should wait for all operations to complete', async () => {
      const results: number[] = [];

      queue.enqueue(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(1);
      });

      queue.enqueue(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(2);
      });

      // Drain should wait for both operations
      await queue.drain();

      expect(results).toEqual([1, 2]);
      expect(queue.isOperationInProgress()).toBe(false);
      expect(queue.getQueueLength()).toBe(0);
    });

    it('should return immediately when queue is empty', async () => {
      const start = Date.now();
      await queue.drain();
      const elapsed = Date.now() - start;

      // Should return very quickly (< 50ms)
      expect(elapsed).toBeLessThan(50);
    });

    it('should handle new operations added during drain', async () => {
      const results: number[] = [];

      queue.enqueue(async () => {
        results.push(1);
      });

      // Add more operations after a delay
      setTimeout(() => {
        queue.enqueue(async () => {
          results.push(2);
        });
      }, 5);

      await queue.drain();

      expect(results).toEqual([1, 2]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty queue operations', async () => {
      expect(queue.getQueueLength()).toBe(0);
      expect(queue.isOperationInProgress()).toBe(false);
      expect(queue.getCurrentOperationId()).toBeNull();
    });

    it('should handle rapid enqueue operations', async () => {
      const promises: Promise<number>[] = [];

      // Enqueue 100 operations rapidly
      for (let i = 0; i < 100; i++) {
        promises.push(
          queue.enqueue(async () => {
            return i;
          })
        );
      }

      const results = await Promise.all(promises);

      // All operations should complete in order
      expect(results).toEqual(Array.from({ length: 100 }, (_, i) => i));
    });

    it('should handle operation that returns null', async () => {
      const result = await queue.enqueue(async () => {
        return null;
      });

      expect(result).toBeNull();
    });

    it('should handle operation with different return types', async () => {
      const strResult = await queue.enqueue(async () => 'string');
      const numResult = await queue.enqueue(async () => 42);
      const objResult = await queue.enqueue(async () => ({ key: 'value' }));
      const arrResult = await queue.enqueue(async () => [1, 2, 3]);

      expect(strResult).toBe('string');
      expect(numResult).toBe(42);
      expect(objResult).toEqual({ key: 'value' });
      expect(arrResult).toEqual([1, 2, 3]);
    });
  });
});

describe('Global Task Operation Queue', () => {
  afterEach(() => {
    resetGlobalTaskOperationQueue();
  });

  describe('getTaskOperationQueue', () => {
    it('should return singleton instance', () => {
      const queue1 = getTaskOperationQueue();
      const queue2 = getTaskOperationQueue();

      expect(queue1).toBe(queue2);
    });

    it('should create new instance after reset', () => {
      const queue1 = getTaskOperationQueue();
      resetGlobalTaskOperationQueue();
      const queue2 = getTaskOperationQueue();

      expect(queue1).not.toBe(queue2);
    });

    it('should maintain state across calls', async () => {
      const queue1 = getTaskOperationQueue();

      await queue1.enqueue(async () => 'result1');

      const stats1 = queue1.getStats();
      expect(stats1.totalOperations).toBe(1);

      // Get the same instance again
      const queue2 = getTaskOperationQueue();

      const stats2 = queue2.getStats();
      expect(stats2.totalOperations).toBe(1);
    });
  });

  describe('resetGlobalTaskOperationQueue', () => {
    it('should clear existing queue', async () => {
      const queue = getTaskOperationQueue();

      await queue.enqueue(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      queue.enqueue(async () => {}).catch(() => {
        // Expected to be cancelled
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      resetGlobalTaskOperationQueue();

      // New instance should be clean
      const newQueue = getTaskOperationQueue();
      expect(newQueue.getQueueLength()).toBe(0);
      expect(newQueue.isOperationInProgress()).toBe(false);
    });
  });
});
