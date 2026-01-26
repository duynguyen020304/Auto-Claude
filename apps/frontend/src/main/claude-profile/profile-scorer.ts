/**
 * Profile Scorer Module
 * Handles profile availability scoring and auto-switch logic
 *
 * Priority-Based Selection (v2):
 * 1. User's configured priority order is the PRIMARY factor
 * 2. Accounts are filtered by availability criteria:
 *    - Must be authenticated
 *    - Must not be rate-limited (explicit 429 error)
 *    - Must be below user's configured thresholds (default: 95% session, 99% weekly)
 * 3. First profile in priority order that passes all filters is selected
 * 4. If no profile passes all filters, falls back to "least bad" option
 */

import type { ClaudeProfile, ClaudeAutoSwitchSettings } from '../../shared/types';
import { isProfileRateLimited } from './rate-limit-manager';
import { isProfileAuthenticated } from './profile-utils';

const isDebug = process.env.DEBUG === 'true';

interface ScoredProfile {
  profile: ClaudeProfile;
  score: number;
  priorityIndex: number;
  isAvailable: boolean;
  unavailableReason?: string;
}

/**
 * Check if a profile is available for use based on all criteria
 */
function checkProfileAvailability(
  profile: ClaudeProfile,
  settings: ClaudeAutoSwitchSettings
): { available: boolean; reason?: string } {
  // Check authentication
  if (!isProfileAuthenticated(profile)) {
    return { available: false, reason: 'not authenticated' };
  }

  // Check explicit rate limit (from 429 errors)
  const rateLimitStatus = isProfileRateLimited(profile);
  if (rateLimitStatus.limited) {
    return {
      available: false,
      reason: `rate limited (${rateLimitStatus.type}, resets ${rateLimitStatus.resetAt?.toISOString() || 'unknown'})`
    };
  }

  // Check usage thresholds
  if (profile.usage) {
    // Weekly threshold check (more important - longer reset time)
    // Using >= to reject profiles AT or ABOVE threshold (e.g., 95% is rejected when threshold is 95%)
    // This is intentional: we want to switch proactively BEFORE hitting hard limits
    if (profile.usage.weeklyUsagePercent >= settings.weeklyThreshold) {
      return {
        available: false,
        reason: `weekly usage ${profile.usage.weeklyUsagePercent}% >= threshold ${settings.weeklyThreshold}%`
      };
    }

    // Session threshold check
    // Using >= to reject profiles AT or ABOVE threshold (same rationale as weekly)
    if (profile.usage.sessionUsagePercent >= settings.sessionThreshold) {
      return {
        available: false,
        reason: `session usage ${profile.usage.sessionUsagePercent}% >= threshold ${settings.sessionThreshold}%`
      };
    }
  }

  return { available: true };
}

/**
 * Calculate a fallback score for when no profiles meet all criteria
 * Used to pick the "least bad" option
 */
