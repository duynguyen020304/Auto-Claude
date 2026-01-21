/**
 * Integration tests for Insights Chat → Kanban board state synchronization
 * Tests that creating a task from Insights Chat properly updates the Kanban board state
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../shared/i18n';
import { useTaskStore } from '../../stores/task-store';
import { createTaskFromSuggestion } from '../../stores/insights-store';
import type { Task, TaskMetadata, TaskOrderState } from '../../../shared/types';

// Mock window.electronAPI
type CreateTaskFromInsightsFn = (
  projectId: string,
  title: string,
  description: string,
  metadata?: TaskMetadata
) => Promise<{ success: boolean; data?: Task; error?: string }>;

const mockCreateTaskFromInsights = vi.fn<CreateTaskFromInsightsFn>();

Object.defineProperty(window, 'electronAPI', {
  value: {
    createTaskFromInsights: mockCreateTaskFromInsights,
    getTasks: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getProjectEnv: vi.fn().mockResolvedValue({ success: true, data: null }),
    updateProjectEnv: vi.fn().mockResolvedValue({ success: true }),
    checkMcpHealth: vi.fn().mockResolvedValue({ success: true, data: null }),
    testMcpConnection: vi.fn().mockResolvedValue({ success: true, data: null }),
  }
});

// Wrapper component for i18n
function I18nWrapper({ children }: { children: React.ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/**
 * Helper to create a mock task
 */
function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-123',
    specId: 'task-123',
    projectId: 'test-project',
    title: 'Test Task',
    description: 'Test task description',
    status: 'backlog',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    subtasks: [],
    executionProgress: { phase: 'idle', phaseProgress: 0, overallProgress: 0 },
    logs: [],
    metadata: {},
    ...overrides
  };
}

