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
 *
 * API Profile Rotation:
 * - API profiles use custom usage tracking (request count, token usage, rate limits)
 * - Supports same 6 rotation strategies as OAuth profiles
 * - Separate functions to maintain clear separation between OAuth and API profile logic
 */

import type { ClaudeProfile, ClaudeAutoSwitchSettings, APIProfile, APIProfileUsage, APIProfileRotationStrategy } from '../../shared/types';
import { isProfileRateLimited } from './rate-limit-manager';
import { isProfileAuthenticated } from './profile-utils';
import { getAPIProfileUsage } from '../services/profile-service';

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
 * Get the best profile to switch to based on configured rotation strategy
 *
 * Selection Logic:
 * 1. Check the rotationStrategy from settings (default: 'priority')
 * 2. Apply the appropriate strategy:
 *    - 'priority': Use user's priority order (existing behavior)
 *    - 'round-robin': Cycle through profiles sequentially
 *    - 'least-used': Select profile with lowest usage
 *    - 'random': Random selection
 *    - 'weighted': Weighted distribution
 *    - 'time-based': Rotate at configured intervals
 * 3. Return the selected profile or null if no available profiles
 *
 * @param profiles - All Claude profiles
 * @param settings - Auto-switch settings (contains thresholds and rotationStrategy)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @param priorityOrder - User's configured priority order (array of unified IDs like 'oauth-{id}')
 * @returns Selected profile based on rotation strategy, or null if no available profiles
 */