function calculateFallbackScore(
  profile: ClaudeProfile,
  settings: ClaudeAutoSwitchSettings
): number {
  let score = 100;
  const now = new Date();

  // Authentication is critical
  if (!isProfileAuthenticated(profile)) {
    score -= 1000; // Unauthenticated is basically unusable
  }

  // Rate limit status
  const rateLimitStatus = isProfileRateLimited(profile);
  if (rateLimitStatus.limited) {
    if (rateLimitStatus.type === 'weekly') {
      score -= 500; // Weekly limit is worse (longer reset)
    } else {
      score -= 200; // Session limit resets sooner
    }

    // Bonus for profiles that reset sooner
    if (rateLimitStatus.resetAt) {
      const hoursUntilReset = (rateLimitStatus.resetAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      score += Math.max(0, 50 - hoursUntilReset);
    }
  }

  // Usage penalties (prefer lower usage)
  if (profile.usage) {
    // Penalize based on how far over threshold
    const weeklyOverage = Math.max(0, profile.usage.weeklyUsagePercent - settings.weeklyThreshold);
    const sessionOverage = Math.max(0, profile.usage.sessionUsagePercent - settings.sessionThreshold);

    score -= weeklyOverage * 2; // Weekly overage is worse
    score -= sessionOverage;

    // Also factor in absolute usage (lower is better)
    score -= profile.usage.weeklyUsagePercent * 0.3;
    score -= profile.usage.sessionUsagePercent * 0.1;
  }

  return score;
}

/**
 * Get the best profile to switch to based on priority order and availability
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Check each profile's availability (auth, rate limit, thresholds)
 * 3. Sort by user's priority order
 * 4. Return the first available profile in priority order
 * 5. If none available, return the "least bad" option based on fallback scoring
 *
 * @param profiles - All Claude profiles
 * @param settings - Auto-switch settings (contains thresholds)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @param priorityOrder - User's configured priority order (array of unified IDs like 'oauth-{id}')
 */
export function getBestAvailableProfile(
  profiles: ClaudeProfile[],
  settings: ClaudeAutoSwitchSettings,
  excludeProfileId?: string,
  priorityOrder: string[] = []
): ClaudeProfile | null {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Evaluating', candidates.length, 'candidate profiles (excluding:', excludeProfileId, ')');
    console.warn('[ProfileScorer] Priority order:', priorityOrder);
    console.warn('[ProfileScorer] Thresholds: session =', settings.sessionThreshold, '%, weekly =', settings.weeklyThreshold, '%');
  }

  // Score and check availability for each profile
  const scoredProfiles: ScoredProfile[] = candidates.map(profile => {
    const unifiedId = `oauth-${profile.id}`;
    const priorityIndex = priorityOrder.indexOf(unifiedId);
    const availability = checkProfileAvailability(profile, settings);
    const fallbackScore = calculateFallbackScore(profile, settings);

    if (isDebug) {
      console.warn('[ProfileScorer] Scoring profile:', profile.name, '(', profile.id, ')');
      console.warn('[ProfileScorer]   Priority index:', priorityIndex === -1 ? 'not in list (Infinity)' : priorityIndex);
      console.warn('[ProfileScorer]   Available:', availability.available, availability.reason ? `(${availability.reason})` : '');
      console.warn('[ProfileScorer]   Usage:', profile.usage ? `session=${profile.usage.sessionUsagePercent}%, weekly=${profile.usage.weeklyUsagePercent}%` : 'unknown');
      console.warn('[ProfileScorer]   Fallback score:', fallbackScore);
    }

    return {
      profile,
      score: fallbackScore,
      priorityIndex: priorityIndex === -1 ? Infinity : priorityIndex,
      isAvailable: availability.available,
      unavailableReason: availability.reason
    };
  });

  // Sort by:
  // 1. Available profiles first
  // 2. Within available: by priority index (lower = higher priority)
  // 3. Within unavailable: by fallback score (higher = better)
  scoredProfiles.sort((a, b) => {
    // Available profiles always come first
    if (a.isAvailable !== b.isAvailable) {
      return a.isAvailable ? -1 : 1;
    }

    // For available profiles, sort by priority order
    if (a.isAvailable && b.isAvailable) {
      // If both have priority indices, use them
      if (a.priorityIndex !== b.priorityIndex) {
        return a.priorityIndex - b.priorityIndex;
      }
      // Tiebreaker: prefer lower usage
      return b.score - a.score;
    }

    // For unavailable profiles, sort by fallback score (for "least bad" selection)
    return b.score - a.score;
  });

  const best = scoredProfiles[0];

  if (best.isAvailable) {
    console.warn('[ProfileScorer] Best available profile:', best.profile.name, '(priority index:', best.priorityIndex, ')');
    return best.profile;
  }

  // No profile meets all criteria - check if we should return the least bad option
  // Only return if it has a positive score (meaning it might still work)
  if (best.score > 0) {
    console.warn('[ProfileScorer] No ideal profile available, using least-bad option:', best.profile.name,
      '(score:', best.score, ', reason:', best.unavailableReason, ')');
    return best.profile;
  }

  // All profiles are truly unusable
  console.warn('[ProfileScorer] No usable profile available, all have issues');
  return null;
}

/**
 * Determine if we should proactively switch profiles based on current usage
 */
export function shouldProactivelySwitch(
  profile: ClaudeProfile,
  allProfiles: ClaudeProfile[],
  settings: ClaudeAutoSwitchSettings,
  priorityOrder: string[] = []
): { shouldSwitch: boolean; reason?: string; suggestedProfile?: ClaudeProfile } {
  if (!settings.enabled) {
    return { shouldSwitch: false };
  }

  if (!profile?.usage) {
    return { shouldSwitch: false };
  }

  const usage = profile.usage;

  // Check if we're approaching limits
  if (usage.weeklyUsagePercent >= settings.weeklyThreshold) {
    const bestProfile = getBestAvailableProfile(allProfiles, settings, profile.id, priorityOrder);
    if (bestProfile) {
      return {
        shouldSwitch: true,
        reason: `Weekly usage at ${usage.weeklyUsagePercent}% (threshold: ${settings.weeklyThreshold}%)`,
        suggestedProfile: bestProfile
      };
    }
  }

  if (usage.sessionUsagePercent >= settings.sessionThreshold) {
    const bestProfile = getBestAvailableProfile(allProfiles, settings, profile.id, priorityOrder);
    if (bestProfile) {
      return {
        shouldSwitch: true,
        reason: `Session usage at ${usage.sessionUsagePercent}% (threshold: ${settings.sessionThreshold}%)`,
        suggestedProfile: bestProfile
      };
    }
  }

  return { shouldSwitch: false };
}

