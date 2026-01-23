import { create } from 'zustand';
import { arrayMove } from '@dnd-kit/sortable';
import type { Task, TaskStatus, SubtaskStatus, ImplementationPlan, Subtask, TaskMetadata, ExecutionProgress, ExecutionPhase, ReviewReason, TaskDraft, ImageAttachment, TaskOrderState } from '../../shared/types';
import { debugLog } from '../../shared/utils/debug-logger';
import { isTerminalPhase } from '../../shared/constants/phase-protocol';
import { getTaskOperationQueue } from '../lib/taskOperationQueue';

interface TaskState {
  tasks: Task[];
  selectedTaskId: string | null;
  isLoading: boolean;
  error: string | null;
  taskOrder: TaskOrderState | null;  // Per-column task ordering for kanban board

  // Actions
  setTasks: (tasks: Task[] | ((prevTasks: Task[]) => Task[])) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  updateTaskFromPlan: (taskId: string, plan: ImplementationPlan) => void;
  updateExecutionProgress: (taskId: string, progress: Partial<ExecutionProgress>) => void;
  appendLog: (taskId: string, log: string) => void;
  batchAppendLogs: (taskId: string, logs: string[]) => void;
  selectTask: (taskId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearTasks: () => void;
  // Task order actions for kanban drag-and-drop reordering
  setTaskOrder: (order: TaskOrderState) => void;
  reorderTasksInColumn: (status: TaskStatus, activeId: string, overId: string) => void;
  moveTaskToColumnTop: (taskId: string, targetStatus: TaskStatus, sourceStatus?: TaskStatus) => void;
  loadTaskOrder: (projectId: string) => void;
  saveTaskOrder: (projectId: string) => boolean;
  clearTaskOrder: (projectId: string) => void;

  // Task status change listeners (for queue auto-promotion)
  registerTaskStatusChangeListener: (listener: (taskId: string, oldStatus: TaskStatus | undefined, newStatus: TaskStatus) => void) => () => void;

  // Selectors
  getSelectedTask: () => Task | undefined;
  getTasksByStatus: (status: TaskStatus) => Task[];
}

/**
 * Helper to find task index by id or specId.
 * Returns -1 if not found.
 */
function findTaskIndex(tasks: Task[], taskId: string): number {
  return tasks.findIndex((t) => t.id === taskId || t.specId === taskId);
}

/**
 * Task status change listeners for queue auto-promotion
 * Stored outside the store to avoid triggering re-renders
 */
const taskStatusChangeListeners = new Set<(taskId: string, oldStatus: TaskStatus | undefined, newStatus: TaskStatus) => void>();

/**
 * Notify all registered listeners when a task status changes
 */
function notifyTaskStatusChange(taskId: string, oldStatus: TaskStatus | undefined, newStatus: TaskStatus): void {
  for (const listener of taskStatusChangeListeners) {
    try {
      listener(taskId, oldStatus, newStatus);
    } catch (error) {
      console.error('[TaskStore] Error in task status change listener:', error);
    }
  }
}

/**
 * Helper to update a single task efficiently.
 * Uses slice instead of map to avoid iterating all tasks.
 */
function updateTaskAtIndex(tasks: Task[], index: number, updater: (task: Task) => Task): Task[] {
  if (index < 0 || index >= tasks.length) return tasks;

  const updatedTask = updater(tasks[index]);

  // If the task reference didn't change, return original array
  if (updatedTask === tasks[index]) {
    return tasks;
  }

  // Create new array with only the changed task replaced
  const newTasks = [...tasks];
  newTasks[index] = updatedTask;

  return newTasks;
}

/**
 * Validates implementation plan data structure before processing.
 * Returns true if valid, false if invalid/incomplete.
 */
function validatePlanData(plan: ImplementationPlan): boolean {
  // Validate plan has phases array
  if (!plan.phases || !Array.isArray(plan.phases)) {
    console.warn('[validatePlanData] Invalid plan: missing or invalid phases array');
    return false;
  }

  // Validate each phase has subtasks array
  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i];
    if (!phase || !phase.subtasks || !Array.isArray(phase.subtasks)) {
      console.warn(`[validatePlanData] Invalid phase ${i}: missing or invalid subtasks array`);
      return false;
    }

    // Validate each subtask has at minimum a description
    for (let j = 0; j < phase.subtasks.length; j++) {
      const subtask = phase.subtasks[j];
      if (!subtask || typeof subtask !== 'object') {
        console.warn(`[validatePlanData] Invalid subtask at phase ${i}, index ${j}: not an object`);
        return false;
      }

      // Description is critical - we can't show a subtask without it
      if (!subtask.description || typeof subtask.description !== 'string' || subtask.description.trim() === '') {
        console.warn(`[validatePlanData] Invalid subtask at phase ${i}, index ${j}: missing or empty description`);
        return false;
      }
    }
  }

  return true;
}

/**
 * Active execution phases where task is actively running and progress should be preserved
 */
const ACTIVE_EXECUTION_PHASES: ExecutionPhase[] = ['planning', 'coding', 'qa_review', 'qa_fixing'];

