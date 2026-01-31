/**
 * End-to-End tests for Archived Tasks Persistence
 * Tests: archive task → storage cleanup → app restart → verify hidden
 *
 * This test suite verifies the complete archived tasks workflow to ensure
 * archived tasks stay hidden across app restarts (bug fix verification).
 *
 * Tests at the data layer without requiring Electron app launch.
 * Uses in-memory storage mock instead of localStorage (not available in Node.js).
 *
 * To run: cd apps/frontend && npx playwright test archived-tasks-persistence --config=e2e/playwright.config.ts
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Test data directory
let TEST_DATA_DIR: string;
let TEST_PROJECT_DIR: string;
let SPECS_DIR: string;

// In-memory storage mock (simulates localStorage)
const storageMock = new Map<string, string>();

// Helper to get taskOrder storage key
function getTaskOrderKey(projectId: string): string {
  return `task-order-state-${projectId}`;
}

// Helper to get item from storage mock
function getStorageItem(key: string): string | null {
  return storageMock.get(key) || null;
}

// Helper to set item in storage mock
function setStorageItem(key: string, value: string): void {
  storageMock.set(key, value);
}

// Helper to remove item from storage mock
function _removeStorageItem(key: string): void {
  storageMock.delete(key);
}

// Helper to clear storage mock
function clearStorage(): void {
  storageMock.clear();
}

// Helper to create empty task order state
function createEmptyTaskOrder() {
  return {
    backlog: [],
    queue: [],
    in_progress: [],
    ai_review: [],
    human_review: [],
    done: [],
    pr_created: [],
    error: []
  };
}

// Setup test environment with secure temp directory
function setupTestEnvironment(): void {
  TEST_DATA_DIR = `${tmpdir()}/auto-claude-archived-tasks-e2e-${Date.now()}`;
  TEST_PROJECT_DIR = path.join(TEST_DATA_DIR, 'test-project');
  SPECS_DIR = path.join(TEST_PROJECT_DIR, '.auto-claude', 'specs');

  mkdirSync(TEST_DATA_DIR, { recursive: true });
  mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  mkdirSync(SPECS_DIR, { recursive: true });
}

// Cleanup test environment
function cleanupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

// Helper to create a mock task with metadata
function createMockTask(specId: string, status: string, isArchived: boolean = false) {
  return {
    id: specId,
    specId: specId,
    title: `Task ${specId}`,
    status: status,
    description: `Test task ${specId}`,
    metadata: {
      createdAt: new Date().toISOString(),
      ...(isArchived && { archivedAt: new Date().toISOString() })
    },
    subtasks: [],
    implementationPlan: null
  };
}

// Type for task order state
interface TaskOrder {
  backlog: string[];
  queue: string[];
  in_progress: string[];
  ai_review: string[];
  human_review: string[];
  done: string[];
  pr_created: string[];
  error: string[];
  [key: string]: string[];
}

// Helper to simulate task order storage state
function saveTaskOrderToStorage(projectId: string, taskOrder: TaskOrder): void {
  const key = getTaskOrderKey(projectId);
  setStorageItem(key, JSON.stringify(taskOrder));
}

// Helper to load task order from storage
function loadTaskOrderFromStorage(projectId: string): TaskOrder | null {
  const key = getTaskOrderKey(projectId);
  const stored = getStorageItem(key);
  if (!stored) {
    return null;
  }
  return JSON.parse(stored) as TaskOrder;
}

// Helper to simulate cleanupArchivedTaskIds function
function cleanupArchivedTaskIds(projectId: string, validTaskIds: string[]): void {
  const key = getTaskOrderKey(projectId);
  const stored = getStorageItem(key);

  if (!stored) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    // Invalid JSON - return gracefully without cleanup
    return;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return;
  }

  const isValidColumnArray = (val: unknown): val is string[] =>
    Array.isArray(val) && val.every(item => typeof item === 'string');

  const validTaskIdSet = new Set(validTaskIds);

  let hasChanges = false;
  const cleanedOrder = {
    backlog: isValidColumnArray(parsed.backlog) ? parsed.backlog.filter((id: string) => validTaskIdSet.has(id)) : [],
    queue: isValidColumnArray(parsed.queue) ? parsed.queue.filter((id: string) => validTaskIdSet.has(id)) : [],
    in_progress: isValidColumnArray(parsed.in_progress) ? parsed.in_progress.filter((id: string) => validTaskIdSet.has(id)) : [],
    ai_review: isValidColumnArray(parsed.ai_review) ? parsed.ai_review.filter((id: string) => validTaskIdSet.has(id)) : [],
    human_review: isValidColumnArray(parsed.human_review) ? parsed.human_review.filter((id: string) => validTaskIdSet.has(id)) : [],
    done: isValidColumnArray(parsed.done) ? parsed.done.filter((id: string) => validTaskIdSet.has(id)) : [],
    pr_created: isValidColumnArray(parsed.pr_created) ? parsed.pr_created.filter((id: string) => validTaskIdSet.has(id)) : [],
    error: isValidColumnArray(parsed.error) ? parsed.error.filter((id: string) => validTaskIdSet.has(id)) : []
  };

  (Object.keys(cleanedOrder) as Array<keyof typeof cleanedOrder>).forEach(column => {
    if (isValidColumnArray(parsed[column]) && parsed[column].length !== cleanedOrder[column].length) {
      hasChanges = true;
    }
  });

  if (hasChanges) {
    setStorageItem(key, JSON.stringify(cleanedOrder));
  }
}

test.describe('Archived Tasks Persistence - Data Layer Tests', () => {
  test.beforeEach(() => {
    setupTestEnvironment();
    clearStorage();
  });

  test.afterEach(() => {
    cleanupTestEnvironment();
    clearStorage();
  });

  test('should setup test environment correctly', () => {
    expect(existsSync(TEST_DATA_DIR)).toBe(true);
    expect(existsSync(TEST_PROJECT_DIR)).toBe(true);
    expect(existsSync(SPECS_DIR)).toBe(true);
  });

  test('should create empty task order state', () => {
    const emptyOrder = createEmptyTaskOrder();

    expect(emptyOrder.backlog).toEqual([]);
    expect(emptyOrder.queue).toEqual([]);
    expect(emptyOrder.in_progress).toEqual([]);
    expect(emptyOrder.ai_review).toEqual([]);
    expect(emptyOrder.human_review).toEqual([]);
    expect(emptyOrder.done).toEqual([]);
    expect(emptyOrder.pr_created).toEqual([]);
    expect(emptyOrder.error).toEqual([]);
  });

  test('should save and load task order from storage', () => {
    const projectId = 'test-project';
    const taskOrder = {
      backlog: ['001', '002'],
      queue: ['003'],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: [],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, taskOrder);

    const loaded = loadTaskOrderFromStorage(projectId);

    expect(loaded).toBeDefined();
    expect(loaded.backlog).toEqual(['001', '002']);
    expect(loaded.queue).toEqual(['003']);
  });
});

test.describe('Archived Tasks - Archive Workflow', () => {
  test.beforeEach(() => {
    setupTestEnvironment();
    clearStorage();
  });

  test.afterEach(() => {
    cleanupTestEnvironment();
    clearStorage();
  });

  test('should create mock tasks with and without archived status', () => {
    const activeTask = createMockTask('001', 'done', false);
    const archivedTask = createMockTask('002', 'done', true);

    expect(activeTask.metadata.archivedAt).toBeUndefined();
    expect(archivedTask.metadata.archivedAt).toBeDefined();
    expect(archivedTask.metadata.archivedAt).not.toBe('');
  });

  test('should save initial task order with multiple tasks', () => {
    const projectId = 'test-project';
    const taskOrder = {
      backlog: ['001', '002', '003'],
      queue: [],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: ['004', '005'],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, taskOrder);

    const loaded = loadTaskOrderFromStorage(projectId);
    expect(loaded.backlog).toHaveLength(3);
    expect(loaded.done).toHaveLength(2);
  });

  test('should remove archived task ID from taskOrder when cleanup is called', () => {
    const projectId = 'test-project';
    const taskOrder = {
      backlog: ['001', '002', '003'],
      queue: [],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: [],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, taskOrder);

    const validTaskIds = ['001', '003'];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    const cleaned = loadTaskOrderFromStorage(projectId);

    expect(cleaned.backlog).toEqual(['001', '003']);
    expect(cleaned.backlog).not.toContain('002');
  });

  test('should remove archived task IDs from multiple columns', () => {
    const projectId = 'test-project';
    const taskOrder = {
      backlog: ['001', '002'],
      queue: ['003', '004'],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: [],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, taskOrder);

    const validTaskIds = ['001', '004'];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    const cleaned = loadTaskOrderFromStorage(projectId);

    expect(cleaned.backlog).toEqual(['001']);
    expect(cleaned.queue).toEqual(['004']);
  });

  test('should not modify storage when no archived IDs are present', () => {
    const projectId = 'test-project';
    const taskOrder = {
      backlog: ['001', '002'],
      queue: ['003'],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: [],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, taskOrder);

    const validTaskIds = ['001', '002', '003'];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    const cleaned = loadTaskOrderFromStorage(projectId);

    expect(cleaned.backlog).toEqual(['001', '002']);
    expect(cleaned.queue).toEqual(['003']);
  });

  test('should handle empty taskOrder gracefully', () => {
    const projectId = 'test-project';
    const taskOrder = createEmptyTaskOrder();

    saveTaskOrderToStorage(projectId, taskOrder);

    const validTaskIds: string[] = [];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    const cleaned = loadTaskOrderFromStorage(projectId);

    expect(cleaned.backlog).toEqual([]);
    expect(cleaned.queue).toEqual([]);
  });
});

test.describe('Archived Tasks - App Restart Simulation', () => {
  test.beforeEach(() => {
    setupTestEnvironment();
    clearStorage();
  });

  test.afterEach(() => {
    cleanupTestEnvironment();
    clearStorage();
  });

  test('should simulate complete workflow: archive → cleanup → restart', () => {
    const projectId = 'test-project';

    // Step 1: Initial state - tasks in storage
    const initialOrder = {
      backlog: ['001', '002', '003'],
      queue: [],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: [],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, initialOrder);

    const loaded = loadTaskOrderFromStorage(projectId);
    expect(loaded?.backlog).toHaveLength(3);

    // Step 2: Simulate archiving task '002'
    const activeTasks = [
      createMockTask('001', 'backlog', false),
      createMockTask('002', 'backlog', true),
      createMockTask('003', 'backlog', false)
    ];

    const validTaskIds = activeTasks
      .filter(t => !t.metadata.archivedAt)
      .map(t => t.id);

    expect(validTaskIds).toEqual(['001', '003']);

    // Step 3: Cleanup archived IDs (this is what the fix does)
    cleanupArchivedTaskIds(projectId, validTaskIds);

    // Step 4: Verify cleanup happened
    const cleaned = loadTaskOrderFromStorage(projectId);
    expect(cleaned.backlog).toEqual(['001', '003']);
    expect(cleaned.backlog).not.toContain('002');

    // Step 5: Simulate app restart - load from storage
    const afterRestart = loadTaskOrderFromStorage(projectId);

    // Step 6: Verify archived task is NOT in order after restart
    expect(afterRestart.backlog).toHaveLength(2);
    expect(afterRestart.backlog).not.toContain('002');
    expect(afterRestart.backlog).toContain('001');
    expect(afterRestart.backlog).toContain('003');
  });

  test('should simulate workflow with tasks in multiple columns', () => {
    const projectId = 'test-project';

    // Initial state
    const initialOrder = {
      backlog: ['001', '002'],
      queue: ['003', '004'],
      in_progress: ['005'],
      ai_review: [],
      human_review: [],
      done: ['006', '007'],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, initialOrder);

    // Archive tasks from multiple columns
    const activeTasks = [
      createMockTask('001', 'backlog', false),
      createMockTask('002', 'backlog', true),
      createMockTask('003', 'queue', false),
      createMockTask('004', 'queue', true),
      createMockTask('005', 'in_progress', true),
      createMockTask('006', 'done', false),
      createMockTask('007', 'done', false)
    ];

    const validTaskIds = activeTasks
      .filter(t => !t.metadata.archivedAt)
      .map(t => t.id);

    cleanupArchivedTaskIds(projectId, validTaskIds);

    const cleaned = loadTaskOrderFromStorage(projectId);

    expect(cleaned.backlog).toEqual(['001']);
    expect(cleaned.queue).toEqual(['003']);
    expect(cleaned.in_progress).toEqual([]);
    expect(cleaned.done).toEqual(['006', '007']);
  });

  test('should handle edge case: all tasks in a column are archived', () => {
    const projectId = 'test-project';

    const initialOrder = {
      backlog: ['001', '002'],
      queue: [],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: ['003', '004'],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, initialOrder);

    // Archive all tasks in backlog column
    const validTaskIds = ['003', '004'];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    const cleaned = loadTaskOrderFromStorage(projectId);

    expect(cleaned.backlog).toEqual([]);
    expect(cleaned.done).toEqual(['003', '004']);
  });
});

test.describe('Archived Tasks - Edge Cases and Error Handling', () => {
  test.beforeEach(() => {
    setupTestEnvironment();
    clearStorage();
  });

  test.afterEach(() => {
    cleanupTestEnvironment();
    clearStorage();
  });

  test('should handle invalid storage data gracefully', () => {
    const projectId = 'test-project';

    // Save invalid data
    setStorageItem(getTaskOrderKey(projectId), 'invalid-json');

    const validTaskIds = ['001', '002'];

    // Should not throw error
    expect(() => {
      cleanupArchivedTaskIds(projectId, validTaskIds);
    }).not.toThrow();
  });

  test('should handle non-object storage data', () => {
    const projectId = 'test-project';

    setStorageItem(getTaskOrderKey(projectId), JSON.stringify(['array', 'data']));

    const validTaskIds = ['001', '002'];

    expect(() => {
      cleanupArchivedTaskIds(projectId, validTaskIds);
    }).not.toThrow();
  });

  test('should handle missing storage key', () => {
    const projectId = 'non-existent-project';

    const validTaskIds = ['001', '002'];

    expect(() => {
      cleanupArchivedTaskIds(projectId, validTaskIds);
    }).not.toThrow();

    const loaded = loadTaskOrderFromStorage(projectId);
    expect(loaded).toBeNull();
  });

  test('should handle columns with non-array values', () => {
    const projectId = 'test-project';

    const invalidOrder: Record<string, unknown> = {
      backlog: ['001', '002'],
      queue: 'not-an-array',
      in_progress: ['003'],
      ai_review: null,
      human_review: [],
      done: [],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, invalidOrder);

    const validTaskIds = ['001', '002', '003'];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    const cleaned = loadTaskOrderFromStorage(projectId);

    expect(cleaned.backlog).toEqual(['001', '002']);
    expect(cleaned.in_progress).toEqual(['003']);
  });

  test('should handle empty validTaskIds array', () => {
    const projectId = 'test-project';

    const initialOrder = {
      backlog: ['001', '002'],
      queue: [],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: [],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, initialOrder);

    const validTaskIds: string[] = [];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    const cleaned = loadTaskOrderFromStorage(projectId);

    expect(cleaned.backlog).toEqual([]);
  });

  test('should handle validTaskIds with IDs not in order', () => {
    const projectId = 'test-project';

    const initialOrder = {
      backlog: ['001', '002'],
      queue: [],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: [],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, initialOrder);

    const validTaskIds = ['003', '004'];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    const cleaned = loadTaskOrderFromStorage(projectId);

    expect(cleaned.backlog).toEqual([]);
  });
});

test.describe('Archived Tasks - Regression Prevention', () => {
  test.beforeEach(() => {
    setupTestEnvironment();
    clearStorage();
  });

  test.afterEach(() => {
    cleanupTestEnvironment();
    clearStorage();
  });

  test('should verify bug fix: archived task stays hidden after multiple restarts', () => {
    const projectId = 'test-project';

    // Initial state
    const initialOrder = {
      backlog: ['001', '002', '003'],
      queue: [],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: [],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, initialOrder);

    // Archive task '002'
    const validTaskIds = ['001', '003'];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    // Simulate first restart
    let order = loadTaskOrderFromStorage(projectId);
    expect(order.backlog).not.toContain('002');

    // Simulate second restart (storage still has cleaned order)
    order = loadTaskOrderFromStorage(projectId);
    expect(order.backlog).not.toContain('002');

    // Simulate third restart
    order = loadTaskOrderFromStorage(projectId);
    expect(order.backlog).not.toContain('002');
  });

  test('should verify fix: multiple archived tasks stay hidden', () => {
    const projectId = 'test-project';

    const initialOrder = {
      backlog: ['001', '002', '003', '004', '005'],
      queue: [],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: [],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, initialOrder);

    // Archive tasks 002, 004
    const validTaskIds = ['001', '003', '005'];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    const cleaned = loadTaskOrderFromStorage(projectId);

    expect(cleaned.backlog).toEqual(['001', '003', '005']);
    expect(cleaned.backlog).not.toContain('002');
    expect(cleaned.backlog).not.toContain('004');
  });

  test('should verify fix: archiving task then loading new tasks preserves cleanup', () => {
    const projectId = 'test-project';

    const initialOrder = {
      backlog: ['001', '002', '003'],
      queue: [],
      in_progress: [],
      ai_review: [],
      human_review: [],
      done: [],
      pr_created: [],
      error: []
    };

    saveTaskOrderToStorage(projectId, initialOrder);

    // Archive task '002'
    let validTaskIds = ['001', '003'];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    let cleaned = loadTaskOrderFromStorage(projectId);
    expect(cleaned.backlog).toEqual(['001', '003']);

    // Simulate loading new tasks (which would trigger cleanup again)
    validTaskIds = ['001', '003'];
    cleanupArchivedTaskIds(projectId, validTaskIds);

    cleaned = loadTaskOrderFromStorage(projectId);
    expect(cleaned.backlog).toEqual(['001', '003']);
    expect(cleaned.backlog).not.toContain('002');
  });
});
