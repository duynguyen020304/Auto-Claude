/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for task-store addTask() function
 * Tests task addition with Insights-created tasks and task order synchronization
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useTaskStore } from '../task-store';
import type { Task, TaskMetadata } from '../../../shared/types';

describe('task-store addTask function', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();

    // Reset store to initial state before each test
    useTaskStore.setState({
      tasks: [],
      selectedTaskId: null,
      isLoading: false,
      error: null,
      taskOrder: null
    });
  });

  describe('addTask with Insights-created tasks', () => {
    it('should add task with Insights metadata to store', () => {
      const insightsMetadata: TaskMetadata = {
        sourceType: 'insights',
        ideationType: 'code_improvements',
        category: 'feature',
        priority: 'medium',
        complexity: 'medium',
        impact: 'high',
        rationale: 'This task improves code quality',
        problemSolved: 'Technical debt reduction',
      };

      const task: Task = {
        id: 'task-123',
        specId: 'spec-123',
        projectId: 'project-abc',
        title: 'Improve error handling',
        description: 'Add better error handling to API calls',
        status: 'backlog',
        subtasks: [],
        logs: [],
        metadata: insightsMetadata,
        createdAt: new Date('2024-01-15T10:00:00Z'),
        updatedAt: new Date('2024-01-15T10:00:00Z'),
      };

      useTaskStore.getState().addTask(task);

      // Verify task was added
      expect(useTaskStore.getState().tasks).toHaveLength(1);
      expect(useTaskStore.getState().tasks[0]).toEqual(task);
      expect(useTaskStore.getState().tasks[0].metadata?.sourceType).toBe('insights');
    });

    it('should update task order when adding Insights task to backlog', () => {
      // Initialize task order
      const initialOrder = {
        backlog: ['existing-task-1'],
        in_progress: [],
        ai_review: [],
        human_review: [],
        pr_created: [],
        done: []
      };
      useTaskStore.getState().setTaskOrder(initialOrder);

      const insightsTask: Task = {
        id: 'insights-task-1',
        specId: 'spec-insights-1',
        projectId: 'project-abc',
        title: 'Security improvements',
        description: 'Fix security vulnerabilities',
        status: 'backlog',
        subtasks: [],
        logs: [],
        metadata: {
          sourceType: 'insights',
          ideationType: 'security_hardening',
          category: 'security',
          priority: 'high',
          complexity: 'large',
          impact: 'critical',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      useTaskStore.getState().addTask(insightsTask);

      // Verify task order updated - new task should be at top of backlog
      expect(useTaskStore.getState().taskOrder?.backlog).toEqual(['insights-task-1', 'existing-task-1']);
      expect(useTaskStore.getState().taskOrder?.backlog[0]).toBe('insights-task-1');
    });

    it('should update task order when adding Insights task to different statuses', () => {
      const statuses: Array<Task['status']> = ['backlog', 'in_progress', 'ai_review', 'human_review', 'done'];

      statuses.forEach((status) => {
        // Clear and reset for each iteration
        useTaskStore.setState({
          tasks: [],
          selectedTaskId: null,
          isLoading: false,
          error: null,
          taskOrder: {
            backlog: [],
            in_progress: [],
            ai_review: [],
            human_review: [],
            pr_created: [],
            done: []
          }
        });

        const task: Task = {
          id: `task-${status}`,
          specId: `spec-${status}`,
          projectId: 'project-abc',
          title: `Task in ${status}`,
          description: `Description for ${status}`,
          status,
          subtasks: [],
          logs: [],
          metadata: {
            sourceType: 'insights',
            ideationType: 'code_improvements',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        useTaskStore.getState().addTask(task);

        // Verify task added to correct column and at top
        expect(useTaskStore.getState().taskOrder?.[status]).toEqual([`task-${status}`]);
        expect(useTaskStore.getState().taskOrder?.[status]?.[0]).toBe(`task-${status}`);
      });
    });

    it('should handle multiple Insights tasks with different statuses', () => {
      const initialOrder = {
        backlog: ['existing-backlog-1'],
        in_progress: ['existing-in-progress-1'],
        ai_review: [],
        human_review: [],
        pr_created: [],
        done: []
      };
      useTaskStore.getState().setTaskOrder(initialOrder);

      // Add first Insights task to backlog
      const task1: Task = {
        id: 'insights-1',
        specId: 'spec-1',
        projectId: 'project-abc',
        title: 'First Insights task',
        description: 'Performance optimization',
        status: 'backlog',
        subtasks: [],
        logs: [],
        metadata: { sourceType: 'insights', ideationType: 'performance' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Add second Insights task to in_progress
      const task2: Task = {
        id: 'insights-2',
        specId: 'spec-2',
        projectId: 'project-abc',
        title: 'Second Insights task',
        description: 'UI improvements',
        status: 'in_progress',
        subtasks: [],
        logs: [],
        metadata: { sourceType: 'insights', ideationType: 'ui_ux' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      useTaskStore.getState().addTask(task1);
      useTaskStore.getState().addTask(task2);

      // Verify both tasks added correctly
      expect(useTaskStore.getState().tasks).toHaveLength(2);
      expect(useTaskStore.getState().taskOrder?.backlog).toEqual(['insights-1', 'existing-backlog-1']);
      expect(useTaskStore.getState().taskOrder?.in_progress).toEqual(['insights-2', 'existing-in-progress-1']);
    });

    it('should not duplicate task ID in task order if already exists', () => {
      const initialOrder = {
        backlog: ['task-123', 'existing-task'],
        in_progress: [],
        ai_review: [],
        human_review: [],
        pr_created: [],
        done: []
      };
      useTaskStore.getState().setTaskOrder(initialOrder);

      // Try to add task that already exists in the order
      const task: Task = {
        id: 'task-123',
        specId: 'spec-123',
        projectId: 'project-abc',
        title: 'Duplicate task ID test',
        description: 'Testing duplicate ID handling',
        status: 'backlog',
        subtasks: [],
        logs: [],
        metadata: { sourceType: 'insights' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      useTaskStore.getState().addTask(task);

      // Verify task ID appears only once at the top
      const backlogOrder = useTaskStore.getState().taskOrder?.backlog || [];
      const occurrences = backlogOrder.filter(id => id === 'task-123').length;
      expect(occurrences).toBe(1);
      expect(backlogOrder[0]).toBe('task-123');
    });

    it('should initialize task order column if it does not exist', () => {
      // Set partial task order (missing some columns)
      const partialOrder = {
        backlog: ['existing-1'],
        in_progress: [],
        ai_review: [],
        human_review: [],
        pr_created: [],
        done: []
      };
      useTaskStore.getState().setTaskOrder(partialOrder);

      const task: Task = {
        id: 'new-task',
        specId: 'spec-new',
        projectId: 'project-abc',
        title: 'New task',
        description: 'Testing column initialization',
        status: 'ai_review',
        subtasks: [],
        logs: [],
        metadata: { sourceType: 'insights' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      useTaskStore.getState().addTask(task);

      // Verify ai_review column was initialized with task at top
      expect(useTaskStore.getState().taskOrder?.ai_review).toEqual(['new-task']);
    });
  });

  describe('addTask without existing task order', () => {
    it('should add task without updating task order when taskOrder is null', () => {
      // Don't initialize task order (should be null initially)
      expect(useTaskStore.getState().taskOrder).toBeNull();

      const task: Task = {
        id: 'task-no-order',
        specId: 'spec-no-order',
        projectId: 'project-abc',
        title: 'Task without order',
        description: 'Testing add task without order',
        status: 'backlog',
        subtasks: [],
        logs: [],
        metadata: { sourceType: 'insights' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      useTaskStore.getState().addTask(task);

      // Verify task added but task order still null
      expect(useTaskStore.getState().tasks).toHaveLength(1);
      expect(useTaskStore.getState().tasks[0].id).toBe('task-no-order');
      expect(useTaskStore.getState().taskOrder).toBeNull();
    });
  });

  describe('addTask with various Insights metadata', () => {
    it('should preserve all Insights metadata fields', () => {
      const completeMetadata: TaskMetadata = {
        sourceType: 'insights',
        ideationType: 'code_improvements',
        category: 'refactoring',
        complexity: 'large',
        impact: 'high',
        priority: 'urgent',
        rationale: 'Improving code maintainability',
        problemSolved: 'Complex code base needs refactoring',
        targetAudience: 'Development team',
        affectedFiles: ['src/components/*.tsx', 'src/utils/*.ts'],
        dependencies: ['task-1', 'task-2'],
        acceptanceCriteria: ['Code is more readable', 'Tests pass'],
        estimatedEffort: 'large',
        codeQualitySeverity: 'major',
      };

      const task: Task = {
        id: 'complete-task',
        specId: 'spec-complete',
        projectId: 'project-abc',
        title: 'Complete metadata task',
        description: 'Testing all metadata fields',
        status: 'backlog',
        subtasks: [],
        logs: [],
        metadata: completeMetadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      useTaskStore.getState().addTask(task);

      // Verify all metadata preserved
      expect(useTaskStore.getState().tasks[0].metadata).toEqual(completeMetadata);
      expect(useTaskStore.getState().tasks[0].metadata?.sourceType).toBe('insights');
      expect(useTaskStore.getState().tasks[0].metadata?.category).toBe('refactoring');
      expect(useTaskStore.getState().tasks[0].metadata?.priority).toBe('urgent');
    });
  });
});