/**
 * Check if a task is in an active execution phase
 * Returns true if task is actively running and its progress should be preserved during refresh
 */
function isTaskInActivePhase(task: Task | undefined): boolean {
  if (!task?.executionProgress?.phase) return false;
  return ACTIVE_EXECUTION_PHASES.includes(task.executionProgress.phase);
}

/**
 * Deep clone executionProgress to prevent reference sharing between tasks.
 * This ensures state isolation between concurrent tasks.
 */
function cloneExecutionProgress(progress: ExecutionProgress | undefined): ExecutionProgress | undefined {
  if (!progress) return undefined;
  return {
    phase: progress.phase,
    phaseProgress: progress.phaseProgress,
    overallProgress: progress.overallProgress,
    sequenceNumber: progress.sequenceNumber
  };
}

/**
 * Merge refreshed tasks from backend with existing task state from frontend.
 * Preserves executionProgress for tasks that are actively running to prevent progress loss during refresh.
 *
 * This solves the "progress loss bug" where clicking "Refresh Tasks" would reset all running tasks to 0%.
 * The backend doesn't have executionProgress (it's transient runtime state), so we preserve it from local state.
 *
 * CRITICAL: Always creates new task objects to ensure state isolation and prevent reference sharing.
 *
 * @param refreshedTasks - Tasks loaded from backend (without executionProgress)
 * @param existingTasks - Current tasks from frontend state (with executionProgress for running tasks)
 * @returns Merged task array with executionProgress preserved for active tasks
 */
function mergeTaskStates(refreshedTasks: Task[], existingTasks: Task[]): Task[] {
  return refreshedTasks.map((refreshedTask) => {
    const existingTask = existingTasks.find((t) => t.id === refreshedTask.id || t.specId === refreshedTask.specId);

    // Preserve executionProgress for tasks in active execution phases
    if (existingTask && isTaskInActivePhase(existingTask)) {
      // Task is actively running - preserve its execution progress from local state
      // CRITICAL: Deep clone executionProgress to prevent reference sharing
      return {
        ...refreshedTask,
        executionProgress: cloneExecutionProgress(existingTask.executionProgress)
      };
    }

    // Task is not running or doesn't exist locally - create a copy to ensure isolation
    // This prevents mutations to the input array from affecting store state
    return { ...refreshedTask };
  });
}

// localStorage key prefix for task order persistence
const TASK_ORDER_KEY_PREFIX = 'task-order-state';

// localStorage key prefix for task execution progress persistence
const TASK_PROGRESS_KEY_PREFIX = 'task-execution-progress';

/**
 * Get the localStorage key for a project's task order
 */
function getTaskOrderKey(projectId: string): string {
  return `${TASK_ORDER_KEY_PREFIX}-${projectId}`;
}

/**
 * Get the localStorage key for a project's task execution progress cache
 */
function getTaskProgressKey(projectId: string): string {
  return `${TASK_PROGRESS_KEY_PREFIX}-${projectId}`;
}

/**
 * Create an empty task order state with all status columns
 */
function createEmptyTaskOrder(): TaskOrderState {
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

/**
 * Type for task execution progress cache map
 */
type TaskProgressCache = Record<string, ExecutionProgress>;

/**
 * Save executionProgress for all running tasks in a project to localStorage.
 * This preserves progress when switching between project tabs.
 *
 * @param projectId - The project ID to save progress for
 * @param tasks - The current task list
 */
function saveTaskProgress(projectId: string, tasks: Task[]): void {
  const progressMap: TaskProgressCache = {};

  for (const task of tasks) {
    // Only cache progress for actively running tasks in this project
    if (task.projectId === projectId && task.executionProgress && isTaskInActivePhase(task)) {
      progressMap[task.id] = cloneExecutionProgress(task.executionProgress);
    }
  }

  try {
    const key = getTaskProgressKey(projectId);
    localStorage.setItem(key, JSON.stringify(progressMap));
  } catch (error) {
    console.error('Failed to save task progress:', error);
  }
}

/**
 * Load cached executionProgress for a project from localStorage.
 * Returns a map of taskId → executionProgress.
 *
 * @param projectId - The project ID to load progress for
 * @returns Cached progress map
 */
function loadTaskProgress(projectId: string): TaskProgressCache {
  try {
    const key = getTaskProgressKey(projectId);
    const stored = localStorage.getItem(key);
    if (!stored) return {};

    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') {
      console.warn('Invalid task progress data in localStorage');
      return {};
    }

    return parsed as TaskProgressCache;
  } catch (error) {
    console.error('Failed to load task progress:', error);
    return {};
  }
}

/**
 * Clear cached executionProgress for a project or specific task.
 * Call this when a task completes or a project is deleted.
 *
 * @param projectId - The project ID to clear progress for
 * @param taskId - Optional task ID to clear only that task's progress
 */
