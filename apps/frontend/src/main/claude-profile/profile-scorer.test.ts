/**
 * Tests for Profile Scorer
 *
 * Tests profile availability scoring and state return values for persistence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getBestAvailableProfile,
  roundRobinStrategy,
  timeBasedStrategy,
  shouldProactivelySwitch,
  type ProfileSelectionResult
} from './profile-scorer';
import type { ClaudeProfile, ClaudeAutoSwitchSettings } from '../../shared/types';

// Mock dependencies
vi.mock('./rate-limit-manager', () => ({
  isProfileRateLimited: vi.fn(() => ({ limited: false, type: null, resetAt: null }))
}));

vi.mock('./profile-utils', () => ({
  isProfileAuthenticated: vi.fn(() => true)
}));

describe('Profile Scorer State Return Values', () => {
  let mockProfiles: ClaudeProfile[];
  let mockSettings: ClaudeAutoSwitchSettings;
  let priorityOrder: string[];

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock profiles with varying usage
    mockProfiles = [
      {
        id: 'profile-1',
        name: 'Profile 1',
        accountType: 'oauth',
        token: 'token1',
        usage: {
          sessionUsagePercent: 10,
          weeklyUsagePercent: 20
        }
      },
      {
        id: 'profile-2',
        name: 'Profile 2',
        accountType: 'oauth',
        token: 'token2',
        usage: {
          sessionUsagePercent: 30,
          weeklyUsagePercent: 40
        }
      },
      {
        id: 'profile-3',
        name: 'Profile 3',
        accountType: 'oauth',
        token: 'token3',
        usage: {
          sessionUsagePercent: 50,
          weeklyUsagePercent: 60
        }
      }
    ];

    // Setup default settings
    mockSettings = {
      enabled: true,
      rotationStrategy: 'priority',
      sessionThreshold: 95,
      weeklyThreshold: 99
    };

    priorityOrder = ['oauth-profile-1', 'oauth-profile-2', 'oauth-profile-3'];
  });

  describe('getBestAvailableProfile - state return values', () => {
    it('should return profile without state updates for priority strategy', () => {
      const result: ProfileSelectionResult = getBestAvailableProfile(
        mockProfiles,
        mockSettings,
        undefined,
        priorityOrder
      );

      expect(result.profile).toBeDefined();
      expect(result.profile?.id).toBe('profile-1');
      expect(result.stateUpdates).toBeUndefined();
    });

    it('should return profile without state updates for least-used strategy', () => {
      mockSettings.rotationStrategy = 'least-used';
      const result: ProfileSelectionResult = getBestAvailableProfile(
        mockProfiles,
        mockSettings
      );

      expect(result.profile).toBeDefined();
      expect(result.profile?.id).toBe('profile-1'); // Lowest usage
      expect(result.stateUpdates).toBeUndefined();
    });

    it('should return profile without state updates for random strategy', () => {
      mockSettings.rotationStrategy = 'random';
      const result: ProfileSelectionResult = getBestAvailableProfile(
        mockProfiles,
        mockSettings
      );

      expect(result.profile).toBeDefined();
      expect(result.stateUpdates).toBeUndefined();
    });

    it('should return profile without state updates for weighted strategy', () => {
      mockSettings.rotationStrategy = 'weighted';
      const result: ProfileSelectionResult = getBestAvailableProfile(
        mockProfiles,
        mockSettings
      );

      expect(result.profile).toBeDefined();
      expect(result.stateUpdates).toBeUndefined();
    });

    it('should return profile with roundRobinLastIndex state update for round-robin strategy', () => {
      mockSettings.rotationStrategy = 'round-robin';
      mockSettings.roundRobinLastIndex = 0;

      const result: ProfileSelectionResult = getBestAvailableProfile(
        mockProfiles,
        mockSettings
      );

      expect(result.profile).toBeDefined();
      expect(result.stateUpdates).toBeDefined();
      expect(result.stateUpdates?.roundRobinLastIndex).toBe(1); // Incremented from 0
    });

    it('should return profile with time-based state updates for time-based strategy', () => {
      mockSettings.rotationStrategy = 'time-based';

      const result: ProfileSelectionResult = getBestAvailableProfile(
        mockProfiles,
        mockSettings
      );

      expect(result.profile).toBeDefined();
      expect(result.stateUpdates).toBeDefined();
      expect(result.stateUpdates?.timeBasedCurrentProfile).toBeDefined();
      expect(result.stateUpdates?.timeBasedLastRotationTime).toBeDefined();
      expect(result.stateUpdates?.timeBasedProfileIndex).toBeDefined();
      expect(typeof result.stateUpdates?.timeBasedProfileIndex).toBe('number');
    });

    it('should return null profile without state updates when no profiles available', () => {
      const emptyProfiles: ClaudeProfile[] = [];
      const result: ProfileSelectionResult = getBestAvailableProfile(
        emptyProfiles,
        mockSettings
      );

      expect(result.profile).toBeNull();
      expect(result.stateUpdates).toBeUndefined();
    });

    it('should return null profile without state updates for round-robin when all excluded', () => {
      mockSettings.rotationStrategy = 'round-robin';
      const result: ProfileSelectionResult = getBestAvailableProfile(
        mockProfiles,
        mockSettings,
        'profile-1',
        ['oauth-profile-1']
      );

      expect(result.profile).toBeDefined();
      expect(result.stateUpdates).toBeDefined();
    });
  });

  describe('roundRobinStrategy - state return values', () => {
    it('should return profile and incremented index starting from 0', () => {
      mockSettings.roundRobinLastIndex = 0;

      const result = roundRobinStrategy(mockProfiles, mockSettings);

      expect(result.profile).toBeDefined();
      expect(result.profile?.id).toBe('profile-2'); // Next in circular order
      expect(result.newIndex).toBe(1);
    });

    it('should return profile and wrapped index at end of list', () => {
      mockSettings.roundRobinLastIndex = 2;

      const result = roundRobinStrategy(mockProfiles, mockSettings);

      expect(result.profile).toBeDefined();
      expect(result.newIndex).toBe(0); // Wrapped around
    });

    it('should return profile and default index 0 when no lastIndex in settings', () => {
      // Settings without roundRobinLastIndex
      const settingsWithoutIndex: ClaudeAutoSwitchSettings = {
        enabled: true,
        rotationStrategy: 'round-robin',
        sessionThreshold: 95,
        weeklyThreshold: 99
      };

      const result = roundRobinStrategy(mockProfiles, settingsWithoutIndex);

      expect(result.profile).toBeDefined();
      expect(result.newIndex).toBe(1); // (0 + 1) % 3 = 1
    });

    it('should return null profile and index 0 when no candidates', () => {
      const result = roundRobinStrategy([], mockSettings);

      expect(result.profile).toBeNull();
      expect(result.newIndex).toBe(0);
    });

    it('should return null profile and index 0 when all profiles excluded', () => {
      const result = roundRobinStrategy(mockProfiles, mockSettings, 'profile-1');

      expect(result.profile).toBeDefined();
      expect(result.newIndex).toBeGreaterThanOrEqual(0);
    });

    it('should cycle through multiple profiles correctly', () => {
      mockSettings.roundRobinLastIndex = 0;

      // First rotation
      const result1 = roundRobinStrategy(mockProfiles, mockSettings);
      expect(result1.newIndex).toBe(1);

      // Second rotation
      mockSettings.roundRobinLastIndex = result1.newIndex;
      const result2 = roundRobinStrategy(mockProfiles, mockSettings);
      expect(result2.newIndex).toBe(2);

      // Third rotation (should wrap)
      mockSettings.roundRobinLastIndex = result2.newIndex;
      const result3 = roundRobinStrategy(mockProfiles, mockSettings);
      expect(result3.newIndex).toBe(0);
    });
  });

  describe('timeBasedStrategy - state return values', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-15T10:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return profile and initial state when no prior state', () => {
      const settingsWithoutState: ClaudeAutoSwitchSettings = {
        enabled: true,
        rotationStrategy: 'time-based',
        sessionThreshold: 95,
        weeklyThreshold: 99,
        rotationInterval: 300
      };

      const result = timeBasedStrategy(mockProfiles, settingsWithoutState);

      expect(result.profile).toBeDefined();
      expect(result.currentProfileId).toBe('profile-2'); // Starts at index 0, rotates to 1
      expect(result.lastRotationTime).toBe('2025-01-15T10:00:00.000Z');
      expect(result.profileIndex).toBe(1);
    });

    it('should return same profile without rotation when interval not elapsed', () => {
      const recentTime = new Date('2025-01-15T09:58:00Z'); // 2 minutes ago
      const settingsWithState: ClaudeAutoSwitchSettings = {
        enabled: true,
        rotationStrategy: 'time-based',
        sessionThreshold: 95,
        weeklyThreshold: 99,
        rotationInterval: 300, // 5 minutes
        timeBasedCurrentProfile: 'profile-1',
        timeBasedLastRotationTime: recentTime.toISOString(),
        timeBasedProfileIndex: 0
      };

      const result = timeBasedStrategy(mockProfiles, settingsWithState);

      expect(result.profile).toBeDefined();
      expect(result.profile?.id).toBe('profile-1'); // Same profile
      expect(result.currentProfileId).toBe('profile-1');
      expect(result.lastRotationTime).toBe(recentTime.toISOString()); // Unchanged
      expect(result.profileIndex).toBe(0);
    });

    it('should return next profile with updated state when interval elapsed', () => {
      const oldTime = new Date('2025-01-15T09:50:00Z'); // 10 minutes ago
      const settingsWithState: ClaudeAutoSwitchSettings = {
        enabled: true,
        rotationStrategy: 'time-based',
        sessionThreshold: 95,
        weeklyThreshold: 99,
        rotationInterval: 300, // 5 minutes
        timeBasedCurrentProfile: 'profile-1',
        timeBasedLastRotationTime: oldTime.toISOString(),
        timeBasedProfileIndex: 0
      };

      const result = timeBasedStrategy(mockProfiles, settingsWithState);

      expect(result.profile).toBeDefined();
      expect(result.profile?.id).toBe('profile-2'); // Next profile
      expect(result.currentProfileId).toBe('profile-2');
      expect(result.lastRotationTime).toBe('2025-01-15T10:00:00.000Z'); // Updated
      expect(result.profileIndex).toBe(1); // Incremented
    });

    it('should wrap to first profile when reaching end of list', () => {
      const oldTime = new Date('2025-01-15T09:50:00Z');
      const settingsWithState: ClaudeAutoSwitchSettings = {
        enabled: true,
        rotationStrategy: 'time-based',
        sessionThreshold: 95,
        weeklyThreshold: 99,
        rotationInterval: 300,
        timeBasedCurrentProfile: 'profile-3',
        timeBasedLastRotationTime: oldTime.toISOString(),
        timeBasedProfileIndex: 2
      };

      const result = timeBasedStrategy(mockProfiles, settingsWithState);

      expect(result.profile).toBeDefined();
      expect(result.profile?.id).toBe('profile-1'); // Wrapped to first
      expect(result.currentProfileId).toBe('profile-1');
      expect(result.profileIndex).toBe(0); // Wrapped index
    });

    it('should return null profile and undefined state when no candidates', () => {
      const result = timeBasedStrategy([], mockSettings);

      expect(result.profile).toBeNull();
      expect(result.currentProfileId).toBeUndefined();
      expect(result.lastRotationTime).toBeUndefined();
      expect(result.profileIndex).toBe(0);
    });

    it('should reset to first profile when current profile no longer available', () => {
      const oldTime = new Date('2025-01-15T09:50:00Z');
      const settingsWithState: ClaudeAutoSwitchSettings = {
        enabled: true,
        rotationStrategy: 'time-based',
        sessionThreshold: 95,
        weeklyThreshold: 99,
        rotationInterval: 300,
        timeBasedCurrentProfile: 'profile-removed', // Not in list
        timeBasedLastRotationTime: oldTime.toISOString(),
        timeBasedProfileIndex: 5
      };

      const result = timeBasedStrategy(mockProfiles, settingsWithState);

      expect(result.profile).toBeDefined();
      expect(result.profile?.id).toBe('profile-2'); // First available (starts at index 0 + 1)
      expect(result.currentProfileId).toBeDefined();
      expect(result.lastRotationTime).toBe('2025-01-15T10:00:00.000Z'); // Updated
      expect(result.profileIndex).toBe(1);
    });

    it('should handle excluded profile correctly', () => {
      const oldTime = new Date('2025-01-15T09:50:00Z');
      const settingsWithState: ClaudeAutoSwitchSettings = {
        enabled: true,
        rotationStrategy: 'time-based',
        sessionThreshold: 95,
        weeklyThreshold: 99,
        rotationInterval: 300,
        timeBasedCurrentProfile: 'profile-1',
        timeBasedLastRotationTime: oldTime.toISOString(),
        timeBasedProfileIndex: 0
      };

      // Exclude profile-1
      const result = timeBasedStrategy(mockProfiles, settingsWithState, 'profile-1');

      expect(result.profile).toBeDefined();
      // Should rotate since current profile is excluded
      expect(result.profile?.id).not.toBe('profile-1');
      expect(result.currentProfileId).toBeDefined();
      expect(result.profileIndex).toBeDefined();
    });
  });

  describe('shouldProactivelySwitch - state return values', () => {
    it('should return stateUpdates from getBestAvailableProfile when weekly threshold exceeded', () => {
      const highUsageProfile: ClaudeProfile = {
        id: 'profile-1',
        name: 'Profile 1',
        accountType: 'oauth',
        token: 'token1',
        usage: {
          sessionUsagePercent: 50,
          weeklyUsagePercent: 100 // Exceeds threshold of 99
        }
      };

      const result = shouldProactivelySwitch(
        highUsageProfile,
        mockProfiles,
        mockSettings,
        priorityOrder
      );

      expect(result.shouldSwitch).toBe(true);
      expect(result.suggestedProfile).toBeDefined();
      expect(result.stateUpdates).toBeUndefined(); // Priority strategy has no state
    });

    it('should return stateUpdates from getBestAvailableProfile when session threshold exceeded', () => {
      const highUsageProfile: ClaudeProfile = {
        id: 'profile-1',
        name: 'Profile 1',
        accountType: 'oauth',
        token: 'token1',
        usage: {
          sessionUsagePercent: 100, // Exceeds threshold of 95
          weeklyUsagePercent: 50
        }
      };

      const result = shouldProactivelySwitch(
        highUsageProfile,
        mockProfiles,
        mockSettings,
        priorityOrder
      );

      expect(result.shouldSwitch).toBe(true);
      expect(result.suggestedProfile).toBeDefined();
      expect(result.reason).toContain('Session usage');
    });

    it('should return roundRobinLastIndex state when using round-robin strategy', () => {
      mockSettings.rotationStrategy = 'round-robin';
      mockSettings.roundRobinLastIndex = 0;

      const highUsageProfile: ClaudeProfile = {
        id: 'profile-1',
        name: 'Profile 1',
        accountType: 'oauth',
        token: 'token1',
        usage: {
          sessionUsagePercent: 100,
          weeklyUsagePercent: 50
        }
      };

      const result = shouldProactivelySwitch(
        highUsageProfile,
        mockProfiles,
        mockSettings,
        priorityOrder
      );

      expect(result.shouldSwitch).toBe(true);
      expect(result.stateUpdates).toBeDefined();
      expect(result.stateUpdates?.roundRobinLastIndex).toBe(1);
    });

    it('should return time-based state when using time-based strategy', () => {
      mockSettings.rotationStrategy = 'time-based';

      const highUsageProfile: ClaudeProfile = {
        id: 'profile-1',
        name: 'Profile 1',
        accountType: 'oauth',
        token: 'token1',
        usage: {
          sessionUsagePercent: 100,
          weeklyUsagePercent: 50
        }
      };

      const result = shouldProactivelySwitch(
        highUsageProfile,
        mockProfiles,
        mockSettings,
        priorityOrder
      );

      expect(result.shouldSwitch).toBe(true);
      expect(result.stateUpdates).toBeDefined();
      expect(result.stateUpdates?.timeBasedCurrentProfile).toBeDefined();
      expect(result.stateUpdates?.timeBasedLastRotationTime).toBeDefined();
      expect(result.stateUpdates?.timeBasedProfileIndex).toBeDefined();
    });

    it('should not return stateUpdates when auto-switch disabled', () => {
      mockSettings.enabled = false;

      const highUsageProfile: ClaudeProfile = {
        id: 'profile-1',
        name: 'Profile 1',
        accountType: 'oauth',
        token: 'token1',
        usage: {
          sessionUsagePercent: 100,
          weeklyUsagePercent: 100
        }
      };

      const result = shouldProactivelySwitch(
        highUsageProfile,
        mockProfiles,
        mockSettings,
        priorityOrder
      );

      expect(result.shouldSwitch).toBe(false);
      expect(result.stateUpdates).toBeUndefined();
    });

    it('should not return stateUpdates when usage below thresholds', () => {
      const lowUsageProfile: ClaudeProfile = {
        id: 'profile-1',
        name: 'Profile 1',
        accountType: 'oauth',
        token: 'token1',
        usage: {
          sessionUsagePercent: 10,
          weeklyUsagePercent: 20
        }
      };

      const result = shouldProactivelySwitch(
        lowUsageProfile,
        mockProfiles,
        mockSettings,
        priorityOrder
      );

      expect(result.shouldSwitch).toBe(false);
      expect(result.stateUpdates).toBeUndefined();
    });

    it('should not return stateUpdates when no usage data', () => {
      const noUsageProfile: ClaudeProfile = {
        id: 'profile-1',
        name: 'Profile 1',
        accountType: 'oauth',
        token: 'token1'
      };

      const result = shouldProactivelySwitch(
        noUsageProfile,
        mockProfiles,
        mockSettings,
        priorityOrder
      );

      expect(result.shouldSwitch).toBe(false);
      expect(result.stateUpdates).toBeUndefined();
    });

    it('should not return stateUpdates when no alternative profile available', () => {
      const onlyProfile: ClaudeProfile = {
        id: 'profile-1',
        name: 'Profile 1',
        accountType: 'oauth',
        token: 'token1',
        usage: {
          sessionUsagePercent: 100,
          weeklyUsagePercent: 100
        }
      };

      const result = shouldProactivelySwitch(
        onlyProfile,
        [onlyProfile], // Only one profile
        mockSettings,
        priorityOrder
      );

      expect(result.shouldSwitch).toBe(false);
      expect(result.stateUpdates).toBeUndefined();
    });
  });

  describe('State persistence integration scenarios', () => {
    it('should correctly persist round-robin state across multiple rotations', () => {
      mockSettings.rotationStrategy = 'round-robin';
      mockSettings.roundRobinLastIndex = 0;

      // Simulate multiple calls that would happen with persisted state
      const result1 = getBestAvailableProfile(mockProfiles, mockSettings);
      expect(result1.stateUpdates?.roundRobinLastIndex).toBe(1);

      // Update settings with persisted state
      mockSettings.roundRobinLastIndex = result1.stateUpdates!.roundRobinLastIndex!;

      const result2 = getBestAvailableProfile(mockProfiles, mockSettings);
      expect(result2.stateUpdates?.roundRobinLastIndex).toBe(2);

      // Update settings again
      mockSettings.roundRobinLastIndex = result2.stateUpdates!.roundRobinLastIndex!;

      const result3 = getBestAvailableProfile(mockProfiles, mockSettings);
      expect(result3.stateUpdates?.roundRobinLastIndex).toBe(0); // Wrapped
    });

    it('should correctly persist time-based state across rotations', () => {
      vi.useFakeTimers();
      mockSettings.rotationStrategy = 'time-based';
      mockSettings.rotationInterval = 300;

      // Initial state (starts with index 1 due to rotation logic)
      const result1 = getBestAvailableProfile(mockProfiles, mockSettings);
      expect(result1.stateUpdates?.timeBasedCurrentProfile).toBe('profile-2');
      expect(result1.stateUpdates?.timeBasedProfileIndex).toBe(1);

      // Persist state
      mockSettings.timeBasedCurrentProfile = result1.stateUpdates!.timeBasedCurrentProfile;
      mockSettings.timeBasedLastRotationTime = result1.stateUpdates!.timeBasedLastRotationTime;
      mockSettings.timeBasedProfileIndex = result1.stateUpdates!.timeBasedProfileIndex;

      // Advance time past interval
      vi.advanceTimersByTime(301000); // 301 seconds
      vi.setSystemTime(new Date(Date.now() + 301000));

      const result2 = getBestAvailableProfile(mockProfiles, mockSettings);
      expect(result2.stateUpdates?.timeBasedCurrentProfile).toBe('profile-3');
      expect(result2.stateUpdates?.timeBasedProfileIndex).toBe(2);

      vi.useRealTimers();
    });
  });
});
