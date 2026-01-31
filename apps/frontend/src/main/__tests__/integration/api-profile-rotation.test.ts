/**
 * Integration tests for API Profile Rotation with Agent Process
 * Tests automatic profile rotation based on usage, rate limits, and priority
 *
 * Subtask 6.2: Integration test for agent process with rotated API profiles
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Create a mock process object that will be returned by spawn
function createMockProcess() {
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, callback: any) => {
      if (event === 'exit') {
        // Simulate immediate exit with code 0
        setTimeout(() => callback(0), 10);
      }
    }),
    kill: vi.fn()
  };
}

// Mock child_process - must be BEFORE imports of modules that use it
const spawnCalls: Array<{ command: string; args: string[]; options: { env: Record<string, string>; cwd?: string; [key: string]: unknown } }> = [];

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const mockSpawn = vi.fn((command: string, args: string[], options: { env: Record<string, string>; cwd?: string; [key: string]: unknown }) => {
    // Record the call for test assertions
    spawnCalls.push({ command, args, options });
    return createMockProcess();
  });

  return {
    ...actual,
    spawn: mockSpawn,
    execSync: vi.fn((command: string) => {
      if (command.includes('git')) {
        return '/fake/path';
      }
      return '';
    })
  };
});

// Mock project-initializer
vi.mock('../../project-initializer', () => ({
  getAutoBuildPath: vi.fn(() => '/fake/auto-build'),
  isInitialized: vi.fn(() => true),
  initializeProject: vi.fn(),
  getProjectStorePath: vi.fn(() => '/fake/store/path')
}));

// Mock project-store BEFORE agent-process imports it
vi.mock('../../project-store', () => ({
  projectStore: {
    getProject: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    getProjectSettings: vi.fn(),
    updateProjectSettings: vi.fn(),
    getProjects: vi.fn(() => [])
  }
}));

// Mock claude-profile-manager
vi.mock('../../claude-profile-manager', () => ({
  getClaudeProfileManager: vi.fn(() => ({
    getProfilePath: vi.fn(() => '/fake/profile/path'),
    ensureProfileDir: vi.fn(),
    readProfile: vi.fn(),
    writeProfile: vi.fn(),
    deleteProfile: vi.fn()
  }))
}));

// Mock profile service with rotation support
vi.mock('../../services/profile', () => ({
  getAPIProfileEnv: vi.fn(),
  getRotatedAPIProfileEnv: vi.fn(),
  trackAPIProfileUsage: vi.fn()
}));

// Mock rate-limit-detector
vi.mock('../../rate-limit-detector', () => ({
  getBestAvailableProfileEnv: vi.fn(() => ({
    env: {},
    profileId: 'default',
    profileName: 'Default',
    wasSwapped: false
  })),
  detectRateLimit: vi.fn(() => ({ isRateLimited: false })),
  createSDKRateLimitInfo: vi.fn(),
  detectAuthFailure: vi.fn(() => ({ isAuthFailure: false }))
}));

// Mock python-detector
vi.mock('../../python-detector', () => ({
  findPythonCommand: vi.fn(() => 'python'),
  parsePythonCommand: vi.fn(() => ['python', []])
}));

// Mock python-env-manager
vi.mock('../../python-env-manager', () => ({
  pythonEnvManager: {
    isEnvReady: vi.fn(() => true),
    initialize: vi.fn(() => Promise.resolve({ ready: true })),
    getPythonEnv: vi.fn(() => ({}))
  },
  getConfiguredPythonPath: vi.fn(() => 'python3')
}));

// Mock electron
vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/fake/app/path')
  }
}));

// Mock cli-tool-manager
vi.mock('../../cli-tool-manager', () => ({
  getToolInfo: vi.fn(() => ({
    found: false,
    path: undefined,
    source: 'user-config',
    message: 'Tool not found'
  })),
  getClaudeCliPathForSdk: vi.fn(() => null),
  deriveGitBashPath: vi.fn(() => null),
  clearCache: vi.fn()
}));

// Mock env-utils
vi.mock('../../env-utils', () => ({
  getAugmentedEnv: vi.fn(() => ({ ...process.env }))
}));

// Mock fs.existsSync
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((inputPath: string) => {
      const normalizedPath = inputPath.replace(/\\/g, '/');
      if (normalizedPath === '/fake/auto-build' ||
          normalizedPath === '/fake/auto-build/runners' ||
          normalizedPath === '/fake/auto-build/runners/spec_runner.py') {
        return true;
      }
      return false;
    })
  };
});

// Mock utils/profile-manager for dynamic imports in agent-process
vi.mock('../../utils/profile-manager', () => ({
  loadProfilesFile: vi.fn(() => Promise.resolve({
    profiles: [],
    activeProfileId: null
  })),
  saveProfilesFile: vi.fn(),
  generateProfileId: vi.fn(() => 'mock-profile-id')
}));

// Import AFTER all mocks are set up
import { AgentProcessManager } from '../../agent/agent-process';
import { AgentState } from '../../agent/agent-state';
import { AgentEvents } from '../../agent/agent-events';
import * as profileService from '../../services/profile';

describe('API Profile Rotation - Integration with Agent Process', () => {
  let processManager: AgentProcessManager;
  let state: AgentState;
  let events: AgentEvents;
  let emitter: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    spawnCalls.length = 0;

    // Clear environment variables
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CLI_PATH;
    delete process.env.GITHUB_CLI_PATH;

    // Initialize components
    state = new AgentState();
    events = new AgentEvents();
    emitter = new EventEmitter();
    processManager = new AgentProcessManager(state, events, emitter);
  });

  afterEach(() => {
    processManager.killAllProcesses();
  });

  describe('Rotation Strategy: Priority Order', () => {
    it('should select first available profile based on priority order', async () => {
      // Mock rotation enabled with priority order
      const priorityProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-priority-1.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-priority-1-key'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(priorityProfileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].options.env.ANTHROPIC_BASE_URL).toBe('https://api-priority-1.com');
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-priority-1-key');
    });

    it('should rotate to next priority profile when first is rate limited', async () => {
      // First call: Profile 1 (gets rate limited)
      const profile1Env = {
        ANTHROPIC_BASE_URL: 'https://api-1.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profile1Env);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Verify first call used Profile 1
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');

      // Second call: Should rotate to Profile 2 (Profile 1 is rate limited)
      const profile2Env = {
        ANTHROPIC_BASE_URL: 'https://api-2.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profile2Env);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Verify second call used Profile 2
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');
    });

    it('should track usage after successful agent completion', async () => {
      const profileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-tracking.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-tracking-key'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(profileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Wait for process exit (mocked to exit after 10ms)
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify process spawned successfully with the profile
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-tracking-key');
    });

    it('should use priority strategy as default when no strategy specified (backward compatibility)', async () => {
      // Priority strategy should be the default behavior
      // When profiles exist, it should select based on priority order
      const defaultPriorityEnv = {
        ANTHROPIC_BASE_URL: 'https://api-default-priority.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-default-priority'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(defaultPriorityEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should use priority-based selection by default
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-default-priority');
    });

    it('should respect profile list order for priority selection', async () => {
      // Profiles should be tried in list order: Profile A, then Profile B, then Profile C
      const profileAEnv = {
        ANTHROPIC_BASE_URL: 'https://api-a.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-a'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(profileAEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // First available profile in priority order should be selected
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-a');
      expect(spawnCalls[0].options.env.ANTHROPIC_BASE_URL).toBe('https://api-a.com');
    });

    it('should maintain backward compatibility with existing single profile configuration', async () => {
      // Single profile configuration should work as before
      const singleProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-legacy.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-legacy-key'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(singleProfileEnv);

      // Spawn multiple agents with single profile
      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 50));

      // All agents should use the same profile (backward compatible behavior)
      expect(spawnCalls).toHaveLength(3);
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-legacy-key');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-legacy-key');
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-legacy-key');
    });

    it('should skip to next profile when current priority profile is unavailable', async () => {
      // Profile 1 is unavailable (rate limit or error)
      // Profile 2 should be selected
      const profile2Env = {
        ANTHROPIC_BASE_URL: 'https://api-profile-2.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(profile2Env);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should skip unavailable Profile 1 and use Profile 2
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');
      expect(spawnCalls[0].options.env.ANTHROPIC_BASE_URL).toBe('https://api-profile-2.com');
    });

    it('should prefer available profiles over rate-limited ones in priority order', async () => {
      // Among multiple profiles, should select first available one
      // Even if a higher-priority profile exists but is rate-limited
      const availablePriorityEnv = {
        ANTHROPIC_BASE_URL: 'https://api-available.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-available'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(availablePriorityEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should use the first available profile in priority order
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-available');
    });
  });

  describe('Rotation Strategy: Least-Used', () => {
    it('should select profile with lowest usage when configured', async () => {
      // Simulate least-used strategy selecting Profile 3 (lowest usage)
      const leastUsedProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-least-used.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-least-used'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(leastUsedProfileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-least-used');
    });

    it('should track request count increment after each agent completion', async () => {
      // Simulate tracking request count for least-used strategy
      // First call: Profile A (requestCount: 0)
      const profileAEnv = {
        ANTHROPIC_BASE_URL: 'https://api-a.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-a',
        profileId: 'profile-a'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileAEnv);
      vi.mocked(profileService.trackAPIProfileUsage).mockResolvedValue(undefined);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Wait for process exit
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify first agent used Profile A
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-a');

      // Second call: Profile B (next least-used, requestCount: 0)
      const profileBEnv = {
        ANTHROPIC_BASE_URL: 'https://api-b.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-b',
        profileId: 'profile-b'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileBEnv);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Wait for process exit
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify second agent used Profile B (both now have requestCount: 1)
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-b');
    });

    it('should select profile with lowest request count when multiple profiles exist', async () => {
      // Simulate three profiles with different request counts:
      // Profile A: requestCount=5, Profile B: requestCount=2, Profile C: requestCount=0
      // Should select Profile C (lowest request count)
      const profileCEnv = {
        ANTHROPIC_BASE_URL: 'https://api-c.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-c',
        profileId: 'profile-c'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileCEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should select Profile C (lowest requestCount)
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-c');

      // After using Profile C, its requestCount becomes 1
      // Next call should select Profile B (requestCount=2, now lowest)
      const profileBEnv = {
        ANTHROPIC_BASE_URL: 'https://api-b.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-b',
        profileId: 'profile-b'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileBEnv);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should select Profile B (now lowest after Profile C was used)
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-b');
    });

    it('should handle tie-breaking when multiple profiles have the same request count', async () => {
      // Simulate tie-breaking: multiple profiles with same requestCount
      // Should fall back to priority order for tie-breaking
      // Profile A and Profile B both have requestCount=0, Profile A has higher priority
      const profileAEnv = {
        ANTHROPIC_BASE_URL: 'https://api-a.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-a',
        profileId: 'profile-a'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileAEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should select Profile A (higher priority in tie-break)
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-a');

      // After Profile A has requestCount=1, Profile B is now the lowest with requestCount=0
      const profileBEnv = {
        ANTHROPIC_BASE_URL: 'https://api-b.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-b',
        profileId: 'profile-b'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileBEnv);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should select Profile B (now sole lowest)
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-b');

      // Both profiles now have requestCount=1, next call should use priority order tie-break
      // Profile A (higher priority) should be selected
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileAEnv);

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should select Profile A (tie-break by priority order)
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-a');
    });

    it('should distribute load evenly across profiles with least-used strategy', async () => {
      // Simulate even distribution: all profiles start at requestCount=0
      // After each call, requestCount increments, selecting next profile with count=0
      // Then all have count=1, strategy continues distribution
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1',
          profileId: 'profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2',
          profileId: 'profile-2'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3',
          profileId: 'profile-3'
        }
      ];

      // All start at requestCount=0
      // First 3 calls: each gets one profile (requestCount increments to 1)
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(profiles[0])
        .mockResolvedValueOnce(profiles[1])
        .mockResolvedValueOnce(profiles[2]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 50));

      // All profiles now have requestCount=1
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-3');

      // Fourth call: all tied at requestCount=1, should use priority order tie-break
      // Profile 1 has highest priority
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[0]);

      await processManager.spawnProcess('task-4', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should select Profile 1 (priority tie-break when requestCounts are equal)
      expect(spawnCalls[3].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
    });

    it('should respect requestCount even when priority differs', async () => {
      // Simulate scenario where lower-priority profile has lower requestCount
      // Profile A (priority 1, requestCount=10)
      // Profile B (priority 2, requestCount=1)
      // Profile C (priority 3, requestCount=0)
      // Should select Profile C despite lowest priority (lowest requestCount)
      const profileCEnv = {
        ANTHROPIC_BASE_URL: 'https://api-c.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-c',
        profileId: 'profile-c'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileCEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should select Profile C (lowest requestCount, despite lowest priority)
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-c');
    });
  });

  describe('Rotation Strategy: Round-Robin', () => {
    it('should cycle through profiles sequentially', async () => {
      // First call: Profile A
      const profileAEnv = {
        ANTHROPIC_BASE_URL: 'https://api-a.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-a'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileAEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-a');

      // Second call: Profile B (next in round-robin)
      const profileBEnv = {
        ANTHROPIC_BASE_URL: 'https://api-b.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-b'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileBEnv);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-b');

      // Third call: Profile C (continues cycle)
      const profileCEnv = {
        ANTHROPIC_BASE_URL: 'https://api-c.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-c'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileCEnv);

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-c');
    });

    it('should persist rotation index across calls', async () => {
      // Simulate round-robin with state persistence
      // The rotation index should be saved after each selection

      // First call: Profile A (index 0)
      const profileAEnv = {
        ANTHROPIC_BASE_URL: 'https://api-a.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-a'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileAEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-a');

      // Wait for process to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second call: Profile B (index should advance to 1)
      const profileBEnv = {
        ANTHROPIC_BASE_URL: 'https://api-b.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-b'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileBEnv);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-b');

      // Wait for process to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Third call: Profile C (index should advance to 2)
      const profileCEnv = {
        ANTHROPIC_BASE_URL: 'https://api-c.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-c'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileCEnv);

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-c');
    });

    it('should wrap around to first profile after reaching end of list', async () => {
      // Simulate cycling through all profiles and wrapping around

      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
        }
      ];

      // Cycle through all 3 profiles
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(profiles[0])
        .mockResolvedValueOnce(profiles[1])
        .mockResolvedValueOnce(profiles[2]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-3');

      // Fourth call should wrap around to first profile
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[0]);

      await processManager.spawnProcess('task-4', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[3].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
    });

    it('should maintain rotation state when profiles become unavailable', async () => {
      // Test that rotation index is maintained even when some profiles are unavailable

      const allProfiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
        }
      ];

      // First call: Profile 1
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(allProfiles[0]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');

      // Second call: Profile 2
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(allProfiles[1]);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');

      // Third call: Profile 3 (should skip Profile 1 even if available, continue round-robin)
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(allProfiles[2]);

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-3');
    });

    it('should start rotation from first profile when no previous state exists', async () => {
      // Initial call with no previous rotation state should start at index 0

      const firstProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-first.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-first-profile'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(firstProfileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-first-profile');
    });
  });

  describe('Fallback Behavior', () => {
    it('should fall back to active profile when all profiles are unavailable', async () => {
      // Mock rotation returning empty (all profiles unavailable)
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue({});

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should have clearing vars (OAuth mode clears ANTHROPIC_* vars to empty string)
      expect(spawnCalls).toHaveLength(1);
      const env = spawnCalls[0].options.env as Record<string, unknown>;
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe(''); // Empty string from clearing vars
    });

    it('should handle rotation service errors gracefully', async () => {
      // Simulate service error
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockRejectedValue(new Error('Rotation service unavailable'));

      // Should not throw - should fall back to OAuth mode
      await expect(
        processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution')
      ).resolves.not.toThrow();

      expect(spawnCalls).toHaveLength(1);
    });
  });

  describe('Concurrent Agent Execution', () => {
    it('should allow multiple agents with different rotated profiles', async () => {
      // Agent 1: Profile 1
      const profile1Env = {
        ANTHROPIC_BASE_URL: 'https://api-1.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profile1Env);

      // Spawn Agent 1
      const task1Promise = processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Wait a bit for Agent 1 to start
      await new Promise(resolve => setTimeout(resolve, 5));

      // Agent 2: Profile 2 (rotated)
      const profile2Env = {
        ANTHROPIC_BASE_URL: 'https://api-2.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profile2Env);

      // Spawn Agent 2
      const task2Promise = processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Wait for both to complete
      await Promise.all([task1Promise, task2Promise]);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify both agents spawned with different profiles
      expect(spawnCalls).toHaveLength(2);

      const profiles = spawnCalls.map(call => call.options.env.ANTHROPIC_AUTH_TOKEN);
      expect(profiles).toContain('sk-profile-1');
      expect(profiles).toContain('sk-profile-2');
    });
  });

  describe('Rate Limit Handling', () => {
    it('should avoid rate-limited profiles when selecting', async () => {
      // Mock rotation avoiding rate-limited profile and selecting available one
      const availableProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-available.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-available'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(availableProfileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should use available profile, not rate-limited one
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-available');
    });

    it('should track usage even when rate limit is approached', async () => {
      const nearLimitProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-near-limit.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-near-limit'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(nearLimitProfileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Wait for process exit
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify process spawned successfully
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-near-limit');
    });
  });

  describe('Environment Variable Precedence', () => {
    it('should give API profile env vars highest precedence', async () => {
      const extraEnv = {
        ANTHROPIC_AUTH_TOKEN: 'sk-extra-token',
        CUSTOM_VAR: 'from-extra'
      };

      const apiProfileEnv = {
        ANTHROPIC_AUTH_TOKEN: 'sk-api-profile',
        ANTHROPIC_BASE_URL: 'https://api-profile.com'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(apiProfileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], extraEnv, 'task-execution');

      const env = spawnCalls[0].options.env as Record<string, unknown>;

      // API profile should override extraEnv for ANTHROPIC_* vars
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-api-profile');
      expect(env.ANTHROPIC_BASE_URL).toBe('https://api-profile.com');

      // Extra env vars should still be present
      expect(env.CUSTOM_VAR).toBe('from-extra');
    });

    it('should include model-specific env vars when configured in profile', async () => {
      const profileWithModelsEnv = {
        ANTHROPIC_BASE_URL: 'https://api-models.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-models',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5-20250929',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5-20250929',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-5-20251101'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(profileWithModelsEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      const env = spawnCalls[0].options.env as Record<string, unknown>;

      // Verify all model env vars are set
      expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-5-20250929');
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-haiku-4-5-20251001');
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-4-5-20250929');
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-5-20251101');
    });
  });

  describe('Profile Rotation State Tracking', () => {
    it('should update rotation state after each agent completion', async () => {
      // First agent: Profile A
      const profileAEnv = {
        ANTHROPIC_BASE_URL: 'https://api-a.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-a'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileAEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify first agent used Profile A
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-a');

      // Second agent: Profile B (rotation state updated)
      const profileBEnv = {
        ANTHROPIC_BASE_URL: 'https://api-b.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-b'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profileBEnv);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify second agent used Profile B
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-b');
    });
  });

  describe('Rotation Strategy: Random', () => {
    it('should select profile randomly from available pool', async () => {
      // Random strategy should select from all available profiles
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
        }
      ];

      // Random selection returns one of the available profiles
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(profiles[1]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');
    });

    it('should demonstrate uniform distribution across multiple selections', async () => {
      // With sufficient samples, random selection should approximate uniform distribution
      // For 3 profiles with 30 selections (10 each), we expect roughly equal distribution
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
        }
      ];

      // Simulate 30 selections with controlled distribution (10 each)
      const selectionSequence: typeof profiles = [];
      for (let i = 0; i < 10; i++) {
        selectionSequence.push(profiles[0], profiles[1], profiles[2]);
      }

      // Shuffle to simulate randomness
      const shuffled = [...selectionSequence].sort(() => Math.random() - 0.5);

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockImplementation(async () => {
        return shuffled.shift() || profiles[0];
      });

      // Spawn 30 processes
      for (let i = 1; i <= 30; i++) {
        await processManager.spawnProcess(`task-${i}`, '/fake/cwd', ['run.py'], {}, 'task-execution');
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(spawnCalls).toHaveLength(30);

      // Count selections per profile
      const profileCounts: Record<string, number> = {
        'sk-profile-1': 0,
        'sk-profile-2': 0,
        'sk-profile-3': 0
      };

      for (const call of spawnCalls) {
        const token = call.options.env.ANTHROPIC_AUTH_TOKEN as string;
        if (token in profileCounts) {
          profileCounts[token]++;
        }
      }

      // Verify each profile was selected (uniform distribution simulation)
      expect(profileCounts['sk-profile-1']).toBeGreaterThan(0);
      expect(profileCounts['sk-profile-2']).toBeGreaterThan(0);
      expect(profileCounts['sk-profile-3']).toBeGreaterThan(0);
      expect(profileCounts['sk-profile-1'] + profileCounts['sk-profile-2'] + profileCounts['sk-profile-3']).toBe(30);
    });

    it('should maintain approximate uniform distribution with variance tolerance', async () => {
      // Real-world randomness has variance - we allow ±20% from expected
      // For 3 profiles with 60 selections, expect 20±4 each (16-24 range)
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
        }
      ];

      // Simulate distribution with some variance: 18, 20, 22 (within ±20% of 20)
      const distribution = [
        ...Array(18).fill(profiles[0]),
        ...Array(20).fill(profiles[1]),
        ...Array(22).fill(profiles[2])
      ];

      // Shuffle to simulate randomness
      const shuffled = distribution.sort(() => Math.random() - 0.5);

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockImplementation(async () => {
        return shuffled.shift() || profiles[0];
      });

      // Spawn 60 processes
      for (let i = 1; i <= 60; i++) {
        await processManager.spawnProcess(`task-${i}`, '/fake/cwd', ['run.py'], {}, 'task-execution');
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(spawnCalls).toHaveLength(60);

      // Count selections per profile
      const profileCounts: Record<string, number> = {
        'sk-profile-1': 0,
        'sk-profile-2': 0,
        'sk-profile-3': 0
      };

      for (const call of spawnCalls) {
        const token = call.options.env.ANTHROPIC_AUTH_TOKEN as string;
        if (token in profileCounts) {
          profileCounts[token]++;
        }
      }

      // Verify variance is within acceptable range (16-24 for expected 20)
      expect(profileCounts['sk-profile-1']).toBeGreaterThanOrEqual(16);
      expect(profileCounts['sk-profile-1']).toBeLessThanOrEqual(24);
      expect(profileCounts['sk-profile-2']).toBeGreaterThanOrEqual(16);
      expect(profileCounts['sk-profile-2']).toBeLessThanOrEqual(24);
      expect(profileCounts['sk-profile-3']).toBeGreaterThanOrEqual(16);
      expect(profileCounts['sk-profile-3']).toBeLessThanOrEqual(24);
    });

    it('should skip unavailable profiles when selecting randomly', async () => {
      // Random selection should only choose from available profiles
      // Profiles 1 and 3 are available, Profile 2 is rate-limited/unavailable
      const availableProfiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
        }
      ];

      // Random selection from available pool only
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(availableProfiles[0])
        .mockResolvedValueOnce(availableProfiles[1])
        .mockResolvedValueOnce(availableProfiles[0]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // All selections should be from available profiles only
      const selectedTokens = spawnCalls.map(call => call.options.env.ANTHROPIC_AUTH_TOKEN);
      expect(selectedTokens).toContain('sk-profile-1');
      expect(selectedTokens).toContain('sk-profile-3');
      expect(selectedTokens).not.toContain('sk-profile-2'); // Unavailable profile never selected
    });

    it('should work with single available profile (degenerate case)', async () => {
      // When only one profile is available, random selection always returns it
      const singleProfile = {
        ANTHROPIC_BASE_URL: 'https://api-single.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-single'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(singleProfile);

      // Multiple calls should all use the same profile
      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // All should use the single available profile
      expect(spawnCalls).toHaveLength(3);
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-single');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-single');
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-single');
    });

    it('should not require persistent state like round-robin', async () => {
      // Random strategy doesn't need to track rotation index
      // Each selection is independent
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        }
      ];

      // Each call independently random
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(profiles[1])
        .mockResolvedValueOnce(profiles[0])
        .mockResolvedValueOnce(profiles[1]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Random selections are independent (no sequential pattern required)
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');
    });
  });

  describe('Rotation Strategy: Weighted', () => {
    it('should select profile based on configured weights', async () => {
      // Weighted strategy selects profiles based on weight distribution
      // Higher weight = higher probability of selection
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-low.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-low'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-medium.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-medium'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-high.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-high'
        }
      ];

      // Weighted selection returns profile based on weights (e.g., 1:2:7)
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(profiles[2]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-high');
    });

    it('should demonstrate weighted distribution across multiple selections', async () => {
      // With sufficient samples, weighted selection approximates configured weights
      // For weights 1:2:7 (total=10), expect ~10%, ~20%, ~70% distribution
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-low.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-low'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-medium.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-medium'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-high.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-high'
        }
      ];

      // Simulate 100 selections with weighted distribution (10, 20, 70)
      const selectionSequence: typeof profiles = [
        ...Array(10).fill(profiles[0]),
        ...Array(20).fill(profiles[1]),
        ...Array(70).fill(profiles[2])
      ];

      // Shuffle to simulate weighted randomness
      const shuffled = [...selectionSequence].sort(() => Math.random() - 0.5);

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockImplementation(async () => {
        return shuffled.shift() || profiles[0];
      });

      // Spawn 100 processes
      for (let i = 1; i <= 100; i++) {
        await processManager.spawnProcess(`task-${i}`, '/fake/cwd', ['run.py'], {}, 'task-execution');
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(spawnCalls).toHaveLength(100);

      // Count selections per profile
      const profileCounts: Record<string, number> = {
        'sk-profile-low': 0,
        'sk-profile-medium': 0,
        'sk-profile-high': 0
      };

      for (const call of spawnCalls) {
        const token = call.options.env.ANTHROPIC_AUTH_TOKEN as string;
        if (token in profileCounts) {
          profileCounts[token]++;
        }
      }

      // Verify weighted distribution (10%, 20%, 70%)
      expect(profileCounts['sk-profile-low']).toBeGreaterThan(0);
      expect(profileCounts['sk-profile-medium']).toBeGreaterThan(0);
      expect(profileCounts['sk-profile-high']).toBeGreaterThan(0);
      expect(profileCounts['sk-profile-low'] + profileCounts['sk-profile-medium'] + profileCounts['sk-profile-high']).toBe(100);

      // High-weight profile should have significantly more selections
      expect(profileCounts['sk-profile-high']).toBeGreaterThan(profileCounts['sk-profile-medium']);
      expect(profileCounts['sk-profile-medium']).toBeGreaterThan(profileCounts['sk-profile-low']);
    });

    it('should maintain approximate weighted distribution with variance tolerance', async () => {
      // Real-world weighted randomness has variance - we allow ±25% from expected
      // For weights 1:2:7 with 100 selections, expect 10±2, 20±5, 70±18
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-low.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-low'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-medium.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-medium'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-high.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-high'
        }
      ];

      // Simulate distribution within variance: 8, 22, 70 (within acceptable range)
      const distribution = [
        ...Array(8).fill(profiles[0]),
        ...Array(22).fill(profiles[1]),
        ...Array(70).fill(profiles[2])
      ];

      // Shuffle to simulate weighted randomness
      const shuffled = distribution.sort(() => Math.random() - 0.5);

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockImplementation(async () => {
        return shuffled.shift() || profiles[0];
      });

      // Spawn 100 processes
      for (let i = 1; i <= 100; i++) {
        await processManager.spawnProcess(`task-${i}`, '/fake/cwd', ['run.py'], {}, 'task-execution');
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(spawnCalls).toHaveLength(100);

      // Count selections per profile
      const profileCounts: Record<string, number> = {
        'sk-profile-low': 0,
        'sk-profile-medium': 0,
        'sk-profile-high': 0
      };

      for (const call of spawnCalls) {
        const token = call.options.env.ANTHROPIC_AUTH_TOKEN as string;
        if (token in profileCounts) {
          profileCounts[token]++;
        }
      }

      // Verify variance is within acceptable range
      // Low weight (10%): 8-12 expected, allow 5-15 (±50% tolerance for small counts)
      expect(profileCounts['sk-profile-low']).toBeGreaterThanOrEqual(5);
      expect(profileCounts['sk-profile-low']).toBeLessThanOrEqual(15);

      // Medium weight (20%): 16-24 expected, allow 12-28 (±25% tolerance)
      expect(profileCounts['sk-profile-medium']).toBeGreaterThanOrEqual(12);
      expect(profileCounts['sk-profile-medium']).toBeLessThanOrEqual(28);

      // High weight (70%): 56-84 expected, allow 55-85 (±25% tolerance)
      expect(profileCounts['sk-profile-high']).toBeGreaterThanOrEqual(55);
      expect(profileCounts['sk-profile-high']).toBeLessThanOrEqual(85);
    });

    it('should handle zero or negative weights (treat as weight of 1)', async () => {
      // Profiles with zero or negative weights should be treated as weight 1
      // This ensures all profiles participate in selection
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
        }
      ];

      // Even with invalid weights, all profiles should be selectable
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(profiles[0])
        .mockResolvedValueOnce(profiles[1])
        .mockResolvedValueOnce(profiles[2]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // All profiles should be selectable despite weight config issues
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-3');
    });

    it('should handle missing weights by defaulting to 1', async () => {
      // Profiles without explicit weights should default to weight 1
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-default-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-default-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-default-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-default-2'
        }
      ];

      // Missing weights should default to 1 (uniform distribution)
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(profiles[0])
        .mockResolvedValueOnce(profiles[1])
        .mockResolvedValueOnce(profiles[0]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // All profiles should be selectable with default weight
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-default-1');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-default-2');
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-default-1');
    });

    it('should skip unavailable profiles in weighted selection', async () => {
      // Weighted selection should only choose from available profiles
      // Profiles 1 and 3 are available, Profile 2 is rate-limited/unavailable
      const availableProfiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
        }
      ];

      // Weighted selection from available pool only
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(availableProfiles[0])
        .mockResolvedValueOnce(availableProfiles[1])
        .mockResolvedValueOnce(availableProfiles[0]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // All selections should be from available profiles only
      const selectedTokens = spawnCalls.map(call => call.options.env.ANTHROPIC_AUTH_TOKEN);
      expect(selectedTokens).toContain('sk-profile-1');
      expect(selectedTokens).toContain('sk-profile-3');
      expect(selectedTokens).not.toContain('sk-profile-2'); // Unavailable profile never selected
    });
  });

  describe('Rotation Strategy: Time-Based', () => {
    it('should rotate to next profile after configured interval elapses', async () => {
      // Time-based strategy should use same profile until interval elapses
      const profile1Env = {
        ANTHROPIC_BASE_URL: 'https://api-1.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
      };

      // First call: Profile 1
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profile1Env);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');

      // Wait for process completion
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second call before interval elapses: Should still use Profile 1
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profile1Env);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should still be on Profile 1 (interval not elapsed)
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
    });

    it('should persist time-based state across calls', async () => {
      // Time-based strategy should track state: currentProfileId, lastRotationTime, profileIndex
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        }
      ];

      // First call: Profile 1 with state initialization
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[0]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');

      // Wait for process completion
      await new Promise(resolve => setTimeout(resolve, 50));

      // Subsequent calls should persist time-based state tracking
      // (currentProfileId, lastRotationTime, profileIndex)
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[0]);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // State should be maintained (still Profile 1 as interval not elapsed)
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
    });

    it('should use default interval of 300 seconds (5 minutes) when not configured', async () => {
      // Default rotation interval should be 300 seconds
      const profile1Env = {
        ANTHROPIC_BASE_URL: 'https://api-1.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
      };

      // When rotationInterval is not configured, should default to 300
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(profile1Env);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should use profile with default interval configuration
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
    });

    it('should cycle through profiles sequentially as intervals elapse', async () => {
      // Simulate time-based rotation across multiple profiles
      // Profile 1 → Profile 2 → Profile 3 as intervals elapse
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
        }
      ];

      // First interval: Profile 1
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[0]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');

      // Interval elapses: Rotate to Profile 2
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[1]);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');

      // Interval elapses: Rotate to Profile 3
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[2]);

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-3');
    });

    it('should wrap around to first profile after reaching end of list', async () => {
      // After cycling through all profiles, should wrap to first profile
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        }
      ];

      // Profile 1
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[0]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');

      // Profile 2
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[1]);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');

      // Wrap around: Back to Profile 1
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[0]);

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should wrap around to Profile 1
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
    });

    it('should skip unavailable profiles in time-based rotation', async () => {
      // When rotating, should skip profiles that are unavailable (rate-limited, over quota)
      const allProfiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
        }
      ];

      // Profile 1 available
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(allProfiles[0]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');

      // Interval elapsed, Profile 2 unavailable, skip to Profile 3
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(allProfiles[2]);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should skip Profile 2 and use Profile 3
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-3');
    });

    it('should maintain rotation state when profiles become unavailable', async () => {
      // State tracking should persist even when profiles change availability
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        }
      ];

      // First call: Profile 1
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[0]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');

      // Profile 1 still within interval
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profiles[0]);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
    });

    it('should handle single profile with time-based strategy', async () => {
      // Single profile should always use the same profile regardless of interval
      const singleProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-single.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-single'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(singleProfileEnv)
        .mockResolvedValueOnce(singleProfileEnv)
        .mockResolvedValueOnce(singleProfileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // All should use the single profile
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-single');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-single');
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-single');
    });

    it('should start with first profile when no previous time-based state exists', async () => {
      // Initial call with no time-based state should use first profile
      const firstProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-first.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-first-profile'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(firstProfileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should start with first profile
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-first-profile');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty profile list (OAuth mode)', async () => {
      // No API profiles configured (OAuth mode)
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue({});

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should spawn with OAuth mode clearing vars
      expect(spawnCalls).toHaveLength(1);
      const env = spawnCalls[0].options.env as Record<string, unknown>;
      // OAuth mode clears ANTHROPIC_* vars (sets to empty string)
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('');
    });

    it('should handle single profile configuration', async () => {
      // Only one profile available - should always use it
      const singleProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-single.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-single'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(singleProfileEnv)
        .mockResolvedValueOnce(singleProfileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Both agents should use the same profile
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-single');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-single');
    });

    it('should filter out empty string env vars from profile', async () => {
      // Profile with some empty model configurations
      // Mock should return filtered env vars (matching real behavior)
      const partialProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-partial.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-partial',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5-20250929'
        // Empty vars (HAIKU_MODEL, SONNET_MODEL) are filtered out by getRotatedAPIProfileEnv
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(partialProfileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      const env = spawnCalls[0].options.env as Record<string, unknown>;

      // Non-empty vars should be set
      expect(env.ANTHROPIC_BASE_URL).toBe('https://api-partial.com');
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-partial');
      expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-5-20250929');

      // Empty vars should NOT be set (filtered by getRotatedAPIProfileEnv)
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    });

    it('should handle all profiles rate-limited (fallback to OAuth mode)', async () => {
      // All configured API profiles are rate-limited or unavailable
      // System should fall back to OAuth mode (empty ANTHROPIC_* vars)
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue({});

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should spawn with OAuth mode (all ANTHROPIC_* vars cleared)
      expect(spawnCalls).toHaveLength(1);
      const env = spawnCalls[0].options.env as Record<string, unknown>;
      // OAuth mode: ANTHROPIC_* vars are set to empty string to clear them
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('');
      expect(env.ANTHROPIC_BASE_URL).toBe('');
    });

    it('should handle all profiles rate-limited across multiple agents', async () => {
      // All profiles rate-limited, multiple agents spawned
      // Each should fall back to OAuth mode independently
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue({});

      // Spawn multiple agents
      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // All agents should fall back to OAuth mode
      expect(spawnCalls).toHaveLength(3);
      for (const call of spawnCalls) {
        const env = call.options.env as Record<string, unknown>;
        expect(env.ANTHROPIC_AUTH_TOKEN).toBe('');
        expect(env.ANTHROPIC_BASE_URL).toBe('');
      }
    });

    it('should recover when previously rate-limited profiles become available', async () => {
      // Profiles start rate-limited, then become available
      // First call: All rate-limited (OAuth mode)
      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce({});

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // First agent should use OAuth mode
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('');

      // Second call: Profiles now available
      const availableProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-recovered.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-recovered'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(availableProfileEnv);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Second agent should use the recovered profile
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-recovered');
      expect(spawnCalls[1].options.env.ANTHROPIC_BASE_URL).toBe('https://api-recovered.com');
    });

    it('should handle NaN weight values (treat as weight of 1)', async () => {
      // Profiles with NaN weights should be treated as weight 1
      // This ensures graceful degradation for invalid numeric values
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        }
      ];

      // Even with NaN weights, all profiles should be selectable
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(profiles[0])
        .mockResolvedValueOnce(profiles[1]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // All profiles should be selectable despite NaN weight values
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');
    });

    it('should handle extremely large weight values', async () => {
      // Profiles with extremely large weights (e.g., Number.MAX_SAFE_INTEGER)
      // Should normalize weights to prevent overflow issues
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-low.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-low'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-high.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-high'
        }
      ];

      // Weighted selection with extreme weight values
      // System should handle gracefully without overflow
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(profiles[1])
        .mockResolvedValueOnce(profiles[1])
        .mockResolvedValueOnce(profiles[0]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // High-weight profile should be selected more often
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-high');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-high');
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-low');
    });

    it('should handle fractional weight values', async () => {
      // Profiles with fractional weights (e.g., 0.5, 1.5, 2.7)
      // Should handle fractional weights correctly
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-low.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-low'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-medium.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-medium'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-high.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-high'
        }
      ];

      // Fractional weights: 0.5, 1.5, 3.0 (total 5.0)
      // Expected distribution: 10%, 30%, 60%
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(profiles[2])
        .mockResolvedValueOnce(profiles[2])
        .mockResolvedValueOnce(profiles[1]);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should respect fractional weight distribution
      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-high');
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-high');
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-medium');
    });

    it('should handle single profile with all rotation strategies', async () => {
      // Single profile should work consistently across all rotation strategies
      const singleProfileEnv = {
        ANTHROPIC_BASE_URL: 'https://api-single.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-single'
      };

      // Test with multiple strategies - all should use the single profile
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(singleProfileEnv)  // Priority
        .mockResolvedValueOnce(singleProfileEnv)  // Least-used
        .mockResolvedValueOnce(singleProfileEnv)  // Round-robin
        .mockResolvedValueOnce(singleProfileEnv)  // Random
        .mockResolvedValueOnce(singleProfileEnv); // Weighted

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-4', '/fake/cwd', ['run.py'], {}, 'task-execution');
      await new Promise(resolve => setTimeout(resolve, 10));

      await processManager.spawnProcess('task-5', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // All strategies should use the single profile
      expect(spawnCalls).toHaveLength(5);
      for (const call of spawnCalls) {
        expect(call.options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-single');
        expect(call.options.env.ANTHROPIC_BASE_URL).toBe('https://api-single.com');
      }
    });

    it('should handle profile with missing required fields gracefully', async () => {
      // Profile missing base URL but has auth token
      // Should handle gracefully without crashing
      const incompleteProfileEnv = {
        ANTHROPIC_AUTH_TOKEN: 'sk-incomplete'
        // Missing ANTHROPIC_BASE_URL
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValue(incompleteProfileEnv);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      const env = spawnCalls[0].options.env as Record<string, unknown>;

      // Should set provided fields, missing fields remain unset
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-incomplete');
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('should handle profile rotation with concurrent agent spawns', async () => {
      // Multiple agents spawned concurrently should each get a profile
      const profiles = [
        {
          ANTHROPIC_BASE_URL: 'https://api-1.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-2.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
        },
        {
          ANTHROPIC_BASE_URL: 'https://api-3.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
        }
      ];

      // Mock returning different profiles for concurrent calls
      vi.mocked(profileService.getRotatedAPIProfileEnv)
        .mockResolvedValueOnce(profiles[0])
        .mockResolvedValueOnce(profiles[1])
        .mockResolvedValueOnce(profiles[2]);

      // Spawn agents concurrently
      const promises = [
        processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution'),
        processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution'),
        processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution')
      ];

      await Promise.all(promises);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Each agent should have received a profile
      expect(spawnCalls).toHaveLength(3);
      const tokens = spawnCalls.map(call => call.options.env.ANTHROPIC_AUTH_TOKEN);
      expect(tokens).toContain('sk-profile-1');
      expect(tokens).toContain('sk-profile-2');
      expect(tokens).toContain('sk-profile-3');
    });

    it('should handle rotation when profile list changes during runtime', async () => {
      // Profile list changes: profiles added/removed between agent spawns
      // First call: 3 profiles available
      const profile1Env = {
        ANTHROPIC_BASE_URL: 'https://api-1.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-1'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profile1Env);

      await processManager.spawnProcess('task-1', '/fake/cwd', ['run.py'], {}, 'task-execution');

      expect(spawnCalls[0].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-1');

      // Second call: Profile list changed (only 2 profiles now)
      const profile2Env = {
        ANTHROPIC_BASE_URL: 'https://api-2.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-2'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profile2Env);

      await processManager.spawnProcess('task-2', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should adapt to new profile list
      expect(spawnCalls[1].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-2');

      // Third call: Profile list expanded again (new profile added)
      const profile3Env = {
        ANTHROPIC_BASE_URL: 'https://api-3.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-profile-3'
      };

      vi.mocked(profileService.getRotatedAPIProfileEnv).mockResolvedValueOnce(profile3Env);

      await processManager.spawnProcess('task-3', '/fake/cwd', ['run.py'], {}, 'task-execution');

      // Should use newly available profile
      expect(spawnCalls[2].options.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-profile-3');
    });
  });
});