/**
 * Round-robin strategy - cycle through profiles sequentially
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Filter to available profiles only
 * 3. Get last used index from settings (default: 0)
 * 4. Move to next index in circular fashion
 * 5. Return profile at next index and the new index for state tracking
 *
 * @param profiles - All Claude profiles
 * @param settings - Auto-switch settings (contains roundRobinLastIndex)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Object with selected profile and new index, or null if no available profiles
 */
export function roundRobinStrategy(
  profiles: ClaudeProfile[],
  settings: ClaudeAutoSwitchSettings,
  excludeProfileId?: string
): { profile: ClaudeProfile | null; newIndex: number } {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return { profile: null, newIndex: 0 };
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Round-robin strategy: evaluating', candidates.length, 'candidate profiles');
  }

  // Filter to available profiles only
  const availableProfiles: ClaudeProfile[] = [];
  const availabilityChecks: Array<{ profile: ClaudeProfile; available: boolean; reason?: string }> = [];

  for (const profile of candidates) {
    const availability = checkProfileAvailability(profile, settings);
    availabilityChecks.push({ profile, available: availability.available, reason: availability.reason });

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebug) {
      console.warn('[ProfileScorer] Round-robin: profile', profile.name, 'available:', availability.available, availability.reason ? `(${availability.reason})` : '');
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] Round-robin: no available profiles');
    return { profile: null, newIndex: 0 };
  }

  // Get last used index from settings (default to 0)
  const lastIndex = settings.roundRobinLastIndex ?? 0;

  // Calculate next index (circular)
  const nextIndex = (lastIndex + 1) % availableProfiles.length;

  if (isDebug) {
    console.warn('[ProfileScorer] Round-robin: last index =', lastIndex, ', next index =', nextIndex, 'of', availableProfiles.length, 'available profiles');
  }

  const selectedProfile = availableProfiles[nextIndex];

  if (isDebug) {
    console.warn('[ProfileScorer] Round-robin: selected profile', selectedProfile.name, 'at index', nextIndex);
  }

  return { profile: selectedProfile, newIndex: nextIndex };
}

/**
 * Least-used strategy - select profile with lowest combined usage
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Filter to available profiles only
 * 3. Calculate combined usage score (tokens + requests)
 * 4. Sort by usage score (ascending - lowest usage first)
 * 5. Return profile with minimum usage
 *
 * Usage Metrics:
 * - Weekly usage is weighted more heavily (longer reset time)
 * - Session usage is secondary factor
 * - Missing usage data treated as 0 (prefer unused profiles)
 *
 * @param profiles - All Claude profiles
 * @param settings - Auto-switch settings (contains thresholds)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Profile with lowest usage, or null if no available profiles
 */