export function getBestAvailableProfile(
  profiles: ClaudeProfile[],
  settings: ClaudeAutoSwitchSettings,
  excludeProfileId?: string,
  priorityOrder: string[] = []
): ClaudeProfile | null {
  // Get the rotation strategy from settings (default to 'priority')
  const strategy = settings.rotationStrategy ?? 'priority';

  if (isDebug) {
    console.warn('[ProfileScorer] Using rotation strategy:', strategy);
  }

  // Apply the appropriate strategy based on settings
  switch (strategy) {
    case 'round-robin': {
      const result = roundRobinStrategy(profiles, settings, excludeProfileId);
      // Note: Caller should update settings.roundRobinLastIndex with result.newIndex
      return result.profile;
    }

    case 'least-used': {
      return leastUsedStrategy(profiles, settings, excludeProfileId);
    }

    case 'random': {
      return randomStrategy(profiles, settings, excludeProfileId);
    }

    case 'weighted': {
      return weightedStrategy(profiles, settings, excludeProfileId);
    }

    case 'time-based': {
      const result = timeBasedStrategy(profiles, settings, excludeProfileId);
      // Note: Caller should update settings with result state tracking fields
      return result.profile;
    }

    case 'priority':
    default: {
      // Use existing priority-based logic (default, backward compatible)
      return getBestAvailableProfileByPriority(profiles, settings, excludeProfileId, priorityOrder);
    }
  }
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
function getBestAvailableProfileByPriority(
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

// ============================================================================
// API Profile Rotation Functions
// ============================================================================

interface APIScoredProfile {
  profile: APIProfile;
  score: number;
  priorityIndex: number;
  isAvailable: boolean;
  unavailableReason?: string;
  usage: APIProfileUsage | null;
}

/**
 * Check if an API profile is available for use based on all criteria
 */
function checkAPIProfileAvailability(
  profile: APIProfile,
  usage: APIProfileUsage | null,
  strategy: APIProfileRotationStrategy
): { available: boolean; reason?: string } {
  // Check rate limit status
  if (usage?.isRateLimited) {
    // Check if rate limit has expired
    const now = Date.now();
    if (usage.rateLimitResetTime && now < usage.rateLimitResetTime) {
      const resetDate = new Date(usage.rateLimitResetTime);
      return {
        available: false,
        reason: `rate limited until ${resetDate.toISOString()}`
      };
    } else if (usage.rateLimitResetTime && now >= usage.rateLimitResetTime) {
      // Rate limit has expired, profile is available again
      // (Caller should clear the rate limit status)
      return { available: true };
    }
    // No reset time but marked as limited
    return { available: false, reason: 'rate limited (no reset time)' };
  }

  // Check quota limits if configured
  if (usage && strategy.thresholds.maxUsagePercent < 100) {
    if (usage.quotaLimit && usage.quotaLimit > 0) {
      // Calculate usage percentage
      const usagePercent = (usage.requestCount / usage.quotaLimit) * 100;

      // Using >= to reject profiles AT or ABOVE threshold
      if (usagePercent >= strategy.thresholds.maxUsagePercent) {
        return {
          available: false,
          reason: `usage ${usagePercent.toFixed(1)}% >= threshold ${strategy.thresholds.maxUsagePercent}%`
        };
      }
    }
  }

  return { available: true };
}

/**
 * Calculate a fallback score for API profiles when no profiles meet all criteria
 */
function calculateAPIFallbackScore(
  profile: APIProfile,
  usage: APIProfileUsage | null,
  strategy: APIProfileRotationStrategy
): number {
  let score = 100;
  const now = Date.now();

  // Rate limit status
  if (usage?.isRateLimited) {
    if (usage.rateLimitResetTime) {
      const hoursUntilReset = (usage.rateLimitResetTime - now) / (1000 * 60 * 60);
      score -= 200; // Rate limited is bad

      // Bonus for profiles that reset sooner
      score += Math.max(0, 50 - hoursUntilReset);
    } else {
      score -= 500; // Rate limited with no reset time is worse
    }
  }

  // Usage penalties (prefer lower usage)
  if (usage && strategy.thresholds.maxUsagePercent < 100) {
    if (usage.quotaLimit && usage.quotaLimit > 0) {
      const usagePercent = (usage.requestCount / usage.quotaLimit) * 100;

      // Penalize based on how far over threshold
      const overage = Math.max(0, usagePercent - strategy.thresholds.maxUsagePercent);
      score -= overage * 2;

      // Also factor in absolute usage (lower is better)
      score -= usagePercent * 0.3;
    }

    // Penalize high token usage
    if (usage.tokenUsage > 0) {
      score -= Math.log10(usage.tokenUsage + 1) * 2;
    }
  }

  return score;
}

/**
 * Get the best API profile to use based on configured rotation strategy
 *
 * Selection Logic:
 * 1. Check if rotation is enabled in APIProfileRotationStrategy
 * 2. Apply priority-based strategy (uses user's configured priority order)
 * 3. Return the selected profile or null if no available profiles
 *
 * NOTE: Currently only 'priority' strategy is implemented for API profiles.
 * The type APIProfileRotationStrategy doesn't include a rotationStrategy field,
 * so we default to priority-based selection using the priorityOrder array.
 *
 * @param profiles - All API profiles
 * @param strategy - API profile rotation strategy configuration
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Selected API profile based on priority order, or null if no available profiles
 */
export function getBestAvailableAPIProfile(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): APIProfile | null {
  if (!strategy.enabled) {
    // Rotation disabled, return null (caller should use active profile)
    return null;
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Using API rotation strategy: priority');
  }

  // Use priority-based logic (currently the only supported strategy for API profiles)
  return getBestAvailableAPIProfileByPriority(profiles, strategy, excludeProfileId);
}

/**
 * Get the best API profile based on priority order and availability
 */
function getBestAvailableAPIProfileByPriority(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): APIProfile | null {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Evaluating', candidates.length, 'API candidate profiles (excluding:', excludeProfileId, ')');
    console.warn('[ProfileScorer] Priority order:', strategy.priorityOrder);
    console.warn('[ProfileScorer] Thresholds: max usage =', strategy.thresholds.maxUsagePercent, '%');
  }

  // Score and check availability for each profile
  const scoredProfiles: APIScoredProfile[] = candidates.map(profile => {
    const usage = getAPIProfileUsage(profile.id);
    const priorityIndex = strategy.priorityOrder.indexOf(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);
    const fallbackScore = calculateAPIFallbackScore(profile, usage, strategy);

    if (isDebug) {
      console.warn('[ProfileScorer] Scoring API profile:', profile.name, '(', profile.id, ')');
      console.warn('[ProfileScorer]   Priority index:', priorityIndex === -1 ? 'not in list (Infinity)' : priorityIndex);
      console.warn('[ProfileScorer]   Available:', availability.available, availability.reason ? `(${availability.reason})` : '');
      console.warn('[ProfileScorer]   Usage:', usage ? `requests=${usage.requestCount}, tokens=${usage.tokenUsage}` : 'none');
      console.warn('[ProfileScorer]   Fallback score:', fallbackScore);
    }

    return {
      profile,
      score: fallbackScore,
      priorityIndex: priorityIndex === -1 ? Infinity : priorityIndex,
      isAvailable: availability.available,
      unavailableReason: availability.reason,
      usage
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
    console.warn('[ProfileScorer] Best available API profile:', best.profile.name, '(priority index:', best.priorityIndex, ')');
    return best.profile;
  }

  // No profile meets all criteria - check if we should return the least bad option
  if (best.score > 0) {
    console.warn('[ProfileScorer] No ideal API profile available, using least-bad option:', best.profile.name,
      '(score:', best.score, ', reason:', best.unavailableReason, ')');
    return best.profile;
  }

  // All profiles are truly unusable
  console.warn('[ProfileScorer] No usable API profile available, all have issues');
  return null;
}

/**
 * Round-robin strategy for API profiles
 */
function apiRoundRobinStrategy(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): { profile: APIProfile | null; newIndex: number } {
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return { profile: null, newIndex: 0 };
  }

  if (isDebug) {
    console.warn('[ProfileScorer] API Round-robin: evaluating', candidates.length, 'profiles');
  }

  // Filter to available profiles only
  const availableProfiles: APIProfile[] = [];

  for (const profile of candidates) {
    const usage = getAPIProfileUsage(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebug) {
      console.warn('[ProfileScorer] API Round-robin: profile', profile.name, 'available:', availability.available);
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] API Round-robin: no available profiles');
    return { profile: null, newIndex: 0 };
  }

  // Get last used index (stored in strategy settings or default to 0)
  const lastIndex = (strategy as any).roundRobinLastIndex ?? 0;
  const nextIndex = (lastIndex + 1) % availableProfiles.length;
  const selectedProfile = availableProfiles[nextIndex];

  if (isDebug) {
    console.warn('[ProfileScorer] API Round-robin: selected profile', selectedProfile.name, 'at index', nextIndex);
  }

  // Note: Caller should update strategy.roundRobinLastIndex with nextIndex
  return { profile: selectedProfile, newIndex: nextIndex };
}

/**
 * Least-used strategy for API profiles
 */
function apiLeastUsedStrategy(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): APIProfile | null {
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebug) {
    console.warn('[ProfileScorer] API Least-used: evaluating', candidates.length, 'profiles');
  }

  // Filter to available profiles only and calculate usage scores
  interface UsageScore {
    profile: APIProfile;
    score: number;
    requestCount: number;
    tokenUsage: number;
  }

  const scoredProfiles: UsageScore[] = [];

  for (const profile of candidates) {
    const usage = getAPIProfileUsage(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);

    if (availability.available) {
      const requestCount = usage?.requestCount ?? 0;
      const tokenUsage = usage?.tokenUsage ?? 0;

      // Calculate combined score (lower is better)
      // Token usage weighted less (logarithmic scale)
      const score = requestCount + Math.log10(tokenUsage + 1) * 100;

      scoredProfiles.push({
        profile,
        score,
        requestCount,
        tokenUsage
      });

      if (isDebug) {
        console.warn('[ProfileScorer] API Least-used: profile', profile.name, 'score:', score);
      }
    }
  }

  if (scoredProfiles.length === 0) {
    console.warn('[ProfileScorer] API Least-used: no available profiles');
    return null;
  }

  // Sort by score ascending (lowest usage first)
  scoredProfiles.sort((a, b) => a.score - b.score);

  const selected = scoredProfiles[0];
  console.warn('[ProfileScorer] API Least-used: selected profile', selected.profile.name);

  return selected.profile;
}

/**
 * Random strategy for API profiles
 */
function apiRandomStrategy(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): APIProfile | null {
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebug) {
    console.warn('[ProfileScorer] API Random: evaluating', candidates.length, 'profiles');
  }

  // Filter to available profiles only
  const availableProfiles: APIProfile[] = [];

  for (const profile of candidates) {
    const usage = getAPIProfileUsage(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebug) {
      console.warn('[ProfileScorer] API Random: profile', profile.name, 'available:', availability.available);
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] API Random: no available profiles');
    return null;
  }

  // Randomly select one profile
  const randomIndex = Math.floor(Math.random() * availableProfiles.length);
  const selectedProfile = availableProfiles[randomIndex];

  if (isDebug) {
    console.warn('[ProfileScorer] API Random: selected profile', selectedProfile.name, 'at index', randomIndex);
  }

  return selectedProfile;
}

