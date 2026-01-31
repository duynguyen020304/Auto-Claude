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
  });
});