export function leastUsedStrategy(
  profiles: ClaudeProfile[],
  settings: ClaudeAutoSwitchSettings,
  excludeProfileId?: string
): ClaudeProfile | null {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Least-used strategy: evaluating', candidates.length, 'candidate profiles');
  }

  // Filter to available profiles only
  const availableProfiles: ClaudeProfile[] = [];
  const availabilityChecks: Array<{ profile: ClaudeProfile; available: boolean; reason?: string }> = [];

  for (const profile of candidates) {
    const availability = checkProfileAvailability(profile, settings);
    availabilityChecks.push({ profile, available: availability.available, reason: availability.reason });

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebug) {
      console.warn('[ProfileScorer] Least-used: profile', profile.name, 'available:', availability.available, availability.reason ? `(${availability.reason})` : '');
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] Least-used: no available profiles');
    return null;
  }

  // Calculate usage score for each profile
  interface ProfileUsageScore {
    profile: ClaudeProfile;
    score: number;
    weeklyUsage: number;
    sessionUsage: number;
  }

  const scoredProfiles: ProfileUsageScore[] = availableProfiles.map(profile => {
    // Missing usage data treated as 0 (prefer unused profiles)
    const weeklyUsage = profile.usage?.weeklyUsagePercent ?? 0;
    const sessionUsage = profile.usage?.sessionUsagePercent ?? 0;

    // Weekly usage weighted more heavily (2x) since it has longer reset time
    const score = (weeklyUsage * 2) + sessionUsage;

    if (isDebug) {
      console.warn('[ProfileScorer] Least-used: profile', profile.name, 'score:', score, '(weekly:', weeklyUsage, '%, session:', sessionUsage, '%)');
    }

    return {
      profile,
      score,
      weeklyUsage,
      sessionUsage
    };
  });

  // Sort by score ascending (lowest usage first)
  scoredProfiles.sort((a, b) => a.score - b.score);

  const selectedProfile = scoredProfiles[0].profile;

  if (isDebug) {
    console.warn('[ProfileScorer] Least-used: selected profile', selectedProfile.name,
      '(score:', scoredProfiles[0].score, ', weekly:', scoredProfiles[0].weeklyUsage, '%, session:', scoredProfiles[0].sessionUsage, '%)');
  }

  return selectedProfile;
}

/**
 * Random strategy - select a random available profile
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Filter to available profiles only
 * 3. Randomly select one profile from available profiles
 * 4. Return the randomly selected profile
 *
 * This strategy provides unpredictability which can help:
 * - Distribute load evenly across accounts
 * - Avoid detection patterns from predictable switching
 * - Ensure all accounts get similar usage over time
 *
 * @param profiles - All Claude profiles
 * @param settings - Auto-switch settings (contains thresholds)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Randomly selected profile, or null if no available profiles
 */
export function randomStrategy(
  profiles: ClaudeProfile[],
  settings: ClaudeAutoSwitchSettings,
  excludeProfileId?: string
): ClaudeProfile | null {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Random strategy: evaluating', candidates.length, 'candidate profiles');
  }

  // Filter to available profiles only
  const availableProfiles: ClaudeProfile[] = [];
  const availabilityChecks: Array<{ profile: ClaudeProfile; available: boolean; reason?: string }> = [];

  for (const profile of candidates) {
    const availability = checkProfileAvailability(profile, settings);
    availabilityChecks.push({ profile, available: availability.available, reason: availability.reason });

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebug) {
      console.warn('[ProfileScorer] Random: profile', profile.name, 'available:', availability.available, availability.reason ? `(${availability.reason})` : '');
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] Random: no available profiles');
    return null;
  }

  // Randomly select one profile
  const randomIndex = Math.floor(Math.random() * availableProfiles.length);
  const selectedProfile = availableProfiles[randomIndex];

  if (isDebug) {
    console.warn('[ProfileScorer] Random: selected profile', selectedProfile.name, 'at random index', randomIndex, 'of', availableProfiles.length, 'available profiles');
  }

  return selectedProfile;
}

/**
 * Weighted distribution strategy - select profile based on configured weights
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Filter to available profiles only
 * 3. Get configured weights from settings (profileWeights: Record<string, number>)
 * 4. For each available profile, get its weight (default: 1 if not specified)
 * 5. Perform weighted random selection based on weights
 * 6. Return selected profile based on weight distribution
 *
 * Weight Distribution:
 * - Higher weight = more frequent selection
 * - Weights are relative (e.g., Profile A: 7, Profile B: 3 means A is selected 70% of time)
 * - Missing weights default to 1 (uniform distribution)
 * - Zero or negative weights treated as 1
 *
 * @param profiles - All Claude profiles
 * @param settings - Auto-switch settings (contains profileWeights)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Profile selected based on weighted distribution, or null if no available profiles
 */