/**
 * Weighted distribution strategy for API profiles
 */
function apiWeightedStrategy(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): APIProfile | null {
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebug) {
    console.warn('[ProfileScorer] API Weighted: evaluating', candidates.length, 'profiles');
  }

  // Filter to available profiles only
  const availableProfiles: APIProfile[] = [];

  for (const profile of candidates) {
    const usage = getAPIProfileUsage(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebug) {
      console.warn('[ProfileScorer] API Weighted: profile', profile.name, 'available:', availability.available);
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] API Weighted: no available profiles');
    return null;
  }

  // Get weights from strategy (priority order can be used as weights)
  const configuredWeights = (strategy as any).profileWeights ?? {};

  // Build weighted list
  interface WeightedProfile {
    profile: APIProfile;
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
      console.warn('[ProfileScorer] API Weighted: profile', profile.name, 'weight:', weight);
    }
  }

  // Weighted random selection
  const randomValue = Math.random() * totalWeight;
  const selectedProfile = weightedProfiles.find(wp => wp.cumulativeWeight >= randomValue)?.profile ?? null;

  if (selectedProfile && isDebug) {
    console.warn('[ProfileScorer] API Weighted: selected profile', selectedProfile.name);
  }

  return selectedProfile;
}

/**
 * Time-based strategy for API profiles
 */