function clearTaskProgress(projectId: string, taskId?: string): void {
  try {
    const key = getTaskProgressKey(projectId);
    if (taskId) {
      // Clear specific task's progress
      const stored = localStorage.getItem(key);
      if (stored) {
        const progressMap = JSON.parse(stored) as TaskProgressCache;
        delete progressMap[taskId];
        localStorage.setItem(key, JSON.stringify(progressMap));
      }
    } else {
      // Clear all progress for project
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.error('Failed to clear task progress:', error);
  }
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  isLoading: false,
  error: null,
  taskOrder: null,

  setTasks: (tasks) =>
    set((state) => {
      // Use functional update to merge refreshed tasks with existing state
      // This preserves executionProgress for tasks that are actively running
      if (typeof tasks === 'function') {
        // If a function is passed, call it with current state (for manual merge logic)
        return { tasks: tasks(state.tasks) };
      }

      // Otherwise, merge the provided task array with existing state
      const mergedTasks = mergeTaskStates(tasks, state.tasks);
      return { tasks: mergedTasks };
    }),

  addTask: (task) =>
    set((state) => {
      // Determine which column the task belongs to based on its status
      const status = task.status || 'backlog';

      // Update task order if it exists - new tasks go to top of their column
      let taskOrder = state.taskOrder;
      if (taskOrder) {
        const newTaskOrder = { ...taskOrder };

        // Add task ID to the top of the appropriate column
        if (newTaskOrder[status]) {
          // Ensure the task isn't already in the array (safety check)
          newTaskOrder[status] = newTaskOrder[status].filter(id => id !== task.id);
          // Add to top (index 0)
          newTaskOrder[status] = [task.id, ...newTaskOrder[status]];
        } else {
          // Initialize column order array if it doesn't exist
          newTaskOrder[status] = [task.id];
        }

        taskOrder = newTaskOrder;
      }

      return {
        tasks: [...state.tasks, task],
        taskOrder
      };
    }),

  updateTask: (taskId, updates) =>
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) return state;

      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => ({ ...t, ...updates }))
      };
    }),

  updateTaskStatus: (taskId, status) => {
    // Capture old status before update
    const state = get();
    const index = findTaskIndex(state.tasks, taskId);
    if (index === -1) {
      debugLog('[updateTaskStatus] Task not found:', taskId);
      return;
    }
    const oldTask = state.tasks[index];
    const oldStatus = oldTask.status;

    // Skip if status is the same
    if (oldStatus === status) return;

    // Perform the state update
    set((state) => {
      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => {
          // Determine execution progress based on status transition
          let executionProgress = t.executionProgress;

          // Track status transition for debugging flip-flop issues
          const previousStatus = t.status;
          const statusChanged = previousStatus !== status;

          if (status === 'backlog') {
            // When status goes to backlog, reset execution progress to idle
            // This ensures the planning/coding animation stops when task is stopped
            executionProgress = { phase: 'idle' as ExecutionPhase, phaseProgress: 0, overallProgress: 0 };
          } else if (status === 'in_progress' && !t.executionProgress?.phase) {
            // When starting a task and no phase is set yet, default to planning
            // This prevents the "no active phase" UI state during startup race condition
            executionProgress = { phase: 'planning' as ExecutionPhase, phaseProgress: 0, overallProgress: 0 };
          }

          // Log status transitions to help diagnose flip-flop issues
          debugLog('[updateTaskStatus] Status transition:', {
            taskId,
            previousStatus,
            newStatus: status,
            statusChanged,
            currentPhase: t.executionProgress?.phase,
            newPhase: executionProgress?.phase
          });

          return { ...t, status, executionProgress, updatedAt: new Date() };
        })
      };
    });

    // Clear cached progress when task reaches terminal status (done, error, pr_created)
    // This prevents stale progress data from persisting in localStorage
    const terminalStatuses: TaskStatus[] = ['done', 'error', 'pr_created'];
    if (terminalStatuses.includes(status)) {
      clearTaskProgress(oldTask.projectId, taskId);
    }

    // Notify listeners after state update (schedule after current tick)
    queueMicrotask(() => {
      notifyTaskStatusChange(taskId, oldStatus, status);
    });
  },

  updateTaskFromPlan: (taskId, plan) =>
    set((state) => {
      // FIX (PR Review): Gate debug logging to prevent production console clutter
      debugLog('[updateTaskFromPlan] called with plan:', {
        taskId,
        feature: plan.feature,
        phases: plan.phases?.length || 0,
        totalSubtasks: plan.phases?.reduce((acc, p) => acc + (p.subtasks?.length || 0), 0) || 0
        // Note: planData removed to avoid verbose output in logs
      });

      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) {
        console.log('[updateTaskFromPlan] Task not found:', taskId);
        return state;
      }

      // Validate plan data before processing
      if (!validatePlanData(plan)) {
        console.error('[updateTaskFromPlan] Invalid plan data, skipping update:', {
          taskId,
          plan
        });
        return state;
      }

      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => {
          const subtasks: Subtask[] = plan.phases.flatMap((phase) =>
            phase.subtasks.map((subtask) => {
              // Ensure all required fields have valid values to prevent UI issues
              // Use crypto.randomUUID() for stronger randomness when available
              const id = subtask.id || (typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `subtask-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
              // Defensive fallback: validatePlanData() ensures description exists, but kept for safety
              const description = subtask.description || 'No description available';
              const title = description; // Title and description are the same for subtasks
              const status = (subtask.status as SubtaskStatus) || 'pending';

              return {
                id,
                title,
                description,
                status,
                files: [],
                verification: subtask.verification as Subtask['verification']
              };
            })
          );

          debugLog('[updateTaskFromPlan] Created subtasks:', {
            taskId,
            subtaskCount: subtasks.length,
            subtasks: subtasks.map(s => ({
              id: s.id,
              title: s.title,
              status: s.status
            }))
          });

          const allCompleted = subtasks.every((s) => s.status === 'completed');
          const anyFailed = subtasks.some((s) => s.status === 'failed');
          const anyInProgress = subtasks.some((s) => s.status === 'in_progress');
          const anyCompleted = subtasks.some((s) => s.status === 'completed');

          let status: TaskStatus = t.status;
          let reviewReason: ReviewReason | undefined = t.reviewReason;

          // RACE CONDITION FIX: Don't let stale plan data override status during active execution
          // Strengthen guard: ANY active phase means NO status recalculation from plan data
          const activePhases: ExecutionPhase[] = ['planning', 'coding', 'qa_review', 'qa_fixing'];
          const isInActivePhase = Boolean(t.executionProgress?.phase && activePhases.includes(t.executionProgress.phase));

          // FIX (Flip-Flop Bug): Terminal phases should NOT trigger status recalculation
          // When phase is 'complete' or 'failed', the task has finished and status should be stable
          const isInTerminalPhase = Boolean(t.executionProgress?.phase && isTerminalPhase(t.executionProgress.phase));

          // FIX (Subtask 2-1): Terminal task statuses should NEVER be recalculated from plan data
          // pr_created, done, and error are finalized workflow states set by explicit user/system actions
          // Once a task reaches these statuses, they should only change via explicit user actions (like drag-drop)
          // This prevents stale plan file reads from incorrectly downgrading completed tasks
          // NOTE: Keep this in sync with TERMINAL_STATUSES in project-store.ts
          const TERMINAL_TASK_STATUSES: TaskStatus[] = ['pr_created', 'done', 'error'];
          const isInTerminalStatus = TERMINAL_TASK_STATUSES.includes(t.status);

          // FIX (Flip-Flop Bug): Respect explicit human_review status from plan file
          // When the plan explicitly says 'human_review', don't override it with calculated status
          // Note: ImplementationPlan type already defines status?: TaskStatus
          const planStatus = plan.status;
          const isExplicitHumanReview = planStatus === 'human_review';

          // FIX (ACS-203): Add defensive check for terminal status transitions
          // Before allowing transition to 'done', 'human_review', or 'ai_review', verify:
          // 1. Subtasks array is properly populated (not empty)
          // 2. All subtasks are actually completed (for 'done' and 'ai_review' statuses)
          const hasSubtasks = subtasks.length > 0;
          const terminalStatuses: TaskStatus[] = ['human_review', 'done'];

          // If task is currently in a terminal status, validate subtasks before allowing downgrade
          // This prevents flip-flop when plan file is written with incomplete data
          const shouldBlockTerminalTransition = (newStatus: TaskStatus): boolean => {
            // Block if: moving to terminal status but subtasks indicate incomplete work
            if (terminalStatuses.includes(newStatus) || newStatus === 'ai_review') {
              // For ai_review, all subtasks must be completed
              if (newStatus === 'ai_review' && (!allCompleted || !hasSubtasks)) {
                return true;
              }
              // For done, all subtasks must be completed
              if (newStatus === 'done' && (!allCompleted || !hasSubtasks)) {
                return true;
              }
              // For human_review with 'completed' reason, all subtasks must be done
              // But allow 'errors' or 'qa_rejected' reasons even with incomplete subtasks
              if (newStatus === 'human_review' && anyFailed) {
                return false; // Allow human_review for failed subtasks
              }
            }
            return false;
          };

          // Only recalculate status if:
          // 1. NOT in an active execution phase (planning, coding, qa_review, qa_fixing)
          // 2. NOT in a terminal phase (complete, failed) - status should be stable
          // 3. NOT in a terminal task status (pr_created, done) - finalized workflow states
          // 4. Plan doesn't explicitly say human_review
          // 5. Would not create an invalid terminal transition (ACS-203)
          if (!isInActivePhase && !isInTerminalPhase && !isInTerminalStatus && !isExplicitHumanReview) {
            if (allCompleted && hasSubtasks) {
              // FIX (Flip-Flop Bug): Don't downgrade from terminal statuses to ai_review
              // Once a task reaches human_review or done, it should stay there
              // unless explicitly changed (these are finalized workflow states)
              if (!terminalStatuses.includes(t.status)) {
                status = 'ai_review';
              }
            } else if (anyFailed) {
              status = 'human_review';
              reviewReason = 'errors';
            } else if (anyInProgress || anyCompleted) {
              status = 'in_progress';
            }
          }

          // FIX (ACS-203): Final validation - prevent invalid terminal status transitions
          // This catches cases where the logic above would set a terminal status
          // but the subtask state doesn't support it (e.g., empty subtasks array)
          if (shouldBlockTerminalTransition(status)) {
            // Capture attempted status before reassignment for accurate logging
            const attemptedStatus = status;
            // Keep current status instead of transitioning to invalid terminal state
            status = t.status;
            debugLog('[updateTaskFromPlan] Blocked invalid terminal transition:', {
              taskId,
              attemptedStatus,
              currentStatus: t.status,
              hasSubtasks,
              allCompleted,
              anyFailed,
              subtaskCount: subtasks.length
            });
          }

          debugLog('[updateTaskFromPlan] Status computation:', {
            taskId,
            currentStatus: t.status,
            newStatus: status,
            isInActivePhase,
            isInTerminalPhase,
            isInTerminalStatus,
            isExplicitHumanReview,
            planStatus,
            currentPhase: t.executionProgress?.phase,
            allCompleted,
            anyFailed,
            anyInProgress,
            anyCompleted
          });

          return {
            ...t,
            title: plan.feature || t.title,
            subtasks,
            status,
            reviewReason,
            updatedAt: new Date()
          };
        })
      };
    }),

  updateExecutionProgress: (taskId, progress) =>
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) return state;

      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => {
          const existingProgress = t.executionProgress || {
            phase: 'idle' as ExecutionPhase,
            phaseProgress: 0,
            overallProgress: 0,
            sequenceNumber: 0
          };

          const incomingSeq = progress.sequenceNumber ?? 0;
          const currentSeq = existingProgress.sequenceNumber ?? 0;
          if (incomingSeq > 0 && currentSeq > 0 && incomingSeq < currentSeq) {
            // FIX (ACS-55): Log when updates are dropped due to sequence numbers
            // This helps debug phase transition issues
            console.warn('[updateExecutionProgress] Dropping out-of-order update:', {
              taskId,
              incomingSeq,
              currentSeq,
              incomingPhase: progress.phase,
              currentPhase: existingProgress.phase
            });
            return t; // Skip out-of-order update
          }

          // Only update updatedAt on phase transitions (not on every progress tick)
          // This prevents unnecessary re-renders from the memo comparator
          const phaseChanged = progress.phase && progress.phase !== existingProgress.phase;

          // CRITICAL: Create new executionProgress object to prevent reference sharing
          // Deep clone ensures state isolation between tasks
          const mergedProgress = {
            ...existingProgress,
            ...progress
          };

          return {
            ...t,
            executionProgress: mergedProgress,
            // Only set updatedAt on phase changes to reduce re-renders
            ...(phaseChanged ? { updatedAt: new Date() } : {})
          };
        })
      };
    }),

  appendLog: (taskId, log) =>
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) return state;

      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => ({
          ...t,
          logs: [...(t.logs || []), log]
        }))
      };
    }),

  // Batch append multiple logs at once (single state update instead of N updates)
  batchAppendLogs: (taskId, logs) =>
    set((state) => {
      if (logs.length === 0) return state;
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) return state;

      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => ({
          ...t,
          logs: [...(t.logs || []), ...logs]
        }))
      };
    }),

  selectTask: (taskId) => set({ selectedTaskId: taskId }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearTasks: () => {
    const state = get();
    // Save progress for all tasks before clearing
    if (state.tasks.length > 0) {
      const projectIds = new Set(state.tasks.map(t => t.projectId));
      for (const projectId of projectIds) {
        saveTaskProgress(projectId, state.tasks);
      }
    }
    set({ tasks: [], selectedTaskId: null, taskOrder: null });
  },

  // Task order actions for kanban drag-and-drop reordering
  setTaskOrder: (order) => set({ taskOrder: order }),

  reorderTasksInColumn: (status, activeId, overId) => {
    set((state) => {
      if (!state.taskOrder) return state;

      const columnOrder = state.taskOrder[status];
      if (!columnOrder) return state;

      const oldIndex = columnOrder.indexOf(activeId);
      const newIndex = columnOrder.indexOf(overId);

      // Both tasks must be in the column order array
      if (oldIndex === -1 || newIndex === -1) return state;

      return {
        taskOrder: {
          ...state.taskOrder,
          [status]: arrayMove(columnOrder, oldIndex, newIndex)
        }
      };
    });
  },

  moveTaskToColumnTop: (taskId, targetStatus, sourceStatus) => {
    set((state) => {
      if (!state.taskOrder) return state;

      // Create a copy of the task order to modify
      const newTaskOrder = { ...state.taskOrder };

      // Remove from source column if provided
      if (sourceStatus && newTaskOrder[sourceStatus]) {
        newTaskOrder[sourceStatus] = newTaskOrder[sourceStatus].filter(id => id !== taskId);
      }

      // Add to top of target column
      if (newTaskOrder[targetStatus]) {
        // Remove from target column first (in case it already exists there)
        newTaskOrder[targetStatus] = newTaskOrder[targetStatus].filter(id => id !== taskId);
        // Add to top (index 0)
        newTaskOrder[targetStatus] = [taskId, ...newTaskOrder[targetStatus]];
      } else {
        // Initialize column order array if it doesn't exist
        newTaskOrder[targetStatus] = [taskId];
      }

      return { taskOrder: newTaskOrder };
    });
  },

  loadTaskOrder: (projectId) => {
    try {
      const key = getTaskOrderKey(projectId);
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate structure before assigning - type assertion is compile-time only
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          console.warn('Invalid task order data in localStorage, resetting to empty');
          set({ taskOrder: createEmptyTaskOrder() });
          return;
        }

        // Helper to validate column values are string arrays
        const isValidColumnArray = (val: unknown): val is string[] =>
          Array.isArray(val) && val.every(item => typeof item === 'string');

        // Merge with empty order to handle partial data and validate each column
        const emptyOrder = createEmptyTaskOrder();
        const validatedOrder: TaskOrderState = {
          backlog: isValidColumnArray(parsed.backlog) ? parsed.backlog : emptyOrder.backlog,
          queue: isValidColumnArray(parsed.queue) ? parsed.queue : emptyOrder.queue,
          in_progress: isValidColumnArray(parsed.in_progress) ? parsed.in_progress : emptyOrder.in_progress,
          ai_review: isValidColumnArray(parsed.ai_review) ? parsed.ai_review : emptyOrder.ai_review,
          human_review: isValidColumnArray(parsed.human_review) ? parsed.human_review : emptyOrder.human_review,
          done: isValidColumnArray(parsed.done) ? parsed.done : emptyOrder.done,
          pr_created: isValidColumnArray(parsed.pr_created) ? parsed.pr_created : emptyOrder.pr_created,
          error: isValidColumnArray(parsed.error) ? parsed.error : emptyOrder.error
        };

        set({ taskOrder: validatedOrder });
      } else {
        set({ taskOrder: createEmptyTaskOrder() });
      }
    } catch (error) {
      console.error('Failed to load task order:', error);
      set({ taskOrder: createEmptyTaskOrder() });
    }
  },

  saveTaskOrder: (projectId) => {
    try {
      const state = get();
      if (!state.taskOrder) {
        // Nothing to save - return false to indicate no save occurred
        return false;
      }

      const key = getTaskOrderKey(projectId);
      localStorage.setItem(key, JSON.stringify(state.taskOrder));
      return true;
    } catch (error) {
      console.error('Failed to save task order:', error);
      return false;
    }
  },

  clearTaskOrder: (projectId) => {
    try {
      const key = getTaskOrderKey(projectId);
      localStorage.removeItem(key);
      set({ taskOrder: null });
    } catch (error) {
      console.error('Failed to clear task order:', error);
    }
  },

  getSelectedTask: () => {
    const state = get();
    return state.tasks.find((t) => t.id === state.selectedTaskId);
  },

  getTasksByStatus: (status) => {
    const state = get();
    return state.tasks.filter((t) => t.status === status);
  },

  registerTaskStatusChangeListener: (listener) => {
    taskStatusChangeListeners.add(listener);
    // Return cleanup function to unregister
    return () => {
      taskStatusChangeListeners.delete(listener);
    };
  }
}));

/**
 * Load tasks for a project
 * @param projectId - The project ID to load tasks for
 * @param options - Optional parameters
 * @param options.forceRefresh - If true, invalidates server-side cache before fetching (for refresh button)
 *
 * Uses operation queue to prevent race conditions with delete/start operations.
 */
export async function loadTasks(projectId: string, options?: { forceRefresh?: boolean }): Promise<void> {
  const queue = getTaskOperationQueue();

  return queue.enqueue(async () => {
    const store = useTaskStore.getState();
    store.setLoading(true);
    store.setError(null);

    // Save executionProgress for all tasks currently in the store before switching projects
    // Group tasks by projectId and save progress for each project
    if (store.tasks.length > 0) {
      const projectIds = new Set(store.tasks.map(t => t.projectId));
      for (const currentProjectId of projectIds) {
        saveTaskProgress(currentProjectId, store.tasks);
      }
    }

    try {
      const result = await window.electronAPI.getTasks(projectId, options);
      if (result.success && result.data) {
        // Load cached executionProgress for the target project
        const cachedProgress = loadTaskProgress(projectId);

        // Merge cached progress with loaded tasks
        const tasksWithProgress = result.data.map(task => {
          const cached = cachedProgress[task.id];
          if (cached) {
            // Task has cached progress - restore it
            return { ...task, executionProgress: cached };
          }
          // No cached progress - return task as-is
          return task;
        });

        // Use functional update to explicitly merge tasks with existing state
        // This preserves any in-memory executionProgress that wasn't cached
        store.setTasks(prevTasks => mergeTaskStates(tasksWithProgress, prevTasks));
      } else {
        store.setError(result.error || 'Failed to load tasks');
      }
    } catch (error) {
      store.setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      store.setLoading(false);
    }
  });
}

/**
 * Create a new task
 */
export async function createTask(
  projectId: string,
  title: string,
  description: string,
  metadata?: TaskMetadata
): Promise<Task | null> {
  const store = useTaskStore.getState();

  try {
    const result = await window.electronAPI.createTask(projectId, title, description, metadata);
    if (result.success && result.data) {
      store.addTask(result.data);
      return result.data;
    } else {
      store.setError(result.error || 'Failed to create task');
      return null;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Start a task
 *
 * Uses operation queue to prevent race conditions with refresh/delete operations.
 */
export function startTask(taskId: string, options?: { parallel?: boolean; workers?: number }): void {
  const queue = getTaskOperationQueue();

  // Enqueue the start operation but don't await - fire and forget
  void queue.enqueue(async () => {
    window.electronAPI.startTask(taskId, options);
  });
}

/**
 * Stop a task
 */
export function stopTask(taskId: string): void {
  window.electronAPI.stopTask(taskId);
}

/**
 * Submit review for a task
 */
export async function submitReview(
  taskId: string,
  approved: boolean,
  feedback?: string,
  images?: ImageAttachment[]
): Promise<boolean> {
  const store = useTaskStore.getState();

  try {
    const result = await window.electronAPI.submitReview(taskId, approved, feedback, images);
    if (result.success) {
      store.updateTaskStatus(taskId, approved ? 'done' : 'in_progress');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Result type for persistTaskStatus with worktree info
 */
export interface PersistStatusResult {
  success: boolean;
  worktreeExists?: boolean;
  worktreePath?: string;
  error?: string;
}

/**
 * Update task status and persist to file
 * Returns additional info if a worktree exists and needs cleanup confirmation
 */
export async function persistTaskStatus(
  taskId: string,
  status: TaskStatus,
  options?: { forceCleanup?: boolean }
): Promise<PersistStatusResult> {
  const store = useTaskStore.getState();

  try {
    // Persist to file first (don't optimistically update for 'done' status)
    const result = await window.electronAPI.updateTaskStatus(taskId, status, options);

    if (!result.success) {
      // Check if this is a worktree exists case
      if (result.worktreeExists) {
        console.log('[persistTaskStatus] Worktree exists, confirmation needed');
        return {
          success: false,
          worktreeExists: true,
          worktreePath: result.worktreePath,
          error: result.error
        };
      }
      console.error('Failed to persist task status:', result.error);
      return { success: false, error: result.error };
    }

    // Only update local state after backend confirms success
    store.updateTaskStatus(taskId, status);
    return { success: true };
  } catch (error) {
    console.error('Error persisting task status:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Force complete a task by cleaning up its worktree
 * Used when user confirms they want to delete the worktree and mark as done
 * Returns full result including error details for better UX
 */
export async function forceCompleteTask(taskId: string): Promise<PersistStatusResult> {
  return persistTaskStatus(taskId, 'done', { forceCleanup: true });
}

/**
 * Update task title/description/metadata and persist to file
 */
export async function persistUpdateTask(
  taskId: string,
  updates: { title?: string; description?: string; metadata?: Partial<TaskMetadata> }
): Promise<boolean> {
  const store = useTaskStore.getState();

  try {
    // Call the IPC to persist changes to spec files
    const result = await window.electronAPI.updateTask(taskId, updates);

    if (result.success && result.data) {
      // Update local state with the returned task data
      store.updateTask(taskId, {
        title: result.data.title,
        description: result.data.description,
        metadata: result.data.metadata,
        updatedAt: new Date()
      });
      return true;
    }

    console.error('Failed to persist task update:', result.error);
    return false;
  } catch (error) {
    console.error('Error persisting task update:', error);
    return false;
  }
}

/**
 * Check if a task has an active running process
 */
export async function checkTaskRunning(taskId: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.checkTaskRunning(taskId);
    return result.success && result.data === true;
  } catch (error) {
    console.error('Error checking task running status:', error);
    return false;
  }
}

/**
 * Recover a stuck task (status shows in_progress but no process running)
 * @param taskId - The task ID to recover
 * @param options - Recovery options (autoRestart defaults to true)
 */
export async function recoverStuckTask(
  taskId: string,
  options: { targetStatus?: TaskStatus; autoRestart?: boolean } = { autoRestart: true }
): Promise<{ success: boolean; message: string; autoRestarted?: boolean }> {
  const store = useTaskStore.getState();

  try {
    const result = await window.electronAPI.recoverStuckTask(taskId, options);

    if (result.success && result.data) {
      // Update local state
      store.updateTaskStatus(taskId, result.data.newStatus);
      return {
        success: true,
        message: result.data.message,
        autoRestarted: result.data.autoRestarted
      };
    }

    return {
      success: false,
      message: result.error || 'Failed to recover task'
    };
  } catch (error) {
    console.error('Error recovering stuck task:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Delete a task and its spec directory
 *
 * Uses operation queue to prevent race conditions with refresh/start operations.
 */
export async function deleteTask(
  taskId: string
): Promise<{ success: boolean; error?: string }> {
  const queue = getTaskOperationQueue();

  return queue.enqueue(async () => {
    const store = useTaskStore.getState();

    try {
      // Find the task to get its projectId before deleting
      const taskToDelete = store.tasks.find(t => t.id === taskId || t.specId === taskId);
      const projectId = taskToDelete?.projectId;

      const result = await window.electronAPI.deleteTask(taskId);

      if (result.success) {
        // Remove from local state
        store.setTasks(store.tasks.filter(t => t.id !== taskId && t.specId !== taskId));
        // Clear selection if this task was selected
        if (store.selectedTaskId === taskId) {
          store.selectTask(null);
        }
        // Clear cached progress for this task if we know the projectId
        if (projectId) {
          clearTaskProgress(projectId, taskId);
        }
        return { success: true };
      }

      return {
        success: false,
        error: result.error || 'Failed to delete task'
      };
    } catch (error) {
      console.error('Error deleting task:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });
}

/**
 * Archive tasks
 * Marks tasks as archived by adding archivedAt timestamp to metadata
 */
export async function archiveTasks(
  projectId: string,
  taskIds: string[],
  version?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await window.electronAPI.archiveTasks(projectId, taskIds, version);

    if (result.success) {
      // Reload tasks to update the UI (archived tasks will be filtered out by default)
      await loadTasks(projectId);
      return { success: true };
    }

    return {
      success: false,
      error: result.error || 'Failed to archive tasks'
    };
  } catch (error) {
    console.error('Error archiving tasks:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// ============================================
// Task Creation Draft Management
// ============================================

const DRAFT_KEY_PREFIX = 'task-creation-draft';

/**
 * Get the localStorage key for a project's draft
 */
function getDraftKey(projectId: string): string {
  return `${DRAFT_KEY_PREFIX}-${projectId}`;
}

/**
 * Save a task creation draft to localStorage
 * Note: For large images, we only store thumbnails in the draft to avoid localStorage limits
 */
export function saveDraft(draft: TaskDraft): void {
  try {
    const key = getDraftKey(draft.projectId);
    // Create a copy with thumbnails only to avoid localStorage size limits
    const draftToStore = {
      ...draft,
      images: draft.images.map(img => ({
        ...img,
        data: undefined // Don't store full image data in localStorage
      })),
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(key, JSON.stringify(draftToStore));
  } catch (error) {
    console.error('Failed to save draft:', error);
  }
}

/**
 * Load a task creation draft from localStorage
 */
export function loadDraft(projectId: string): TaskDraft | null {
  try {
    const key = getDraftKey(projectId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const draft = JSON.parse(stored);
    // Convert savedAt back to Date
    draft.savedAt = new Date(draft.savedAt);
    return draft as TaskDraft;
  } catch (error) {
    console.error('Failed to load draft:', error);
    return null;
  }
}

/**
 * Clear a task creation draft from localStorage
 */
export function clearDraft(projectId: string): void {
  try {
    const key = getDraftKey(projectId);
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Failed to clear draft:', error);
  }
}

/**
 * Check if a draft exists for a project
 */
export function hasDraft(projectId: string): boolean {
  const key = getDraftKey(projectId);
  return localStorage.getItem(key) !== null;
}

/**
 * Check if a draft has any meaningful content (title, description, or images)
 */
export function isDraftEmpty(draft: TaskDraft | null): boolean {
  if (!draft) return true;
  return (
    !draft.title.trim() &&
    !draft.description.trim() &&
    draft.images.length === 0 &&
    !draft.category &&
    !draft.priority &&
    !draft.complexity &&
    !draft.impact
  );
}

// ============================================
// GitHub Issue Linking Helpers
// ============================================

/**
 * Find a task by GitHub issue number
 * Used to check if a task already exists for a GitHub issue
 */
export function getTaskByGitHubIssue(issueNumber: number): Task | undefined {
  const store = useTaskStore.getState();
  return store.tasks.find(t => t.metadata?.githubIssueNumber === issueNumber);
}

// ============================================
// Task State Detection Helpers
// ============================================

/**
 * Check if a task is in human_review but has no completed subtasks.
 * This indicates the task crashed/exited before implementation completed
 * and should be resumed rather than reviewed.
 */
export function isIncompleteHumanReview(task: Task): boolean {
  if (task.status !== 'human_review') return false;

  // JSON error tasks are intentionally in human_review with no subtasks - not incomplete
  if (task.reviewReason === 'errors') return false;

  // If no subtasks defined, task hasn't been planned yet (shouldn't be in human_review)
  if (!task.subtasks || task.subtasks.length === 0) return true;

  // Check if any subtasks are completed
  const completedSubtasks = task.subtasks.filter(s => s.status === 'completed').length;

  // If 0 completed subtasks, this task crashed before implementation
  return completedSubtasks === 0;
}

/**
 * Get the count of completed subtasks for a task
 */
export function getCompletedSubtaskCount(task: Task): number {
  if (!task.subtasks || task.subtasks.length === 0) return 0;
  return task.subtasks.filter(s => s.status === 'completed').length;
}

/**
 * Get task progress info
 */
export function getTaskProgress(task: Task): { completed: number; total: number; percentage: number } {
  const total = task.subtasks?.length || 0;
  const completed = task.subtasks?.filter(s => s.status === 'completed').length || 0;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percentage };
}