export function weightedStrategy(
  profiles: ClaudeProfile[],
  settings: ClaudeAutoSwitchSettings,
  excludeProfileId?: string
): ClaudeProfile | null {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Weighted strategy: evaluating', candidates.length, 'candidate profiles');
  }

  // Filter to available profiles only
  const availableProfiles: ClaudeProfile[] = [];
  const availabilityChecks: Array<{ profile: ClaudeProfile; available: boolean; reason?: string }> = [];

  for (const profile of candidates) {
    const availability = checkProfileAvailability(profile, settings);
    availabilityChecks.push({ profile, available: availability.available, reason: availability.reason });

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebug) {
      console.warn('[ProfileScorer] Weighted: profile', profile.name, 'available:', availability.available, availability.reason ? `(${availability.reason})` : '');
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] Weighted: no available profiles');
    return null;
  }

  // Get weights from settings
  const configuredWeights = settings.profileWeights ?? {};

  // Build weighted list
  interface WeightedProfile {
    profile: ClaudeProfile;
    weight: number;
    cumulativeWeight: number;
  }

  const weightedProfiles: WeightedProfile[] = [];
  let totalWeight = 0;

  for (const profile of availableProfiles) {
    // Get weight for this profile (default: 1, treat zero/negative as 1)
    const rawWeight = configuredWeights[profile.id];
    const weight = (rawWeight != null && rawWeight > 0) ? rawWeight : 1;

    totalWeight += weight;

    weightedProfiles.push({
      profile,
      weight,
      cumulativeWeight: totalWeight
    });

    if (isDebug) {
      console.warn('[ProfileScorer] Weighted: profile', profile.name, 'weight:', weight, '(cumulative:', totalWeight, ')');
    }
  }

  // Weighted random selection
  const randomValue = Math.random() * totalWeight;

  if (isDebug) {
    console.warn('[ProfileScorer] Weighted: random value =', randomValue, 'of total weight', totalWeight);
  }

  // Find the profile where cumulativeWeight >= randomValue
  const selectedProfile = weightedProfiles.find(wp => wp.cumulativeWeight >= randomValue)?.profile ?? null;

  if (selectedProfile && isDebug) {
    console.warn('[ProfileScorer] Weighted: selected profile', selectedProfile.name);
  }

  return selectedProfile;
}

/**
 * Time-based strategy - rotate profiles at configured time intervals
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Filter to available profiles only
 * 3. Get current profile and last rotation time from settings
 * 4. Check if rotation interval has elapsed (settings.rotationInterval in seconds)
 * 5. If interval elapsed: rotate to next profile in circular fashion, update state
 * 6. If interval not elapsed: continue using current profile
 * 7. Return the selected profile and updated state tracking
 *
 * State Tracking (stored in settings):
 * - timeBasedCurrentProfile: ID of profile currently being used
 * - timeBasedLastRotationTime: ISO timestamp of last rotation
 * - timeBasedProfileIndex: Index of current profile in available profiles list
 *
 * Rotation Behavior:
 * - Uses rotationInterval from settings (default: 300 seconds = 5 minutes)
 * - Rotates sequentially through available profiles (similar to round-robin)
 * - Resets to first profile if current profile becomes unavailable
 * - Updates state tracking on each rotation
 *
 * @param profiles - All Claude profiles
 * @param settings - Auto-switch settings (contains rotationInterval and state tracking fields)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Object with selected profile and updated state tracking, or null if no available profiles
 */
