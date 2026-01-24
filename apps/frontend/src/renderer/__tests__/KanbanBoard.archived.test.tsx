/**
 * Unit tests for KanbanBoard archived task filtering
 * Tests filtering logic for archived tasks on initial load and toggle
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ViewStateProvider, useViewState } from '../contexts/ViewStateContext';
import type { Task, TaskStatus } from '../../shared/types';

// Helper to create test tasks
function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    specId: 'test-spec-001',
    projectId: 'project-1',
    title: 'Test Task',
    description: 'Test description',
    status: 'backlog' as TaskStatus,
    subtasks: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// Replicate the filtering logic from KanbanBoard.tsx (lines 527-533)
function filterTasksByArchiveStatus(tasks: Task[], showArchived: boolean): Task[] {
  if (showArchived) {
    return tasks; // Show all tasks including archived
  }
  return tasks.filter((t) => !t.metadata?.archivedAt);
}

describe('KanbanBoard Archived Task Filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial State - showArchived defaults to false', () => {
    it('should initialize showArchived to false', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ViewStateProvider>{children}</ViewStateProvider>
      );

      const { result } = renderHook(() => useViewState(), { wrapper });

      expect(result.current.showArchived).toBe(false);
    });
  });

  describe('Filtering Logic - showArchived = false (default)', () => {
    it('should filter out archived tasks when showArchived is false', () => {
      const tasks: Task[] = [
        createTestTask({ id: 'task-1', title: 'Active Task 1' }),
        createTestTask({
          id: 'task-2',
          title: 'Archived Task',
          metadata: { archivedAt: new Date().toISOString() }
        }),
        createTestTask({ id: 'task-3', title: 'Active Task 2' })
      ];

      const filtered = filterTasksByArchiveStatus(tasks, false);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.id)).toEqual(['task-1', 'task-3']);
      expect(filtered.every(t => !t.metadata?.archivedAt)).toBe(true);
    });

    it('should return all tasks when none are archived', () => {
      const tasks: Task[] = [
        createTestTask({ id: 'task-1', title: 'Task 1' }),
        createTestTask({ id: 'task-2', title: 'Task 2' }),
        createTestTask({ id: 'task-3', title: 'Task 3' })
      ];

      const filtered = filterTasksByArchiveStatus(tasks, false);

      expect(filtered).toHaveLength(3);
      expect(filtered.map(t => t.id)).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should return empty array when all tasks are archived', () => {
      const tasks: Task[] = [
        createTestTask({
          id: 'task-1',
          metadata: { archivedAt: '2024-01-01T00:00:00Z' }
        }),
        createTestTask({
          id: 'task-2',
          metadata: { archivedAt: '2024-01-02T00:00:00Z' }
        })
      ];

      const filtered = filterTasksByArchiveStatus(tasks, false);

      expect(filtered).toHaveLength(0);
    });

    it('should filter out tasks with archivedAt set to various timestamp formats', () => {
      const tasks: Task[] = [
        createTestTask({ id: 'task-1', title: 'Active Task' }),
        createTestTask({
          id: 'task-2',
          metadata: { archivedAt: '2024-01-15T10:30:00.000Z' }
        }),
        createTestTask({
          id: 'task-3',
          metadata: { archivedAt: new Date().toISOString() }
        })
      ];

      const filtered = filterTasksByArchiveStatus(tasks, false);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('task-1');
    });

    it('should handle tasks without metadata field', () => {
      const tasks: Task[] = [
        createTestTask({ id: 'task-1', title: 'Task without metadata' }),
        createTestTask({
          id: 'task-2',
          title: 'Task with empty metadata',
          metadata: {}
        })
      ];

      const filtered = filterTasksByArchiveStatus(tasks, false);

      expect(filtered).toHaveLength(2);
    });

    it('should handle empty tasks array', () => {
      const filtered = filterTasksByArchiveStatus([], false);

      expect(filtered).toHaveLength(0);
      expect(filtered).toEqual([]);
    });
  });

  describe('Filtering Logic - showArchived = true', () => {
    it('should show all tasks including archived when showArchived is true', () => {
      const tasks: Task[] = [
        createTestTask({ id: 'task-1', title: 'Active Task 1' }),
        createTestTask({
          id: 'task-2',
          title: 'Archived Task',
          metadata: { archivedAt: new Date().toISOString() }
        }),
        createTestTask({ id: 'task-3', title: 'Active Task 2' })
      ];

      const filtered = filterTasksByArchiveStatus(tasks, true);

      expect(filtered).toHaveLength(3);
      expect(filtered.map(t => t.id)).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should return all tasks when showArchived is true regardless of archive status', () => {
      const tasks: Task[] = [
        createTestTask({
          id: 'task-1',
          metadata: { archivedAt: '2024-01-01T00:00:00Z' }
        }),
        createTestTask({
          id: 'task-2',
          metadata: { archivedAt: '2024-01-02T00:00:00Z' }
        }),
        createTestTask({ id: 'task-3' })
      ];

      const filtered = filterTasksByArchiveStatus(tasks, true);

      expect(filtered).toHaveLength(3);
    });
  });

  describe('ViewStateContext Toggle Integration', () => {
    it('should toggle showArchived state correctly', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ViewStateProvider>{children}</ViewStateProvider>
      );

      const { result } = renderHook(() => useViewState(), { wrapper });

      // Initial state should be false
      expect(result.current.showArchived).toBe(false);

      // Toggle to true
      act(() => {
        result.current.toggleShowArchived();
      });

      expect(result.current.showArchived).toBe(true);

      // Toggle back to false
      act(() => {
        result.current.toggleShowArchived();
      });

      expect(result.current.showArchived).toBe(false);
    });

    it('should set showArchived state correctly', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ViewStateProvider>{children}</ViewStateProvider>
      );

      const { result } = renderHook(() => useViewState(), { wrapper });

      // Initial state should be false
      expect(result.current.showArchived).toBe(false);

      // Set to true
      act(() => {
        result.current.setShowArchived(true);
      });

      expect(result.current.showArchived).toBe(true);

      // Set to false
      act(() => {
        result.current.setShowArchived(false);
      });

      expect(result.current.showArchived).toBe(false);
    });

    it('should filter tasks correctly when showArchived state changes', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ViewStateProvider>{children}</ViewStateProvider>
      );

      const { result } = renderHook(() => useViewState(), { wrapper });

      const tasks: Task[] = [
        createTestTask({ id: 'task-1', title: 'Active Task' }),
        createTestTask({
          id: 'task-2',
          title: 'Archived Task',
          metadata: { archivedAt: new Date().toISOString() }
        })
      ];

      // Initial state - showArchived is false
      let filtered = filterTasksByArchiveStatus(tasks, result.current.showArchived);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('task-1');

      // Toggle to show archived
      act(() => {
        result.current.toggleShowArchived();
      });

      filtered = filterTasksByArchiveStatus(tasks, result.current.showArchived);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.id)).toEqual(['task-1', 'task-2']);

      // Toggle back to hide archived
      act(() => {
        result.current.toggleShowArchived();
      });

      filtered = filterTasksByArchiveStatus(tasks, result.current.showArchived);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('task-1');
    });
  });

  describe('Edge Cases', () => {
    it('should handle tasks with metadata but no archivedAt field', () => {
      const tasks: Task[] = [
        createTestTask({
          id: 'task-1',
          metadata: { sourceType: 'manual' }
        }),
        createTestTask({
          id: 'task-2',
          metadata: { archivedAt: new Date().toISOString() }
        })
      ];

      const filtered = filterTasksByArchiveStatus(tasks, false);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('task-1');
    });

    it('should handle tasks with metadata.archivedAt set to null', () => {
      const tasks: Task[] = [
        createTestTask({
          id: 'task-1',
          metadata: { archivedAt: null as any }
        }),
        createTestTask({
          id: 'task-2',
          metadata: { archivedAt: new Date().toISOString() }
        })
      ];

      const filtered = filterTasksByArchiveStatus(tasks, false);

      // null should be treated as "not archived"
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('task-1');
    });

    it('should handle tasks with metadata.archivedAt set to undefined', () => {
      const tasks: Task[] = [
        createTestTask({
          id: 'task-1',
          metadata: { archivedAt: undefined }
        }),
        createTestTask({
          id: 'task-2',
          metadata: { archivedAt: new Date().toISOString() }
        })
      ];

      const filtered = filterTasksByArchiveStatus(tasks, false);

      // undefined should be treated as "not archived"
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('task-1');
    });

    it('should handle mixed task statuses with archived tasks', () => {
      const tasks: Task[] = [
        createTestTask({ id: 'task-1', status: 'backlog' }),
        createTestTask({
          id: 'task-2',
          status: 'done',
          metadata: { archivedAt: new Date().toISOString() }
        }),
        createTestTask({ id: 'task-3', status: 'in_progress' }),
        createTestTask({
          id: 'task-4',
          status: 'done',
          metadata: { archivedAt: '2024-01-01T00:00:00Z' }
        })
      ];

      const filtered = filterTasksByArchiveStatus(tasks, false);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.id)).toEqual(['task-1', 'task-3']);
    });
  });
});
