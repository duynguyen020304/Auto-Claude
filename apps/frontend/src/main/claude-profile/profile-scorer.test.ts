/**
 * Profile Scorer Tests
 *
 * Tests for profile scoring and rotation strategy functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Mock dependencies before importing the module
vi.mock('../platform', () => ({
  isMacOS: vi.fn(() => false),
  isWindows: vi.fn(() => false),
  isLinux: vi.fn(() => true),
}));

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: vi.fn((text) => `encrypted:${text}`),
    decryptString: vi.fn((encrypted) => encrypted.replace('encrypted:', '')),
  },
}));

// Mock profile utilities
vi.mock('./profile-utils', () => ({
  isProfileAuthenticated: vi.fn((profile: ClaudeProfile) => {
    // Consider profile authenticated if it has oauthToken
    return !!profile.oauthToken;
  }),
  hasValidToken: vi.fn(() => true),
}));

// Mock rate limit manager
vi.mock('./rate-limit-manager', () => ({
  isProfileRateLimited: vi.fn(() => ({
    limited: false,
    type: undefined,
    resetAt: undefined,
  })),
  recordRateLimitEvent: vi.fn(),
  clearRateLimitEvents: vi.fn(),
}));

// Import after mocks are set up
import {
  leastUsedStrategy,
  roundRobinStrategy,
  randomStrategy,
  weightedStrategy,
  timeBasedStrategy,
  getBestAvailableProfile,
  getProfilesSortedByAvailability,
  shouldProactivelySwitch,
} from './profile-scorer';
import type { ClaudeProfile, ClaudeAutoSwitchSettings } from '../../shared/types';

describe('profile-scorer', () => {
  let mockProfiles: ClaudeProfile[];
  let mockSettings: ClaudeAutoSwitchSettings;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock profiles with different usage levels
    mockProfiles = [
      {
        id: 'profile-1',
        name: 'Profile 1 - Low Usage',
        oauthToken: 'sk-ant-oat01-test-token-1',
        usage: {
          sessionUsagePercent: 10,
          sessionResetTime: 'in 4 hours',
          weeklyUsagePercent: 15,
          weeklyResetTime: 'in 5 days',
          lastUpdated: new Date(),
        },
        isDefault: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      },
      {
        id: 'profile-2',
        name: 'Profile 2 - Medium Usage',
        oauthToken: 'sk-ant-oat01-test-token-2',
        usage: {
          sessionUsagePercent: 45,
          sessionResetTime: 'in 3 hours',
          weeklyUsagePercent: 50,
          weeklyResetTime: 'in 4 days',
          lastUpdated: new Date(),
        },
        isDefault: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      },
      {
        id: 'profile-3',
        name: 'Profile 3 - High Usage',
        oauthToken: 'sk-ant-oat01-test-token-3',
        usage: {
          sessionUsagePercent: 80,
          sessionResetTime: 'in 2 hours',
          weeklyUsagePercent: 85,
          weeklyResetTime: 'in 3 days',
          lastUpdated: new Date(),
        },
        isDefault: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      },
    ];

    mockSettings = {
      enabled: true,
      proactiveSwapEnabled: true,
      usageCheckInterval: 30000,
      sessionThreshold: 95,
      weeklyThreshold: 99,
      autoSwitchOnRateLimit: false,
      rotationStrategy: 'least-used',
      rotationInterval: 300,
      profileWeights: {},
    };
  });

  describe('leastUsedStrategy', () => {
    it('should select profile with lowest usage score', () => {
      const selected = leastUsedStrategy(mockProfiles, mockSettings);

      // Profile 1 should be selected (score: 15*2 + 10 = 40)
      // Profile 2: score: 50*2 + 45 = 145
      // Profile 3: score: 85*2 + 80 = 250
      expect(selected).toBeDefined();
      expect(selected?.id).toBe('profile-1');
      expect(selected?.name).toBe('Profile 1 - Low Usage');
    });

    it('should exclude specified profile from selection', () => {
      const selected = leastUsedStrategy(mockProfiles, mockSettings, 'profile-1');

      // Profile 2 should be selected (profile-1 excluded)
      expect(selected).toBeDefined();
      expect(selected?.id).toBe('profile-2');
    });

    it('should return null when no profiles available', () => {
      const selected = leastUsedStrategy([], mockSettings);
      expect(selected).toBeNull();
    });

    it('should handle profiles without usage data', () => {
      const profilesWithoutUsage: ClaudeProfile[] = [
        {
          id: 'profile-no-usage',
          name: 'Profile No Usage',
          oauthToken: 'sk-ant-oat01-test-token',
          isDefault: false,
          createdAt: new Date(),
        },
      ];

      const selected = leastUsedStrategy(profilesWithoutUsage, mockSettings);
      expect(selected).toBeDefined();
      expect(selected?.id).toBe('profile-no-usage');
    });

    it('should log usage scores and selection', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Enable DEBUG mode for logging tests
      const originalDebug = process.env.DEBUG;
      process.env.DEBUG = 'true';

      leastUsedStrategy(mockProfiles, mockSettings);

      // Verify console.log was called with expected messages
      const logCalls = consoleLogSpy.mock.calls;
      const usageScoresLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('Least-used strategy: profile usage scores')
      );
      const selectedLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('Least-used strategy: selected profile')
      );

      expect(usageScoresLog).toBeDefined();
      expect(selectedLog).toBeDefined();

      // Restore original DEBUG value
      if (originalDebug !== undefined) {
        process.env.DEBUG = originalDebug;
      } else {
        delete process.env.DEBUG;
      }

      consoleLogSpy.mockRestore();
    });

    it('should include profile details in usage scores log', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Enable DEBUG mode for logging tests
      const originalDebug = process.env.DEBUG;
      process.env.DEBUG = 'true';

      leastUsedStrategy(mockProfiles, mockSettings);

      const logCalls = consoleLogSpy.mock.calls;
      const usageScoresLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('profile usage scores')
      );

      expect(usageScoresLog).toBeDefined();
      if (usageScoresLog && usageScoresLog[1]) {
        const logData = usageScoresLog[1] as { profiles: Array<{ profileId: string; profileName: string; score: number }> };
        expect(logData.profiles).toBeDefined();
        expect(logData.profiles.length).toBe(3);
        expect(logData.profiles[0].profileId).toBe('profile-1');
        expect(logData.profiles[0].score).toBe(40); // 15*2 + 10
      }

      // Restore original DEBUG value
      if (originalDebug !== undefined) {
        process.env.DEBUG = originalDebug;
      } else {
        delete process.env.DEBUG;
      }

      consoleLogSpy.mockRestore();
    });

    it('should include selection details in selected profile log', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Enable DEBUG mode for logging tests
      const originalDebug = process.env.DEBUG;
      process.env.DEBUG = 'true';

      leastUsedStrategy(mockProfiles, mockSettings);

      const logCalls = consoleLogSpy.mock.calls;
      const selectedLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('selected profile')
      );

      expect(selectedLog).toBeDefined();
      // The log data is the last argument in console.log
      // Format: console.log('[ProfileScorer] Least-used strategy: selected profile', name, '(ID:', id, ')', {data})
      const lastArg = selectedLog ? selectedLog[selectedLog.length - 1] : undefined;
      if (lastArg) {
        const logData = lastArg as { score: number; weeklyUsage: number; sessionUsage: number };
        expect(logData.score).toBe(40);
        expect(logData.weeklyUsage).toBe(15);
        expect(logData.sessionUsage).toBe(10);
      }

      // Restore original DEBUG value
      if (originalDebug !== undefined) {
        process.env.DEBUG = originalDebug;
      } else {
        delete process.env.DEBUG;
      }

      consoleLogSpy.mockRestore();
    });
  });

  describe('roundRobinStrategy', () => {
    it('should cycle through profiles sequentially', () => {
      const result1 = roundRobinStrategy(mockProfiles, mockSettings);
      expect(result1.profile).toBeDefined();

      // Use the new index for next call
      mockSettings.roundRobinLastIndex = result1.newIndex;
      const result2 = roundRobinStrategy(mockProfiles, mockSettings);
      expect(result2.profile).toBeDefined();
      expect(result2.profile?.id).not.toBe(result1.profile?.id);

      console.log('[ProfileScorer] Round-robin strategy test: cycled through profiles');
    });

    it('should return null when no profiles available', () => {
      const result = roundRobinStrategy([], mockSettings);
      expect(result.profile).toBeNull();
    });
  });

  describe('randomStrategy', () => {
    it('should select a random available profile', () => {
      const selected = randomStrategy(mockProfiles, mockSettings);
      expect(selected).toBeDefined();
      expect(mockProfiles.some(p => p.id === selected?.id)).toBe(true);
    });

    it('should return null when no profiles available', () => {
      const selected = randomStrategy([], mockSettings);
      expect(selected).toBeNull();
    });
  });

  describe('weightedStrategy', () => {
    it('should respect profile weights', () => {
      mockSettings.profileWeights = {
        'profile-1': 7,
        'profile-2': 3,
        'profile-3': 0,
      };

      // Run multiple times to verify distribution
      const selections: Record<string, number> = {};
      const iterations = 20;

      for (let i = 0; i < iterations; i++) {
        const selected = weightedStrategy(mockProfiles, mockSettings);
        if (selected) {
          selections[selected.id] = (selections[selected.id] || 0) + 1;
        }
      }

      // Profile 1 should be selected more often than profile 2
      // Profile 3 should rarely be selected (weight treated as 1)
      expect(selections['profile-1']).toBeGreaterThan(selections['profile-2']);

      console.log('[ProfileScorer] Weighted strategy test: distribution', selections);
    });
  });

  describe('getBestAvailableProfile', () => {
    it('should use priority strategy by default', () => {
      const priorityOrder = ['oauth-profile-1', 'oauth-profile-2', 'oauth-profile-3'];
      const result = getBestAvailableProfile(mockProfiles, mockSettings, undefined, priorityOrder);

      expect(result).toBeDefined();
      expect(result.profile).toBeDefined();
      expect(result.profile?.id).toBe('profile-1');
    });

    it('should use least-used strategy when configured', () => {
      mockSettings.rotationStrategy = 'least-used';
      const result = getBestAvailableProfile(mockProfiles, mockSettings);

      expect(result).toBeDefined();
      expect(result.profile).toBeDefined();
      expect(result.profile?.id).toBe('profile-1');
    });

    it('should use round-robin strategy when configured', () => {
      mockSettings.rotationStrategy = 'round-robin';
      const result = getBestAvailableProfile(mockProfiles, mockSettings);

      expect(result).toBeDefined();
      expect(result.profile).toBeDefined();
      expect(result.stateUpdates).toBeDefined();
      expect(result.stateUpdates.roundRobinLastIndex).toBeDefined();
    });
  });

  describe('getProfilesSortedByAvailability', () => {
    it('should sort profiles by availability', () => {
      const sorted = getProfilesSortedByAvailability(mockProfiles);

      // Lower usage profiles should come first
      expect(sorted[0].id).toBe('profile-1');
      expect(sorted[2].id).toBe('profile-3');
    });
  });

  describe('shouldProactivelySwitch', () => {
    it('should suggest switching when thresholds exceeded', () => {
      const highUsageProfile: ClaudeProfile = {
        ...mockProfiles[0],
        usage: {
          sessionUsagePercent: 96,
          sessionResetTime: 'in 1 hour',
          weeklyUsagePercent: 50,
          weeklyResetTime: 'in 4 days',
          lastUpdated: new Date(),
        },
      };

      const result = shouldProactivelySwitch(highUsageProfile, mockProfiles, mockSettings);

      expect(result.shouldSwitch).toBe(true);
      expect(result.suggestedProfile).toBeDefined();
    });

    it('should not suggest switching when thresholds not exceeded', () => {
      const result = shouldProactivelySwitch(mockProfiles[0], mockProfiles, mockSettings);

      expect(result.shouldSwitch).toBe(false);
    });

    it('should not suggest switching when disabled', () => {
      mockSettings.enabled = false;
      const highUsageProfile: ClaudeProfile = {
        ...mockProfiles[0],
        usage: {
          sessionUsagePercent: 96,
          sessionResetTime: 'in 1 hour',
          weeklyUsagePercent: 50,
          weeklyResetTime: 'in 4 days',
          lastUpdated: new Date(),
        },
      };

      const result = shouldProactivelySwitch(highUsageProfile, mockProfiles, mockSettings);

      expect(result.shouldSwitch).toBe(false);
    });
  });
});