export function timeBasedStrategy(
  profiles: ClaudeProfile[],
  settings: ClaudeAutoSwitchSettings,
  excludeProfileId?: string
): {
  profile: ClaudeProfile | null;
  currentProfileId?: string;
  lastRotationTime?: string;
  profileIndex?: number;
} {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return { profile: null, currentProfileId: undefined, lastRotationTime: undefined, profileIndex: 0 };
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Time-based strategy: evaluating', candidates.length, 'candidate profiles');
  }

  // Filter to available profiles only
  const availableProfiles: ClaudeProfile[] = [];
  const availabilityChecks: Array<{ profile: ClaudeProfile; available: boolean; reason?: string }> = [];

  for (const profile of candidates) {
    const availability = checkProfileAvailability(profile, settings);
    availabilityChecks.push({ profile, available: availability.available, reason: availability.reason });

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebug) {
      console.warn('[ProfileScorer] Time-based: profile', profile.name, 'available:', availability.available, availability.reason ? `(${availability.reason})` : '');
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] Time-based: no available profiles');
    return { profile: null, currentProfileId: undefined, lastRotationTime: undefined, profileIndex: 0 };
  }

  const now = new Date();
  const rotationIntervalSeconds = settings.rotationInterval ?? 300; // Default: 5 minutes
  const rotationIntervalMs = rotationIntervalSeconds * 1000;

  // Get state tracking from settings
  const currentProfileId = settings.timeBasedCurrentProfile;
  const lastRotationTimeStr = settings.timeBasedLastRotationTime;
  let currentIndex = settings.timeBasedProfileIndex ?? 0;

  // Initialize with first available profile as default
  let selectedProfile: ClaudeProfile = availableProfiles[0];
  let shouldRotate = false;
  let newProfileIndex = currentIndex;
  let newCurrentProfileId = currentProfileId;
  let newLastRotationTime = lastRotationTimeStr;

  if (isDebug) {
    console.warn('[ProfileScorer] Time-based: rotation interval =', rotationIntervalSeconds, 'seconds (', rotationIntervalMs, 'ms)');
    console.warn('[ProfileScorer] Time-based: current profile ID =', currentProfileId, ', index =', currentIndex);
    console.warn('[ProfileScorer] Time-based: last rotation time =', lastRotationTimeStr);
  }

  // Check if we have a current profile and it's still available
  if (currentProfileId && lastRotationTimeStr) {
    const lastRotationTime = new Date(lastRotationTimeStr);
    const elapsedMs = now.getTime() - lastRotationTime.getTime();

    // Find the current profile in available profiles
    const currentProfile = availableProfiles.find(p => p.id === currentProfileId);

    if (currentProfile && elapsedMs < rotationIntervalMs) {
      // Interval not elapsed, continue using current profile
      selectedProfile = currentProfile;
      shouldRotate = false;

      if (isDebug) {
        console.warn('[ProfileScorer] Time-based: interval not elapsed (', elapsedMs, 'ms < ', rotationIntervalMs, 'ms), continuing with current profile:', currentProfile.name);
      }
    } else if (currentProfile && elapsedMs >= rotationIntervalMs) {
      // Interval elapsed, rotate to next profile
      shouldRotate = true;

      if (isDebug) {
        console.warn('[ProfileScorer] Time-based: interval elapsed (', elapsedMs, 'ms >= ', rotationIntervalMs, 'ms), rotating to next profile');
      }
    } else {
      // Current profile no longer available, reset to first profile
      shouldRotate = true;
      currentIndex = 0; // Reset index
      newProfileIndex = 0;

      if (isDebug) {
        console.warn('[ProfileScorer] Time-based: current profile no longer available, resetting to first available profile');
      }
    }
  } else {
    // No state tracking, start with first profile
    shouldRotate = true;
    currentIndex = 0;
    newProfileIndex = 0;

    if (isDebug) {
      console.warn('[ProfileScorer] Time-based: no state tracking, starting with first available profile');
    }
  }

  if (shouldRotate) {
    // Calculate next index (circular)
    newProfileIndex = (currentIndex + 1) % availableProfiles.length;
    selectedProfile = availableProfiles[newProfileIndex];
    newCurrentProfileId = selectedProfile.id;
    newLastRotationTime = now.toISOString();

    if (isDebug) {
      console.warn('[ProfileScorer] Time-based: rotated to profile', selectedProfile.name, 'at index', newProfileIndex, 'of', availableProfiles.length);
    }
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Time-based: selected profile', selectedProfile.name,
      '(state: profileId =', newCurrentProfileId, ', index =', newProfileIndex, ', lastRotation =', newLastRotationTime, ')');
  }

  return {
    profile: selectedProfile,
    currentProfileId: newCurrentProfileId,
    lastRotationTime: newLastRotationTime,
    profileIndex: newProfileIndex
  };
}

/**
 * Get profiles sorted by availability (best first)
 * This is a simpler sort that doesn't consider priority order - used for display purposes
 */
export function getProfilesSortedByAvailability(profiles: ClaudeProfile[]): ClaudeProfile[] {
  return [...profiles].sort((a, b) => {
    // Authenticated profiles first
    const aAuth = isProfileAuthenticated(a);
    const bAuth = isProfileAuthenticated(b);
    if (aAuth !== bAuth) {
      return aAuth ? -1 : 1;
    }

    // Not rate-limited profiles first
    const aLimited = isProfileRateLimited(a);
    const bLimited = isProfileRateLimited(b);

    if (aLimited.limited !== bLimited.limited) {
      return aLimited.limited ? 1 : -1;
    }

    // If both limited, sort by reset time
    if (aLimited.limited && bLimited.limited && aLimited.resetAt && bLimited.resetAt) {
      return aLimited.resetAt.getTime() - bLimited.resetAt.getTime();
    }

    // Sort by lower weekly usage
    const aWeekly = a.usage?.weeklyUsagePercent ?? 0;
    const bWeekly = b.usage?.weeklyUsagePercent ?? 0;
    if (aWeekly !== bWeekly) {
      return aWeekly - bWeekly;
    }

    // Sort by lower session usage
    const aSession = a.usage?.sessionUsagePercent ?? 0;
    const bSession = b.usage?.sessionUsagePercent ?? 0;
    return aSession - bSession;
  });
}
