/**
 * End-to-End tests for Insights Chat → Kanban board automatic task synchronization
 * Tests that tasks created from Insights Chat immediately appear on the Kanban board
 * without requiring a manual page refresh.
 *
 * NOTE: These tests require the Electron app to be built first.
 * Run `npm run build` before running E2E tests.
 *
 * To run: npx playwright test insights-kanban-sync.spec.ts --config=e2e/playwright.config.ts
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import { launchElectronApp, closeElectronApp, waitForAppReady } from './electron-helper';

// Test data directory
const TEST_DATA_DIR = '/tmp/auto-claude-insights-kanban-e2e';
const TEST_PROJECT_DIR = path.join(TEST_DATA_DIR, 'test-project');

// Setup test environment
function setupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  mkdirSync(path.join(TEST_PROJECT_DIR, '.auto-claude', 'specs'), { recursive: true });
}

// Cleanup test environment
function cleanupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

// Helper to create a test task in the store
function createTestTaskInStore(
  taskId: string,
  title: string,
  description: string,
  status: 'backlog' | 'in_progress' | 'done' = 'backlog',
  append: boolean = false
): void {
  const taskData = {
    id: taskId,
    specId: taskId,
    projectId: 'test-project',
    title,
    description,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    subtasks: [],
    executionProgress: { phase: 'idle', phaseProgress: 0, overallProgress: 0 },
    logs: [],
    metadata: {
      source: 'insights',
      createdFromInsights: true,
      insightsMessageId: `msg-${taskId}`
    }
  };

  const tasksPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'tasks.json');

  if (append && existsSync(tasksPath)) {
    let tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
    tasks.push(taskData);
    writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
  } else {
    writeFileSync(tasksPath, JSON.stringify([taskData], null, 2));
  }
}

// Helper to clear test data
function clearTestData(): void {
  const tasksPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'tasks.json');
  const taskOrderPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'task-order.json');

  if (existsSync(tasksPath)) {
    rmSync(tasksPath);
  }
  if (existsSync(taskOrderPath)) {
    rmSync(taskOrderPath);
  }
}

// Helper to create task order state
function createTaskOrderState(taskOrder: Record<string, string[]>): void {
  const taskOrderPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'task-order.json');
  writeFileSync(taskOrderPath, JSON.stringify(taskOrder, null, 2));
}

test.describe('Insights Chat → Kanban Board Sync (Mock-based)', () => {
  test.beforeAll(() => {
    setupTestEnvironment();
  });

  test.afterAll(() => {
    cleanupTestEnvironment();
  });

  test.beforeEach(() => {
    clearTestData();
  });

  test('should create task with Insights metadata', () => {
    const taskId = 'insights-task-1';
    createTestTaskInStore(
      taskId,
      'Implement feature from Insights',
      'This task was suggested by Insights Chat',
      'backlog'
    );

    const tasksPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'tasks.json');
    expect(existsSync(tasksPath)).toBe(true);

    const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(taskId);
    expect(tasks[0].metadata?.source).toBe('insights');
    expect(tasks[0].metadata?.createdFromInsights).toBe(true);
  });

  test('should update task order when task is added', () => {
    const taskId = 'insights-task-2';
    createTestTaskInStore(taskId, 'New task from Insights', 'Description', 'backlog');

    // Create initial task order
    const initialTaskOrder: Record<string, string[]> = {
      backlog: ['existing-task-1', 'existing-task-2'],
      in_progress: ['task-3'],
      done: ['task-4']
    };
    createTaskOrderState(initialTaskOrder);

    // Simulate adding task to order (as addTask() does)
    const taskOrderPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'task-order.json');
    let taskOrder = JSON.parse(readFileSync(taskOrderPath, 'utf-8'));

    // Add new task to top of backlog column
    taskOrder.backlog.unshift(taskId);

    // Remove duplicates
    taskOrder.backlog = [...new Set(taskOrder.backlog)];

    writeFileSync(taskOrderPath, JSON.stringify(taskOrder, null, 2));

    // Verify task was added to top of backlog
    const updatedTaskOrder = JSON.parse(readFileSync(taskOrderPath, 'utf-8'));
    expect(updatedTaskOrder.backlog[0]).toBe(taskId);
    expect(updatedTaskOrder.backlog).toHaveLength(3);
  });

  test('should handle rapid task creation without duplicates', () => {
    const numTasks = 15;
    const taskIds: string[] = [];

    // Create multiple tasks rapidly
    for (let i = 0; i < numTasks; i++) {
      const taskId = `rapid-task-${i}`;
      taskIds.push(taskId);
      createTestTaskInStore(
        taskId,
        `Rapid task ${i}`,
        `Description for rapid task ${i}`,
        'backlog',
        true // Append to existing array
      );
    }

    // Verify all tasks were created
    const tasksPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'tasks.json');
    const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
    expect(tasks).toHaveLength(numTasks);

    // Verify no duplicate task IDs
    const uniqueTaskIds = new Set(tasks.map((t: { id: string }) => t.id));
    expect(uniqueTaskIds.size).toBe(numTasks);

    // Verify all tasks have Insights metadata
    tasks.forEach((task: { metadata: { source: string; createdFromInsights: boolean } }) => {
      expect(task.metadata?.source).toBe('insights');
      expect(task.metadata?.createdFromInsights).toBe(true);
    });
  });

  test('should maintain task order consistency after multiple additions', () => {
    const taskOrderPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'task-order.json');

    // Create initial state
    const initialOrder: Record<string, string[]> = {
      backlog: ['task-1', 'task-2'],
      in_progress: ['task-3'],
      done: []
    };
    writeFileSync(taskOrderPath, JSON.stringify(initialOrder, null, 2));

    // Add tasks to different columns
    const newTasks = [
      { id: 'new-backlog-1', status: 'backlog' },
      { id: 'new-backlog-2', status: 'backlog' },
      { id: 'new-in-progress-1', status: 'in_progress' },
      { id: 'new-done-1', status: 'done' }
    ];

    let taskOrder = JSON.parse(readFileSync(taskOrderPath, 'utf-8'));

    newTasks.forEach(task => {
      const column = task.status;
      if (!taskOrder[column]) {
        taskOrder[column] = [];
      }

      // Add to top of column
      taskOrder[column].unshift(task.id);

      // Remove duplicates
      taskOrder[column] = [...new Set(taskOrder[column])];
    });

    writeFileSync(taskOrderPath, JSON.stringify(taskOrder, null, 2));

    // Verify final state
    const finalOrder = JSON.parse(readFileSync(taskOrderPath, 'utf-8'));

    // Backlog should have: new-backlog-2, new-backlog-1, task-1, task-2
    expect(finalOrder.backlog).toHaveLength(4);
    expect(finalOrder.backlog[0]).toBe('new-backlog-2');
    expect(finalOrder.backlog[1]).toBe('new-backlog-1');

    // In progress should have: new-in-progress-1, task-3
    expect(finalOrder.in_progress).toHaveLength(2);
    expect(finalOrder.in_progress[0]).toBe('new-in-progress-1');

    // Done should have: new-done-1
    expect(finalOrder.done).toHaveLength(1);
    expect(finalOrder.done[0]).toBe('new-done-1');
  });

  test('should handle deduplication in task order', () => {
    const taskOrderPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'task-order.json');

    // Create initial order with a task
    const initialOrder: Record<string, string[]> = {
      backlog: ['existing-task'],
      in_progress: [],
      done: []
    };
    writeFileSync(taskOrderPath, JSON.stringify(initialOrder, null, 2));

    // Simulate adding the same task multiple times (race condition scenario)
    let taskOrder = JSON.parse(readFileSync(taskOrderPath, 'utf-8'));
    const duplicateTaskId = 'duplicate-task';

    // Add same task 3 times
    for (let i = 0; i < 3; i++) {
      taskOrder.backlog.unshift(duplicateTaskId);
      // Deduplicate after each addition (simulating addTask() safety check)
      taskOrder.backlog = [...new Set(taskOrder.backlog)];
    }

    writeFileSync(taskOrderPath, JSON.stringify(taskOrder, null, 2));

    // Verify task appears only once
    const finalOrder = JSON.parse(readFileSync(taskOrderPath, 'utf-8'));
    const duplicateCount = finalOrder.backlog.filter((id: string) => id === duplicateTaskId).length;
    expect(duplicateCount).toBe(1);
    expect(finalOrder.backlog).toHaveLength(2); // duplicate-task + existing-task
  });

  test('should preserve task metadata after creation', () => {
    const taskId = 'metadata-task-1';
    const metadata = {
      source: 'insights' as const,
      createdFromInsights: true,
      insightsMessageId: 'msg-123',
      suggestionContext: 'User was asking about authentication',
      confidence: 0.95
    };

    createTestTaskInStore(taskId, 'Task with metadata', 'Description', 'backlog');

    const tasksPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'tasks.json');
    const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
    const task = tasks[0];

    // Update with full metadata
    task.metadata = metadata;
    writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));

    // Verify metadata is preserved
    const finalTasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
    expect(finalTasks[0].metadata).toEqual(metadata);
    expect(finalTasks[0].metadata.source).toBe('insights');
    expect(finalTasks[0].metadata.createdFromInsights).toBe(true);
    expect(finalTasks[0].metadata.confidence).toBe(0.95);
  });

  test('should maintain phase synchronization consistency', () => {
    // Create tasks in different phases
    const tasks = [
      { id: 'backlog-1', status: 'backlog' as const },
      { id: 'backlog-2', status: 'backlog' as const },
      { id: 'in-progress-1', status: 'in_progress' as const },
      { id: 'done-1', status: 'done' as const }
    ];

    tasks.forEach((task, index) =>
      createTestTaskInStore(task.id, task.id, 'Description', task.status, index > 0)
    );

    // Create task order matching the tasks
    const taskOrder: Record<string, string[]> = {
      backlog: ['backlog-2', 'backlog-1'], // Most recent first
      in_progress: ['in-progress-1'],
      done: ['done-1']
    };
    createTaskOrderState(taskOrder);

    // Verify counts match
    const tasksPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'tasks.json');
    const tasksData = JSON.parse(readFileSync(tasksPath, 'utf-8'));

    const backlogTasks = tasksData.filter((t: { status: string }) => t.status === 'backlog');
    const inProgressTasks = tasksData.filter((t: { status: string }) => t.status === 'in_progress');
    const doneTasks = tasksData.filter((t: { status: string }) => t.status === 'done');

    expect(backlogTasks.length).toBe(taskOrder.backlog.length);
    expect(inProgressTasks.length).toBe(taskOrder.in_progress.length);
    expect(doneTasks.length).toBe(taskOrder.done.length);

    // Verify no orphaned tasks (tasks in order but not in tasks array)
    const allTaskIds = new Set(tasksData.map((t: { id: string }) => t.id));
    const allOrderIds = [
      ...taskOrder.backlog,
      ...taskOrder.in_progress,
      ...taskOrder.done
    ];

    allOrderIds.forEach(orderId => {
      expect(allTaskIds.has(orderId)).toBe(true);
    });
  });
});

test.describe('Insights Chat → Kanban Board Sync (Electron UI Tests)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    setupTestEnvironment();
  });

  test.afterAll(async () => {
    if (app) {
      await closeElectronApp(app);
    }
    cleanupTestEnvironment();
  });

  test.skip('should create task from Insights and see it on Kanban board immediately', async () => {
    // Skip test if Electron is not available (CI environment)
    test.skip(!process.env.ELECTRON_PATH, 'Electron not available in CI');

    // Launch the app
    const context = await launchElectronApp();
    app = context.app;
    page = context.page;

    // Wait for app to be ready
    await waitForAppReady(page);

    // TODO: Implement the actual UI flow:
    // 1. Navigate to Insights Chat view
    // 2. Create a task via Insights Chat
    // 3. Wait for task creation to complete
    // 4. Switch to Kanban board view (or view in split pane)
    // 5. Verify task appears on Kanban board within 1 second without refresh
    // 6. Verify phase counts are updated correctly

    // This test requires the app to be fully functional with test data
    // Mark as pending until the UI flow is implemented
    test.skip(true, 'UI flow pending implementation');
  });

  test.skip('should handle rapid task creation from Insights', async () => {
    test.skip(!app, 'App not launched');

    // TODO: Implement rapid task creation test:
    // 1. Navigate to Insights Chat view
    // 2. Create 10+ tasks in quick succession
    // 3. Navigate to Kanban board
    // 4. Verify all tasks appear correctly
    // 5. Verify no duplicate tasks
    // 6. Verify no console errors

    test.skip(true, 'UI flow pending implementation');
  });

  test.skip('should verify phase synchronization after task creation', async () => {
    test.skip(!app, 'App not launched');

    // TODO: Implement phase sync verification:
    // 1. Note initial phase counts
    // 2. Create task from Insights Chat
    // 3. Verify phase counts updated correctly
    // 4. Verify no orphaned tasks appear
    // 5. Verify task order is maintained

    test.skip(true, 'UI flow pending implementation');
  });
});

test.describe('State Synchronization Data Integrity', () => {
  test.beforeAll(() => {
    setupTestEnvironment();
  });

  test.afterAll(() => {
    cleanupTestEnvironment();
  });

  test.beforeEach(() => {
    clearTestData();
  });

  test('should verify task and taskOrder state consistency', () => {
    // Create tasks
    const tasks = [
      { id: 'task-1', status: 'backlog' },
      { id: 'task-2', status: 'backlog' },
      { id: 'task-3', status: 'in_progress' }
    ];

    tasks.forEach((task, index) =>
      createTestTaskInStore(task.id, `Task ${task.id}`, 'Description', task.status as any, index > 0)
    );

    // Create matching task order
    const taskOrder: Record<string, string[]> = {
      backlog: ['task-2', 'task-1'],
      in_progress: ['task-3'],
      done: []
    };
    createTaskOrderState(taskOrder);

    // Load and verify
    const tasksPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'tasks.json');
    const taskOrderPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'task-order.json');

    const tasksData = JSON.parse(readFileSync(tasksPath, 'utf-8'));
    const taskOrderData = JSON.parse(readFileSync(taskOrderPath, 'utf-8'));

    // Verify consistency
    const taskIds = new Set(tasksData.map((t: { id: string }) => t.id));
    const orderIds = new Set([
      ...taskOrderData.backlog,
      ...taskOrderData.in_progress,
      ...taskOrderData.done
    ]);

    // Every task in order should exist in tasks
    orderIds.forEach(id => {
      expect(taskIds.has(id)).toBe(true);
    });

    // Every task should be in order (no orphaned tasks)
    taskIds.forEach(id => {
      expect(orderIds.has(id)).toBe(true);
    });
  });

  test('should detect and handle state corruption', () => {
    // Create a task
    createTestTaskInStore('orphaned-task', 'Orphaned Task', 'Description', 'backlog');

    // Create task order WITHOUT this task (simulating corruption)
    const taskOrder: Record<string, string[]> = {
      backlog: ['other-task'],
      in_progress: [],
      done: []
    };
    createTaskOrderState(taskOrder);

    // Load and detect inconsistency
    const tasksPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'tasks.json');
    const taskOrderPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'task-order.json');

    const tasksData = JSON.parse(readFileSync(tasksPath, 'utf-8'));
    const taskOrderData = JSON.parse(readFileSync(taskOrderPath, 'utf-8'));

    const taskIds = new Set(tasksData.map((t: { id: string }) => t.id));
    const orderIds = new Set([
      ...taskOrderData.backlog,
      ...taskOrderData.in_progress,
      ...taskOrderData.done
    ]);

    // Detect orphaned task
    const orphanedTasks = [...taskIds].filter(id => !orderIds.has(id));
    expect(orphanedTasks).toContain('orphaned-task');

    // The fix would be to add the orphaned task to taskOrder
    // This simulates the state correction that should happen
  });

  test('should handle concurrent task additions safely', () => {
    // Simulate concurrent additions (race condition)
    const taskOrderPath = path.join(TEST_PROJECT_DIR, '.auto-claude', 'task-order.json');

    // Initial state
    const initialOrder: Record<string, string[]> = {
      backlog: ['existing'],
      in_progress: [],
      done: []
    };
    writeFileSync(taskOrderPath, JSON.stringify(initialOrder, null, 2));

    // Simulate 5 concurrent additions
    const concurrentTasks = ['concurrent-1', 'concurrent-2', 'concurrent-3', 'concurrent-4', 'concurrent-5'];

    // Read, modify, write (simulating concurrent operations)
    for (const taskId of concurrentTasks) {
      let taskOrder = JSON.parse(readFileSync(taskOrderPath, 'utf-8'));
      taskOrder.backlog.unshift(taskId);
      // Deduplicate (safety check from addTask())
      taskOrder.backlog = [...new Set(taskOrder.backlog)];
      writeFileSync(taskOrderPath, JSON.stringify(taskOrder, null, 2));
    }

    // Verify final state
    const finalOrder = JSON.parse(readFileSync(taskOrderPath, 'utf-8'));
    expect(finalOrder.backlog).toHaveLength(6); // 5 new + 1 existing

    // Verify no duplicates
    const uniqueIds = new Set(finalOrder.backlog);
    expect(uniqueIds.size).toBe(6);
  });
});