describe('Insights Chat → Kanban Board State Sync Integration', () => {
  const mockProjectId = 'test-project-id';

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the task store state before each test
    act(() => {
      useTaskStore.getState().clearTasks();
    });

    // Setup default mock return value
    mockCreateTaskFromInsights.mockResolvedValue({
      success: true,
      data: createMockTask()
    });
  });

  it('should add task to store when created from Insights Chat', async () => {
    const mockTask = createMockTask({
      id: 'insights-task-1',
      title: 'Suggested from Insights',
      description: 'This task was created from Insights Chat',
      status: 'backlog'
    });

    mockCreateTaskFromInsights.mockResolvedValue({
      success: true,
      data: mockTask
    });

    // Initially, the store should have no tasks
    expect(useTaskStore.getState().tasks).toHaveLength(0);

    // Create task from Insights suggestion and add to store (simulating Insights.tsx behavior)
    await act(async () => {
      const result = await createTaskFromSuggestion(
        mockProjectId,
        mockTask.title,
        mockTask.description,
        mockTask.metadata
      );
      if (result) {
        useTaskStore.getState().addTask(result);
      }
    });

    // Wait for state to update
    await waitFor(() => {
      const store = useTaskStore.getState();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].id).toBe('insights-task-1');
      expect(store.tasks[0].title).toBe('Suggested from Insights');
    });
  });

  it('should update task order when adding task from Insights Chat', async () => {
    const mockTask = createMockTask({
      id: 'insights-task-2',
      title: 'New Task from Insights',
      status: 'backlog'
    });

    mockCreateTaskFromInsights.mockResolvedValue({
      success: true,
      data: mockTask
    });

    // Initialize task order in store
    act(() => {
      useTaskStore.getState().loadTaskOrder(mockProjectId);
    });

    // Get initial task order
    const initialOrder = useTaskStore.getState().taskOrder;
    expect(initialOrder).toBeDefined();
    expect(initialOrder?.backlog).toHaveLength(0);

    // Create task from Insights and add it to store (simulating Insights.tsx behavior)
    await act(async () => {
      const result = await createTaskFromSuggestion(
        mockProjectId,
        mockTask.title,
        mockTask.description
      );
      if (result) {
        useTaskStore.getState().addTask(result);
      }
    });

    // Verify task order was updated
    await waitFor(() => {
      const store = useTaskStore.getState();
      expect(store.taskOrder?.backlog).toHaveLength(1);
      expect(store.taskOrder?.backlog?.[0]).toBe('insights-task-2');
    });
  });

  it('should place new Insights tasks at the top of the backlog column', async () => {
    // Create initial tasks in backlog
    const existingTask1 = createMockTask({ id: 'existing-1', status: 'backlog' });
    const existingTask2 = createMockTask({ id: 'existing-2', status: 'backlog' });

    act(() => {
      useTaskStore.getState().addTask(existingTask1);
      useTaskStore.getState().addTask(existingTask2);
      // Set order: existing-2 is first (top), existing-1 is second
      useTaskStore.getState().setTaskOrder({
        backlog: ['existing-2', 'existing-1'],
        in_progress: [],
        ai_review: [],
        human_review: [],
        pr_created: [],
        done: []
      } as TaskOrderState);
    });

    const newInsightsTask = createMockTask({
      id: 'new-insights-task',
      status: 'backlog'
    });

    mockCreateTaskFromInsights.mockResolvedValue({
      success: true,
      data: newInsightsTask
    });

    // Create new task from Insights and add to store
    await act(async () => {
      const result = await createTaskFromSuggestion(
        mockProjectId,
        newInsightsTask.title,
        newInsightsTask.description
      );
      if (result) {
        useTaskStore.getState().addTask(result);
      }
    });

    // Verify new task is at the top of the backlog order
    await waitFor(() => {
      const store = useTaskStore.getState();
      expect(store.taskOrder?.backlog).toHaveLength(3);
      expect(store.taskOrder?.backlog?.[0]).toBe('new-insights-task');
      expect(store.taskOrder?.backlog?.[1]).toBe('existing-2');
      expect(store.taskOrder?.backlog?.[2]).toBe('existing-1');
    });
  });

  it('should not update store when task creation fails', async () => {
    mockCreateTaskFromInsights.mockResolvedValue({
      success: false,
      error: 'Failed to create task'
    });

    // Initially, the store should have no tasks
    expect(useTaskStore.getState().tasks).toHaveLength(0);

    // Attempt to create task from Insights
    const result = await createTaskFromSuggestion(
      mockProjectId,
      'Failed Task',
      'This task will fail to create'
    );

    // Verify task creation failed
    expect(result).toBeNull();

    // Verify store was not updated
    await waitFor(() => {
      const store = useTaskStore.getState();
      expect(store.tasks).toHaveLength(0);
    });
  });

  it('should handle rapid task creation from Insights Chat', async () => {
    // Initialize task order
    act(() => {
      useTaskStore.getState().loadTaskOrder(mockProjectId);
    });

    const tasksToCreate = [
      createMockTask({ id: 'rapid-1', title: 'Task 1', status: 'backlog' }),
      createMockTask({ id: 'rapid-2', title: 'Task 2', status: 'backlog' }),
      createMockTask({ id: 'rapid-3', title: 'Task 3', status: 'backlog' }),
      createMockTask({ id: 'rapid-4', title: 'Task 4', status: 'backlog' }),
      createMockTask({ id: 'rapid-5', title: 'Task 5', status: 'backlog' })
    ];

    // Mock each task creation
    tasksToCreate.forEach((task) => {
      mockCreateTaskFromInsights.mockResolvedValueOnce({
        success: true,
        data: task
      });
    });

    // Create all tasks rapidly and add to store
    const promises = tasksToCreate.map(async (task) => {
      const result = await createTaskFromSuggestion(mockProjectId, task.title, task.description);
      if (result) {
        useTaskStore.getState().addTask(result);
      }
    });

    await act(async () => {
      await Promise.all(promises);
    });

    // Verify all tasks were added to the store
    await waitFor(() => {
      const store = useTaskStore.getState();
      expect(store.tasks).toHaveLength(5);

      // Verify all task IDs are present
      const taskIds = store.tasks.map(t => t.id);
      expect(taskIds).toContain('rapid-1');
      expect(taskIds).toContain('rapid-2');
      expect(taskIds).toContain('rapid-3');
      expect(taskIds).toContain('rapid-4');
      expect(taskIds).toContain('rapid-5');

      // Verify task order has all 5 tasks in backlog
      expect(store.taskOrder?.backlog).toHaveLength(5);
    });
  });

  it('should preserve existing task order when adding Insights tasks to different columns', async () => {
    // Setup: Tasks in different columns
    const backlogTask = createMockTask({ id: 'backlog-1', status: 'backlog' });
    const inProgressTask = createMockTask({ id: 'progress-1', status: 'in_progress' });

    act(() => {
      useTaskStore.getState().addTask(backlogTask);
      useTaskStore.getState().addTask(inProgressTask);
      useTaskStore.getState().setTaskOrder({
        backlog: ['backlog-1'],
        in_progress: ['progress-1'],
        ai_review: [],
        human_review: [],
        pr_created: [],
        done: []
      } as TaskOrderState);
    });

    // Create a new task for in_progress column
    const newInProgressTask = createMockTask({
      id: 'progress-2',
      status: 'in_progress'
    });

    mockCreateTaskFromInsights.mockResolvedValue({
      success: true,
      data: newInProgressTask
    });

    await act(async () => {
      const result = await createTaskFromSuggestion(
        mockProjectId,
        newInProgressTask.title,
        newInProgressTask.description,
        { ...newInProgressTask.metadata, status: 'in_progress' }
      );
      if (result) {
        useTaskStore.getState().addTask(result);
      }
    });

    // Verify backlog order unchanged and in_progress updated correctly
    await waitFor(() => {
      const store = useTaskStore.getState();
      expect(store.taskOrder?.backlog).toEqual(['backlog-1']);
      expect(store.taskOrder?.in_progress).toEqual(['progress-2', 'progress-1']);
    });
  });

  it('should handle tasks with custom metadata from Insights Chat', async () => {
    const taskWithMetadata = createMockTask({
      id: 'metadata-task',
      title: 'Task with Metadata',
      metadata: {
        category: 'feature',
        complexity: 'standard',
        priority: 'high',
        source: 'insights',
        githubIssueNumber: 123
      }
    });

    mockCreateTaskFromInsights.mockResolvedValue({
      success: true,
      data: taskWithMetadata
    });

    await act(async () => {
      const result = await createTaskFromSuggestion(
        mockProjectId,
        taskWithMetadata.title,
        taskWithMetadata.description,
        taskWithMetadata.metadata
      );
      if (result) {
        useTaskStore.getState().addTask(result);
      }
    });

    // Verify task with metadata was added
    await waitFor(() => {
      const store = useTaskStore.getState();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].metadata).toEqual({
        category: 'feature',
        complexity: 'standard',
        priority: 'high',
        source: 'insights',
        githubIssueNumber: 123
      });
    });
  });

  it('should maintain phase synchronization after adding tasks from Insights', async () => {
    // Create a task with execution progress
    const taskWithProgress = createMockTask({
      id: 'progress-task',
      title: 'Task with Execution Progress',
      executionProgress: {
        phase: 'planning',
        phaseProgress: 50,
        overallProgress: 25
      }
    });

    mockCreateTaskFromInsights.mockResolvedValue({
      success: true,
      data: taskWithProgress
    });

    await act(async () => {
      const result = await createTaskFromSuggestion(
        mockProjectId,
        taskWithProgress.title,
        taskWithProgress.description
      );
      if (result) {
        useTaskStore.getState().addTask(result);
      }
    });

    // Verify execution progress is preserved
    await waitFor(() => {
      const store = useTaskStore.getState();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].executionProgress).toEqual({
        phase: 'planning',
        phaseProgress: 50,
        overallProgress: 25
      });
    });
  });
});