function apiTimeBasedStrategy(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): {
  profile: APIProfile | null;
  currentProfileId?: string;
  lastRotationTime?: number;
  profileIndex?: number;
} {
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return { profile: null, currentProfileId: undefined, lastRotationTime: undefined, profileIndex: 0 };
  }

  if (isDebug) {
    console.warn('[ProfileScorer] API Time-based: evaluating', candidates.length, 'profiles');
  }

  // Filter to available profiles only
  const availableProfiles: APIProfile[] = [];

  for (const profile of candidates) {
    const usage = getAPIProfileUsage(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebug) {
      console.warn('[ProfileScorer] API Time-based: profile', profile.name, 'available:', availability.available);
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] API Time-based: no available profiles');
    return { profile: null, currentProfileId: undefined, lastRotationTime: undefined, profileIndex: 0 };
  }

  const now = Date.now();
  const rotationIntervalMs = ((strategy as any).rotationInterval ?? 300) * 1000; // Default: 5 minutes

  // Get state tracking from strategy
  const currentProfileId = (strategy as any).timeBasedCurrentProfile;
  const lastRotationTime = (strategy as any).timeBasedLastRotationTime;
  let currentIndex = (strategy as any).timeBasedProfileIndex ?? 0;

  let selectedProfile: APIProfile = availableProfiles[0];
  let shouldRotate = false;
  let newProfileIndex = currentIndex;
  let newCurrentProfileId = currentProfileId;
  let newLastRotationTime = lastRotationTime;

  if (isDebug) {
    console.warn('[ProfileScorer] API Time-based: current profile ID =', currentProfileId, ', index =', currentIndex);
  }

  // Check if we have a current profile and it's still available
  if (currentProfileId && lastRotationTime) {
    const elapsedMs = now - lastRotationTime;
    const currentProfile = availableProfiles.find(p => p.id === currentProfileId);

    if (currentProfile && elapsedMs < rotationIntervalMs) {
      // Interval not elapsed, continue using current profile
      selectedProfile = currentProfile;
      shouldRotate = false;
    } else if (currentProfile && elapsedMs >= rotationIntervalMs) {
      // Interval elapsed, rotate to next profile
      shouldRotate = true;
    } else {
      // Current profile no longer available, reset to first profile
      shouldRotate = true;
      currentIndex = 0;
      newProfileIndex = 0;
    }
  } else {
    // No state tracking, start with first profile
    shouldRotate = true;
    currentIndex = 0;
    newProfileIndex = 0;
  }

  if (shouldRotate) {
    // Calculate next index (circular)
    newProfileIndex = (currentIndex + 1) % availableProfiles.length;
    selectedProfile = availableProfiles[newProfileIndex];
    newCurrentProfileId = selectedProfile.id;
    newLastRotationTime = now;

    if (isDebug) {
      console.warn('[ProfileScorer] API Time-based: rotated to profile', selectedProfile.name, 'at index', newProfileIndex);
    }
  }

  // Note: Caller should update strategy state tracking fields
  return {
    profile: selectedProfile,
    currentProfileId: newCurrentProfileId,
    lastRotationTime: newLastRotationTime,
    profileIndex: newProfileIndex
  };
}

