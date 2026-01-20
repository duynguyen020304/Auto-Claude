/**
 * Integration tests for task state persistence
 * Tests the complete flow: UI → IPC → file persist → reload → UI state
 *
 * This test verifies the fix for the bug where task states were not persisting
 * after refresh. The bug was in determineTaskStatusAndReason() which would
 * override user-set 'in_progress' status with calculated 'ai_review' status
 * when all subtasks were completed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Test directories - created securely with mkdtempSync to prevent TOCTOU attacks
let TEST_DIR: string;
let TEST_PROJECT_PATH: string;
let USER_DATA_PATH: string;
let TEST_SPEC_DIR: string;

// Mock Electron before importing the store
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return USER_DATA_PATH;
      return TEST_DIR;
    })
  }
}));

/**
 * Create a test implementation plan
 */
function createTestPlan(overrides: Record<string, unknown> = {}): object {
  return {
    feature: 'Test Feature',
    workflow_type: 'feature',
    status: 'backlog',
    planStatus: 'pending',
    services_involved: ['frontend'],
    phases: [
      {
        id: 'phase-1',
        name: 'Implementation Phase',
        type: 'implementation',
        subtasks: [
          {
            id: 'subtask-1-1',
            description: 'Implement feature A',
            status: 'pending',
            files_to_modify: ['file1.ts'],
            files_to_create: [],
            service: 'frontend'
          },
          {
            id: 'subtask-1-2',
            description: 'Add unit tests for feature A',
            status: 'pending',
            files_to_modify: [],
            files_to_create: ['file1.test.ts'],
            service: 'frontend'
          }
        ]
      }
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Setup test directories with secure temp directory
 */
function setupTestDirs(): void {
  // Create secure temp directory with random suffix
  TEST_DIR = mkdtempSync(path.join(tmpdir(), 'task-state-persistence-test-'));
  TEST_PROJECT_PATH = path.join(TEST_DIR, 'test-project');
  USER_DATA_PATH = path.join(TEST_DIR, 'userData');
  TEST_SPEC_DIR = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', '001-test-feature');

  mkdirSync(USER_DATA_PATH, { recursive: true });
  mkdirSync(path.join(USER_DATA_PATH, 'store'), { recursive: true });
  mkdirSync(TEST_SPEC_DIR, { recursive: true });
}

/**
 * Cleanup test directories
 */
function cleanupTestDirs(): void {
  if (TEST_DIR && existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

/**
 * Update plan status directly in implementation_plan.json
 * This simulates what the IPC handler does
 */
function updatePlanStatus(planPath: string, status: string): boolean {
  try {
    const planContent = readFileSync(planPath, 'utf-8');
    const plan = JSON.parse(planContent);

    // Map UI status to plan status (matching mapStatusToPlanStatus from plan-file-utils)
    let planStatus: string;
    switch (status) {
      case 'done':
        planStatus = 'completed';
        break;
      case 'ai_review':
      case 'human_review':
        planStatus = 'review';
        break;
      case 'pr_created':
        planStatus = 'pr_created';
        break;
      case 'in_progress':
        planStatus = 'in_progress';
        break;
      default:
        planStatus = 'pending';
    }

    plan.status = status;
    plan.planStatus = planStatus;
    plan.updated_at = new Date().toISOString();

    writeFileSync(planPath, JSON.stringify(plan, null, 2));
    return true;
  } catch (error) {
    console.error('[updatePlanStatus] Failed to update plan:', error);
    return false;
  }
}

describe('Task State Persistence Integration Tests', () => {
  beforeEach(async () => {
    cleanupTestDirs();
    setupTestDirs();
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    cleanupTestDirs();
    vi.clearAllMocks();
  });

  describe('Complete state persistence flow', () => {
    it('should persist in_progress status and reload correctly with no subtasks', async () => {
      // Test case: Task in planning phase with no subtasks yet
      const planPath = path.join(TEST_SPEC_DIR, 'implementation_plan.json');
      const plan = createTestPlan({
        status: 'in_progress',
        planStatus: 'in_progress',
        phases: [] // No subtasks yet
      });
      writeFileSync(planPath, JSON.stringify(plan, null, 2));

      // Import ProjectStore after test setup
      const { ProjectStore } = await import('../../main/project-store');
      const store = new ProjectStore();

      // Add project and load tasks
      const project = store.addProject(TEST_PROJECT_PATH);
      const tasksBefore = store.getTasks(project.id);

      // Verify initial state
      expect(tasksBefore).toHaveLength(1);
      expect(tasksBefore[0].status).toBe('in_progress');

      // Simulate page refresh by creating a new ProjectStore instance
      // This loads tasks from disk, simulating a full reload
      const storeAfterRefresh = new ProjectStore();
      const projectAfterRefresh = storeAfterRefresh.getProjects()[0];
      const tasksAfter = storeAfterRefresh.getTasks(projectAfterRefresh.id);

      // CRITICAL: Status should persist as 'in_progress'
      // Before the bug fix, this would fail because determineTaskStatusAndReason
      // would override user-set status when no subtasks exist
      expect(tasksAfter).toHaveLength(1);
      expect(tasksAfter[0].status).toBe('in_progress');
      expect(tasksAfter[0].status).not.toBe('backlog');
    });

    it('should persist in_progress status with partial subtasks completed', async () => {
      // Test case: Normal task in progress with some work done
      const planPath = path.join(TEST_SPEC_DIR, 'implementation_plan.json');
      const plan = createTestPlan({
        status: 'in_progress',
        planStatus: 'in_progress',
        phases: [
          {
            id: 'phase-1',
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'completed' },
              { id: 'subtask-2', description: 'Subtask 2', status: 'completed' },
              { id: 'subtask-3', description: 'Subtask 3', status: 'pending' }
            ]
          }
        ]
      });
      writeFileSync(planPath, JSON.stringify(plan, null, 2));

      // Import ProjectStore and load tasks
      const { ProjectStore } = await import('../../main/project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasks = store.getTasks(project.id);

      // Verify status is in_progress
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('in_progress');

      // Simulate completing all subtasks
      const updatedPlan = JSON.parse(readFileSync(planPath, 'utf-8'));
      updatedPlan.phases[0].subtasks.forEach((s: { status: string }) => {
        s.status = 'completed';
      });
      writeFileSync(planPath, JSON.stringify(updatedPlan, null, 2));

      // Reload tasks - status should remain in_progress (user-set status is respected)
      // Note: Need to re-add project since store doesn't auto-persist
      const storeAfterUpdate = new ProjectStore();
      const projectAfterUpdate = storeAfterUpdate.addProject(TEST_PROJECT_PATH);
      const tasksAfterUpdate = storeAfterUpdate.getTasks(projectAfterUpdate.id);

      // Verify user-set in_progress status persists even when all subtasks completed
      // This is the bug fix - before, it would override to ai_review
      expect(tasksAfterUpdate).toHaveLength(1);
      expect(tasksAfterUpdate[0].status).toBe('in_progress');

      // Now clear the status to test auto-calculation
      const planForAutoCalc = JSON.parse(readFileSync(planPath, 'utf-8'));
      delete planForAutoCalc.status;
      delete planForAutoCalc.planStatus;
      writeFileSync(planPath, JSON.stringify(planForAutoCalc, null, 2));

      // Reload - should auto-calculate to ai_review when no explicit status is set
      const storeAutoCalc = new ProjectStore();
      const projectAutoCalc = storeAutoCalc.addProject(TEST_PROJECT_PATH);
      const tasksAutoCalc = storeAutoCalc.getTasks(projectAutoCalc.id);

      expect(tasksAutoCalc).toHaveLength(1);
      expect(tasksAutoCalc[0].status).toBe('ai_review');
    });

    it('should persist in_progress status even when all subtasks completed (BUG FIX TEST)', async () => {
      // CRITICAL BUG FIX TEST: This is the exact scenario that was failing
      // User sets status to 'in_progress' when all subtasks are completed.
      // Before the fix, determineTaskStatusAndReason would override this with 'ai_review'.
      const planPath = path.join(TEST_SPEC_DIR, 'implementation_plan.json');
      const plan = createTestPlan({
        status: 'in_progress', // User explicitly set to in_progress
        planStatus: 'in_progress',
        phases: [
          {
            id: 'phase-1',
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'completed' },
              { id: 'subtask-2', description: 'Subtask 2', status: 'completed' },
              { id: 'subtask-3', description: 'Subtask 3', status: 'completed' }
            ]
          }
        ]
      });
      writeFileSync(planPath, JSON.stringify(plan, null, 2));

      // Load tasks initially
      const { ProjectStore } = await import('../../main/project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasksBefore = store.getTasks(project.id);

      // Verify initial state
      expect(tasksBefore).toHaveLength(1);
      expect(tasksBefore[0].status).toBe('in_progress');

      // Simulate page refresh - create new store instance
      // This is the critical test: will the status persist or be overridden?
      // Note: Need to re-add project since store doesn't auto-persist
      const storeAfterRefresh = new ProjectStore();
      const projectAfterRefresh = storeAfterRefresh.addProject(TEST_PROJECT_PATH);
      const tasksAfter = storeAfterRefresh.getTasks(projectAfterRefresh.id);

      // CRITICAL ASSERTIONS:
      // Before the bug fix, this would fail with:
      // - Expected: 'in_progress'
      // - Received: 'ai_review'
      //
      // The bug was in determineTaskStatusAndReason at lines 626-632:
      // The hasRemainingWork check failed (false when all subtasks completed),
      // causing isStoredStatusValid to return false and override the user-set status.
      expect(tasksAfter).toHaveLength(1);
      expect(tasksAfter[0].status).toBe('in_progress');
      expect(tasksAfter[0].status).not.toBe('ai_review');

      // Verify the plan file still has the correct status
      const planContent = readFileSync(planPath, 'utf-8');
      const planAfter = JSON.parse(planContent);
      expect(planAfter.status).toBe('in_progress');
    });

    it('should persist backlog → in_progress transition', async () => {
      // Test case: User drags task from backlog to in_progress column
      const planPath = path.join(TEST_SPEC_DIR, 'implementation_plan.json');
      const plan = createTestPlan({
        status: 'backlog',
        planStatus: 'pending',
        phases: [
          {
            id: 'phase-1',
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'pending' }
            ]
          }
        ]
      });
      writeFileSync(planPath, JSON.stringify(plan, null, 2));

      // Load initial tasks
      const { ProjectStore } = await import('../../main/project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasksBefore = store.getTasks(project.id);

      // Verify initial backlog status
      expect(tasksBefore).toHaveLength(1);
      expect(tasksBefore[0].status).toBe('backlog');

      // Simulate status change: backlog → in_progress
      const updateSuccess = updatePlanStatus(planPath, 'in_progress');
      expect(updateSuccess).toBe(true);

      // Reload tasks
      // Note: Need to re-add project since store doesn't auto-persist
      const storeAfterUpdate = new ProjectStore();
      const projectAfterUpdate = storeAfterUpdate.addProject(TEST_PROJECT_PATH);
      const tasksAfter = storeAfterUpdate.getTasks(projectAfterUpdate.id);

      // Verify transition persisted
      expect(tasksAfter).toHaveLength(1);
      expect(tasksAfter[0].status).toBe('in_progress');
    });

    it('should persist human_review status with review reason', async () => {
      // Test case: QA rejects task, user sets to human_review
      const planPath = path.join(TEST_SPEC_DIR, 'implementation_plan.json');
      const plan = createTestPlan({
        status: 'human_review',
        planStatus: 'review',
        phases: [
          {
            id: 'phase-1',
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'completed' }
            ]
          }
        ]
      });
      writeFileSync(planPath, JSON.stringify(plan, null, 2));

      // Load tasks
      const { ProjectStore } = await import('../../main/project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasks = store.getTasks(project.id);

      // Verify human_review status and review reason
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('human_review');
      // Review reason should be 'completed' since all subtasks are done
      expect(tasks[0].reviewReason).toBe('completed');

      // Reload and verify persistence
      // Note: Need to re-add project since store doesn't auto-persist
      const storeAfterRefresh = new ProjectStore();
      const projectAfterRefresh = storeAfterRefresh.addProject(TEST_PROJECT_PATH);
      const tasksAfter = storeAfterRefresh.getTasks(projectAfterRefresh.id);

      expect(tasksAfter).toHaveLength(1);
      expect(tasksAfter[0].status).toBe('human_review');
      expect(tasksAfter[0].reviewReason).toBe('completed');
    });

    it('should persist done status even when work remains', async () => {
      // Test case: User marks task as done despite incomplete subtasks
      const planPath = path.join(TEST_SPEC_DIR, 'implementation_plan.json');
      const plan = createTestPlan({
        status: 'done',
        planStatus: 'completed',
        phases: [
          {
            id: 'phase-1',
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'completed' },
              { id: 'subtask-2', description: 'Subtask 2', status: 'pending' }
            ]
          }
        ]
      });
      writeFileSync(planPath, JSON.stringify(plan, null, 2));

      // Load tasks
      const { ProjectStore } = await import('../../main/project-store');
      const store = new ProjectStore();

      const project = store.addProject(TEST_PROJECT_PATH);
      const tasksBefore = store.getTasks(project.id);

      // Verify done status
      expect(tasksBefore).toHaveLength(1);
      expect(tasksBefore[0].status).toBe('done');

      // Reload and verify persistence
      // Note: Need to re-add project since store doesn't auto-persist
      const storeAfterRefresh = new ProjectStore();
      const projectAfterRefresh = storeAfterRefresh.addProject(TEST_PROJECT_PATH);
      const tasksAfter = storeAfterRefresh.getTasks(projectAfterRefresh.id);

      // User's explicit 'done' should always be respected
      expect(tasksAfter).toHaveLength(1);
      expect(tasksAfter[0].status).toBe('done');
      expect(tasksAfter[0].status).not.toBe('in_progress');
    });

    it('should handle multiple sequential status changes correctly', async () => {
      // Test case: backlog → in_progress → human_review → done
      // Note: ai_review is a calculated status (when all subtasks complete), not user-settable
      const planPath = path.join(TEST_SPEC_DIR, 'implementation_plan.json');
      const plan = createTestPlan({
        status: 'backlog',
        planStatus: 'pending',
        phases: [
          {
            id: 'phase-1',
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'pending' },
              { id: 'subtask-2', description: 'Subtask 2', status: 'pending' }
            ]
          }
        ]
      });
      writeFileSync(planPath, JSON.stringify(plan, null, 2));

      const { ProjectStore } = await import('../../main/project-store');

      // Test each user-settable status transition
      const statuses: Array<'backlog' | 'in_progress' | 'human_review' | 'done'> = [
        'in_progress',
        'human_review',
        'done'
      ];

      for (const targetStatus of statuses) {
        // Update plan status
        const updateSuccess = updatePlanStatus(planPath, targetStatus);
        expect(updateSuccess).toBe(true);

        // Create new store instance to simulate page refresh
        // Note: Need to re-add project since store doesn't auto-persist
        const store = new ProjectStore();
        const project = store.addProject(TEST_PROJECT_PATH);
        const tasks = store.getTasks(project.id);

        // Verify status persisted
        expect(tasks).toHaveLength(1);
        expect(tasks[0].status).toBe(targetStatus);
      }

      // Additional test: When all subtasks complete without explicit status, should auto-calculate to ai_review
      const updatedPlan = JSON.parse(readFileSync(planPath, 'utf-8'));
      updatedPlan.phases[0].subtasks.forEach((s: { status: string }) => {
        s.status = 'completed';
      });
      delete updatedPlan.status; // Remove explicit status to test auto-calculation
      delete updatedPlan.planStatus;
      writeFileSync(planPath, JSON.stringify(updatedPlan, null, 2));

      // Reload - should auto-calculate to ai_review
      const finalStore = new ProjectStore();
      const finalProject = finalStore.addProject(TEST_PROJECT_PATH);
      const finalTasks = finalStore.getTasks(finalProject.id);

      expect(finalTasks).toHaveLength(1);
      expect(finalTasks[0].status).toBe('ai_review');
    });
  });

  describe('Status persistence with various subtask states', () => {
    it('should preserve status when subtasks are added later', async () => {
      // Test case: Task set to in_progress before subtasks exist
      const planPath = path.join(TEST_SPEC_DIR, 'implementation_plan.json');
      const plan = createTestPlan({
        status: 'in_progress',
        planStatus: 'in_progress',
        phases: [] // No subtasks initially
      });
      writeFileSync(planPath, JSON.stringify(plan, null, 2));

      // Load initial tasks
      const { ProjectStore } = await import('../../main/project-store');
      let store = new ProjectStore();
      let project = store.addProject(TEST_PROJECT_PATH);
      let tasks = store.getTasks(project.id);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('in_progress');

      // Add subtasks later (simulating spec creation completion)
      const updatedPlan = JSON.parse(readFileSync(planPath, 'utf-8'));
      updatedPlan.phases = [
        {
          id: 'phase-1',
          name: 'Phase 1',
          type: 'implementation',
          subtasks: [
            { id: 'subtask-1', description: 'Subtask 1', status: 'pending' },
            { id: 'subtask-2', description: 'Subtask 2', status: 'pending' }
          ]
        }
      ];
      writeFileSync(planPath, JSON.stringify(updatedPlan, null, 2));

      // Reload tasks
      // Note: Need to re-add project since store doesn't auto-persist
      store = new ProjectStore();
      project = store.addProject(TEST_PROJECT_PATH);
      tasks = store.getTasks(project.id);

      // Status should still be in_progress
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('in_progress');
    });

    it('should preserve status when subtasks change from pending to completed', async () => {
      // Test case: All subtasks complete while task is in in_progress
      const planPath = path.join(TEST_SPEC_DIR, 'implementation_plan.json');
      const plan = createTestPlan({
        status: 'in_progress',
        planStatus: 'in_progress',
        phases: [
          {
            id: 'phase-1',
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Subtask 1', status: 'pending' },
              { id: 'subtask-2', description: 'Subtask 2', status: 'pending' }
            ]
          }
        ]
      });
      writeFileSync(planPath, JSON.stringify(plan, null, 2));

      // Load initial tasks
      const { ProjectStore } = await import('../../main/project-store');
      let store = new ProjectStore();
      let project = store.addProject(TEST_PROJECT_PATH);
      let tasks = store.getTasks(project.id);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('in_progress');

      // Complete all subtasks (simulating implementation completion)
      const updatedPlan = JSON.parse(readFileSync(planPath, 'utf-8'));
      updatedPlan.phases[0].subtasks.forEach((subtask: { status: string }) => {
        subtask.status = 'completed';
      });
      writeFileSync(planPath, JSON.stringify(updatedPlan, null, 2));

      // Reload tasks
      // Note: Need to re-add project since store doesn't auto-persist
      store = new ProjectStore();
      project = store.addProject(TEST_PROJECT_PATH);
      tasks = store.getTasks(project.id);

      // CRITICAL: Status should still be in_progress, NOT overridden to ai_review
      // This is the exact bug scenario being fixed
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('in_progress');
      expect(tasks[0].status).not.toBe('ai_review');
    });
  });
});