// ============================================================================
// API Profile to OAuth Fallback Logic
// ============================================================================

/**
 * Result type for profile selection that can be either API or OAuth
 */
export interface ProfileSelectionResult {
  profile: APIProfile | ClaudeProfile | null;
  profileType: 'api' | 'oauth' | null;
  reason?: string;
}

/**
 * Get the best available profile with fallback from API to OAuth
 *
 * Selection Logic:
 * 1. First, try to get an available API profile using the configured strategy
 * 2. If no API profile is available and fallbackToOAuth is enabled:
 *    - Fall back to OAuth profiles using the OAuth auto-switch settings
 *    - Return the best available OAuth profile
 * 3. If fallback is disabled or no OAuth profiles available, return null
 *
 * Use Cases:
 * - API profiles are rate-limited or over quota
 * - All API profiles are unavailable
 * - User wants OAuth as a safety net
 *
 * @param apiProfiles - All configured API profiles
 * @param oauthProfiles - All configured OAuth profiles
 * @param apiStrategy - API profile rotation strategy configuration
 * @param oauthSettings - OAuth auto-switch settings
 * @param oauthPriorityOrder - User's configured priority order for OAuth profiles (array of unified IDs like 'oauth-{id}')
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns ProfileSelectionResult with selected profile, type, and reason
 */
export function getBestAvailableProfileWithFallback(
  apiProfiles: APIProfile[],
  oauthProfiles: ClaudeProfile[],
  apiStrategy: APIProfileRotationStrategy,
  oauthSettings: ClaudeAutoSwitchSettings,
  oauthPriorityOrder: string[] = [],
  excludeProfileId?: string
): ProfileSelectionResult {
  if (isDebug) {
    console.warn('[ProfileScorer] Profile selection with fallback:');
    console.warn('[ProfileScorer]   API profiles:', apiProfiles.length);
    console.warn('[ProfileScorer]   OAuth profiles:', oauthProfiles.length);
    console.warn('[ProfileScorer]   Fallback to OAuth:', apiStrategy.fallbackToOAuth);
  }

  // Step 1: Try to get an available API profile
  const apiProfile = getBestAvailableAPIProfile(apiProfiles, apiStrategy, excludeProfileId);

  if (apiProfile) {
    if (isDebug) {
      console.warn('[ProfileScorer] Selected API profile:', apiProfile.name);
    }

    return {
      profile: apiProfile,
      profileType: 'api',
      reason: 'API profile available'
    };
  }

  // Step 2: No API profile available - check if we should fall back to OAuth
  if (!apiStrategy.fallbackToOAuth) {
    if (isDebug) {
      console.warn('[ProfileScorer] No API profile available and OAuth fallback disabled');
    }

    return {
      profile: null,
      profileType: null,
      reason: 'No API profile available and OAuth fallback disabled'
    };
  }

  // Step 3: Fall back to OAuth profiles
  if (oauthProfiles.length === 0) {
    if (isDebug) {
      console.warn('[ProfileScorer] Fallback enabled but no OAuth profiles configured');
    }

    return {
      profile: null,
      profileType: null,
      reason: 'Fallback enabled but no OAuth profiles configured'
    };
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Falling back to OAuth profiles');
  }

  const oauthProfile = getBestAvailableProfile(
    oauthProfiles,
    oauthSettings,
    excludeProfileId,
    oauthPriorityOrder
  );

  if (oauthProfile) {
    if (isDebug) {
      console.warn('[ProfileScorer] Selected OAuth profile as fallback:', oauthProfile.name);
    }

    return {
      profile: oauthProfile,
      profileType: 'oauth',
      reason: 'Fallback to OAuth profile (no API profiles available)'
    };
  }

  // Step 4: No profiles available at all
  if (isDebug) {
    console.warn('[ProfileScorer] No API or OAuth profiles available');
  }

  return {
    profile: null,
    profileType: null,
    reason: 'No API or OAuth profiles available'
  };
}
