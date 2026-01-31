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

/**
 * Check if debug logging is enabled
 * Dynamic check to allow testing with DEBUG environment variable
 */
function isDebugMode(): boolean {
  return process.env.DEBUG === 'true';
}

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
 * Result from profile selection including state updates for persistence
 */
export interface ProfileSelectionResult {
  /** Selected profile (null if no suitable profile found) */
  profile: ClaudeProfile | null;
  /** State updates to persist (for round-robin, time-based strategies) */
  stateUpdates: Record<string, unknown>;
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
 * 3. Return the selected profile and state updates or null if no available profiles
 *
 * @param profiles - All Claude profiles
 * @param settings - Auto-switch settings (contains thresholds and rotationStrategy)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @param priorityOrder - User's configured priority order (array of unified IDs like 'oauth-{id}')
 * @returns Profile selection result with selected profile and state updates for persistence
 */
export function getBestAvailableProfile(
  profiles: ClaudeProfile[],
  settings: ClaudeAutoSwitchSettings,
  excludeProfileId?: string,
  priorityOrder: string[] = []
): ProfileSelectionResult {
  // Get the rotation strategy from settings (default to 'priority')
  const strategy = settings.rotationStrategy ?? 'priority';

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Profile rotation triggered', {
      timestamp: new Date().toISOString(),
      strategy,
      profileCount: profiles.length,
      excludeProfileId: excludeProfileId || 'none',
      priorityOrder: priorityOrder.length > 0 ? priorityOrder : 'not configured'
    });
  }

  // Apply the appropriate strategy based on settings
  let selectedProfile: ClaudeProfile | null = null;
  let stateUpdates: Record<string, unknown> = {};

  switch (strategy) {
    case 'round-robin': {
      const result = roundRobinStrategy(profiles, settings, excludeProfileId);
      selectedProfile = result.profile;
      stateUpdates = { roundRobinLastIndex: result.newIndex };
      break;
    }

    case 'least-used': {
      selectedProfile = leastUsedStrategy(profiles, settings, excludeProfileId);
      break;
    }

    case 'random': {
      selectedProfile = randomStrategy(profiles, settings, excludeProfileId);
      break;
    }

    case 'weighted': {
      selectedProfile = weightedStrategy(profiles, settings, excludeProfileId);
      break;
    }

    case 'time-based': {
      const result = timeBasedStrategy(profiles, settings, excludeProfileId);
      selectedProfile = result.profile;
      stateUpdates = {
        timeBasedCurrentProfile: result.currentProfileId,
        timeBasedLastRotationTime: result.lastRotationTime,
        timeBasedProfileIndex: result.profileIndex
      };
      break;
    }

    case 'priority':
    default: {
      // Use existing priority-based logic (default, backward compatible)
      selectedProfile = getBestAvailableProfileByPriority(profiles, settings, excludeProfileId, priorityOrder);
      break;
    }
  }

  // Exit logging with selected profile and state updates
  if (selectedProfile) {
    const logData: {
      profileId: string;
      profileName: string;
      strategy: string;
      stateUpdates?: Record<string, unknown>;
    } = {
      profileId: selectedProfile.id,
      profileName: selectedProfile.name,
      strategy
    };

    // Include state updates if any
    if (Object.keys(stateUpdates).length > 0) {
      logData.stateUpdates = stateUpdates;
    }

    if (isDebugMode()) {
      console.log('[ProfileScorer] Profile selected using rotation strategy:', logData);
    }
  } else {
    if (isDebugMode()) {
      console.log('[ProfileScorer] No suitable profile found', {
        strategy,
        excludeProfileId: excludeProfileId || 'none'
      });
    }
  }

  return { profile: selectedProfile, stateUpdates };
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

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Evaluating candidate profiles', {
      count: candidates.length,
      excludeProfileId: excludeProfileId || 'none',
      priorityOrder: priorityOrder.length > 0 ? priorityOrder : 'not configured',
      thresholds: {
        session: settings.sessionThreshold,
        weekly: settings.weeklyThreshold
      }
    });
  }

  // Score and check availability for each profile
  const scoredProfiles: ScoredProfile[] = candidates.map(profile => {
    const unifiedId = `oauth-${profile.id}`;
    const priorityIndex = priorityOrder.indexOf(unifiedId);
    const availability = checkProfileAvailability(profile, settings);
    const fallbackScore = calculateFallbackScore(profile, settings);

    if (isDebugMode()) {
      console.warn('[ProfileScorer] Scoring profile', {
        profileName: profile.name,
        profileId: profile.id,
        priorityIndex: priorityIndex === -1 ? 'not in list (Infinity)' : priorityIndex,
        available: availability.available,
        unavailableReason: availability.reason || 'none',
        usage: profile.usage ? {
          sessionUsagePercent: profile.usage.sessionUsagePercent,
          weeklyUsagePercent: profile.usage.weeklyUsagePercent
        } : 'unknown',
        fallbackScore
      });
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

  // Log priority order evaluation with availability status for all profiles
  if (isDebugMode()) {
    console.log('[ProfileScorer] Priority strategy: profile evaluation results', {
      profiles: scoredProfiles.map(sp => ({
        profileId: sp.profile.id,
        profileName: sp.profile.name,
        priorityIndex: sp.priorityIndex === Infinity ? 'not configured' : sp.priorityIndex,
        isAvailable: sp.isAvailable,
        unavailableReason: sp.unavailableReason || 'none',
        fallbackScore: sp.score,
        usage: sp.profile.usage ? {
          sessionUsagePercent: sp.profile.usage.sessionUsagePercent,
          weeklyUsagePercent: sp.profile.usage.weeklyUsagePercent
        } : 'unknown'
      })),
      priorityOrder: priorityOrder.length > 0 ? priorityOrder : 'not configured',
      thresholds: {
        session: settings.sessionThreshold,
        weekly: settings.weeklyThreshold
      },
      candidateCount: candidates.length
    });
  }

  if (best.isAvailable) {
    // Log final selection with priority details
    if (isDebugMode()) {
      console.log('[ProfileScorer] Priority strategy: selected available profile', {
        profileId: best.profile.id,
        profileName: best.profile.name,
        priorityIndex: best.priorityIndex === Infinity ? 'not configured' : best.priorityIndex,
        selectionReason: 'first available in priority order',
        availability: 'available'
      });
    }
    if (isDebugMode()) {
      console.warn('[ProfileScorer] Best available profile', {
        profileName: best.profile.name,
        priorityIndex: best.priorityIndex === Infinity ? 'not configured' : best.priorityIndex
      });
    }
    return best.profile;
  }

  // No profile meets all criteria - check if we should return the least bad option
  // Only return if it has a positive score (meaning it might still work)
  if (best.score > 0) {
    // Log fallback selection with details
    if (isDebugMode()) {
      console.log('[ProfileScorer] Priority strategy: using least-bad fallback profile', {
        profileId: best.profile.id,
        profileName: best.profile.name,
        fallbackScore: best.score,
        unavailableReason: best.unavailableReason || 'none',
        selectionReason: 'no available profiles, using least-bad option',
        availability: 'unavailable (fallback)'
      });
    }
    if (isDebugMode()) {
      console.warn('[ProfileScorer] No ideal profile available, using least-bad option', {
        profileName: best.profile.name,
        score: best.score,
        reason: best.unavailableReason || 'none'
      });
    }
    return best.profile;
  }

  // All profiles are truly unusable
  if (isDebugMode()) {
    console.log('[ProfileScorer] Priority strategy: no usable profile found', {
      reason: 'all profiles have issues or negative scores',
      candidateCount: candidates.length,
      thresholds: {
        session: settings.sessionThreshold,
        weekly: settings.weeklyThreshold
      }
    });
  }
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
    const result = getBestAvailableProfile(allProfiles, settings, profile.id, priorityOrder);
    if (result.profile) {
      return {
        shouldSwitch: true,
        reason: `Weekly usage at ${usage.weeklyUsagePercent}% (threshold: ${settings.weeklyThreshold}%)`,
        suggestedProfile: result.profile
      };
    }
  }

  if (usage.sessionUsagePercent >= settings.sessionThreshold) {
    const result = getBestAvailableProfile(allProfiles, settings, profile.id, priorityOrder);
    if (result.profile) {
      return {
        shouldSwitch: true,
        reason: `Session usage at ${usage.sessionUsagePercent}% (threshold: ${settings.sessionThreshold}%)`,
        suggestedProfile: result.profile
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

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Round-robin strategy: evaluating candidate profiles', {
      count: candidates.length
    });
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

    if (isDebugMode()) {
      console.warn('[ProfileScorer] Round-robin: profile availability check', {
        profileName: profile.name,
        available: availability.available,
        reason: availability.reason || 'none'
      });
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

  // Log index transition
  if (isDebugMode()) {
    console.log('[ProfileScorer] Round-robin strategy: index transition', {
      lastIndex,
      nextIndex,
      availableProfilesCount: availableProfiles.length
    });
  }

  const selectedProfile = availableProfiles[nextIndex];

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Round-robin: selected profile', {
      profileName: selectedProfile.name,
      index: nextIndex
    });
  }

  // Log profile selection
  if (isDebugMode()) {
    console.log('[ProfileScorer] Round-robin strategy: selected profile', {
      profileName: selectedProfile.name,
      profileId: selectedProfile.id,
      index: nextIndex
    });
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

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Least-used strategy: evaluating candidate profiles', {
      count: candidates.length
    });
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

    if (isDebugMode()) {
      console.warn('[ProfileScorer] Least-used: profile availability check', {
        profileName: profile.name,
        available: availability.available,
        reason: availability.reason || 'none'
      });
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

    if (isDebugMode()) {
      console.warn('[ProfileScorer] Least-used: profile score calculation', {
        profileName: profile.name,
        score,
        weeklyUsagePercent: weeklyUsage,
        sessionUsagePercent: sessionUsage
      });
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

  // Log usage scores for all profiles
  if (isDebugMode()) {
    console.log('[ProfileScorer] Least-used strategy: profile usage scores', {
      profiles: scoredProfiles.map(sp => ({
        profileId: sp.profile.id,
        profileName: sp.profile.name,
        score: sp.score,
        weeklyUsage: sp.weeklyUsage,
        sessionUsage: sp.sessionUsage
      })),
      availableCount: availableProfiles.length
    });
  }

  // Log profile selection
  if (isDebugMode()) {
    console.log('[ProfileScorer] Least-used strategy: selected profile', {
      profileName: selectedProfile.name,
      profileId: selectedProfile.id,
      score: scoredProfiles[0].score,
      weeklyUsage: scoredProfiles[0].weeklyUsage,
      sessionUsage: scoredProfiles[0].sessionUsage
    });
  }

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Least-used: selected profile', {
      profileName: selectedProfile.name,
      score: scoredProfiles[0].score,
      weeklyUsagePercent: scoredProfiles[0].weeklyUsage,
      sessionUsagePercent: scoredProfiles[0].sessionUsage
    });
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

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Random strategy: evaluating candidate profiles', {
      count: candidates.length
    });
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

    if (isDebugMode()) {
      console.warn('[ProfileScorer] Random: profile availability check', {
        profileName: profile.name,
        available: availability.available,
        reason: availability.reason || 'none'
      });
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] Random: no available profiles');
    return null;
  }

  // Randomly select one profile
  const randomIndex = Math.floor(Math.random() * availableProfiles.length);
  const selectedProfile = availableProfiles[randomIndex];

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Random: selected profile', {
      profileName: selectedProfile.name,
      randomIndex,
      availableProfilesCount: availableProfiles.length
    });
  }

  // Log profile selection with details
  if (isDebugMode()) {
    console.log('[ProfileScorer] Random strategy: selected profile', {
      profileName: selectedProfile.name,
      profileId: selectedProfile.id,
      randomIndex,
      availableProfilesCount: availableProfiles.length
    });
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

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Weighted strategy: evaluating candidate profiles', {
      count: candidates.length
    });
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

    if (isDebugMode()) {
      console.warn('[ProfileScorer] Weighted: profile availability check', {
        profileName: profile.name,
        available: availability.available,
        reason: availability.reason || 'none'
      });
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

    if (isDebugMode()) {
      console.warn('[ProfileScorer] Weighted: profile weight calculation', {
        profileName: profile.name,
        weight,
        cumulativeWeight: totalWeight
      });
    }
  }

  // Weighted random selection
  const randomValue = Math.random() * totalWeight;

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Weighted: random value', {
      randomValue: randomValue.toFixed(2),
      totalWeight
    });
  }

  // Find the profile where cumulativeWeight >= randomValue
  const selectedProfile = weightedProfiles.find(wp => wp.cumulativeWeight >= randomValue)?.profile ?? null;

  // Log weight distribution for all profiles
  if (isDebugMode()) {
    console.log('[ProfileScorer] Weighted strategy: weight distribution', {
      profiles: weightedProfiles.map(wp => ({
        profileId: wp.profile.id,
        profileName: wp.profile.name,
        weight: wp.weight,
        cumulativeWeight: wp.cumulativeWeight,
        probabilityPercent: totalWeight > 0 ? ((wp.weight / totalWeight) * 100).toFixed(2) : '0'
      })),
      totalWeight,
      availableCount: availableProfiles.length
    });
  }

  if (selectedProfile) {
    const selectedWeighted = weightedProfiles.find(wp => wp.profile.id === selectedProfile.id);

    // Log profile selection with details
    if (isDebugMode()) {
      console.log('[ProfileScorer] Weighted strategy: selected profile', {
        profileName: selectedProfile.name,
        profileId: selectedProfile.id,
        randomValue: randomValue.toFixed(2),
        selectedWeight: selectedWeighted?.weight,
        cumulativeWeight: selectedWeighted?.cumulativeWeight,
        probabilityPercent: selectedWeighted ? ((selectedWeighted.weight / totalWeight) * 100).toFixed(2) : '0'
      });
    }

    if (isDebugMode()) {
      console.warn('[ProfileScorer] Weighted: selected profile', {
        profileName: selectedProfile.name,
        randomValue: randomValue.toFixed(2),
        selectedWeight: selectedWeighted?.weight,
        cumulativeWeight: selectedWeighted?.cumulativeWeight,
        probabilityPercent: selectedWeighted ? ((selectedWeighted.weight / totalWeight) * 100).toFixed(2) : '0'
      });
    }
  } else {
    if (isDebugMode()) {
      console.log('[ProfileScorer] Weighted strategy: no profile selected (unexpected - this should not happen)');
    }
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

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Time-based strategy: evaluating candidate profiles', {
      count: candidates.length
    });
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

    if (isDebugMode()) {
      console.warn('[ProfileScorer] Time-based: profile availability check', {
        profileName: profile.name,
        available: availability.available,
        reason: availability.reason || 'none'
      });
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

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Time-based: configuration and state', {
      rotationIntervalSeconds,
      rotationIntervalMs,
      currentProfileId: currentProfileId || 'none',
      currentIndex,
      lastRotationTime: lastRotationTimeStr || 'none'
    });
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

      // Log decision to continue with current profile
      if (isDebugMode()) {
        console.log('[ProfileScorer] Time-based strategy: continuing with current profile (interval not elapsed)', {
          profileId: currentProfile.id,
          profileName: currentProfile.name,
          elapsedMs,
          rotationIntervalMs,
          timeUntilRotationMs: rotationIntervalMs - elapsedMs
        });
      }

      if (isDebugMode()) {
        console.warn('[ProfileScorer] Time-based: interval not elapsed, continuing with current profile', {
          profileName: currentProfile.name,
          elapsedMs,
          rotationIntervalMs,
          remainingMs: rotationIntervalMs - elapsedMs
        });
      }
    } else if (currentProfile && elapsedMs >= rotationIntervalMs) {
      // Interval elapsed, rotate to next profile
      shouldRotate = true;

      // Log decision to rotate (interval elapsed)
      if (isDebugMode()) {
        console.log('[ProfileScorer] Time-based strategy: rotation interval elapsed, rotating profile', {
          currentProfileId: currentProfile.id,
          currentProfileName: currentProfile.name,
          elapsedMs,
          rotationIntervalMs,
          overdueMs: elapsedMs - rotationIntervalMs
        });
      }

      if (isDebugMode()) {
        console.warn('[ProfileScorer] Time-based: interval elapsed, rotating to next profile', {
          currentProfileName: currentProfile.name,
          elapsedMs,
          rotationIntervalMs,
          overdueMs: elapsedMs - rotationIntervalMs
        });
      }
    } else {
      // Current profile no longer available, reset to first profile
      shouldRotate = true;
      currentIndex = 0; // Reset index
      newProfileIndex = 0;

      // Log decision to reset (current profile unavailable)
      if (isDebugMode()) {
        console.log('[ProfileScorer] Time-based strategy: current profile no longer available, resetting to first available profile', {
          previousProfileId: currentProfileId,
          reason: 'profile not in available list'
        });
      }

      if (isDebugMode()) {
        console.warn('[ProfileScorer] Time-based: current profile no longer available, resetting to first available profile', {
          previousProfileId: currentProfileId,
          reason: 'profile not in available list'
        });
      }
    }
  } else {
    // No state tracking, start with first profile
    shouldRotate = true;
    currentIndex = 0;
    newProfileIndex = 0;

    // Log initial state (first time using time-based strategy)
    if (isDebugMode()) {
      console.log('[ProfileScorer] Time-based strategy: no state tracking, initializing with first available profile', {
        initialProfileId: availableProfiles[0].id,
        initialProfileName: availableProfiles[0].name,
        rotationIntervalSeconds
      });
    }

    if (isDebugMode()) {
      console.warn('[ProfileScorer] Time-based: no state tracking, starting with first available profile', {
        initialProfileId: availableProfiles[0].id,
        initialProfileName: availableProfiles[0].name,
        rotationIntervalSeconds
      });
    }
  }

  if (shouldRotate) {
    // Calculate next index (circular)
    newProfileIndex = (currentIndex + 1) % availableProfiles.length;
    selectedProfile = availableProfiles[newProfileIndex];
    newCurrentProfileId = selectedProfile.id;
    newLastRotationTime = now.toISOString();

    // Log rotation execution with state tracking updates
    if (isDebugMode()) {
      console.log('[ProfileScorer] Time-based strategy: profile rotation completed with state updates', {
        previousIndex: currentIndex,
        newIndex: newProfileIndex,
        selectedProfileId: selectedProfile.id,
        selectedProfileName: selectedProfile.name,
        stateUpdates: {
          currentProfileId: newCurrentProfileId,
          lastRotationTime: newLastRotationTime,
          profileIndex: newProfileIndex
        },
        availableProfilesCount: availableProfiles.length
      });
    }

    if (isDebugMode()) {
      console.warn('[ProfileScorer] Time-based: rotated to profile', {
        profileName: selectedProfile.name,
        profileIndex: newProfileIndex,
        availableProfilesCount: availableProfiles.length
      });
    }
  } else {
    // Log state tracking when continuing with current profile
    if (isDebugMode()) {
      console.log('[ProfileScorer] Time-based strategy: state tracking (no rotation)', {
        currentProfileId: selectedProfile.id,
        currentProfileName: selectedProfile.name,
        stateUpdates: {
          currentProfileId: newCurrentProfileId,
          lastRotationTime: newLastRotationTime,
          profileIndex: currentIndex
        }
      });
    }
  }

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Time-based: selected profile', {
      profileName: selectedProfile.name,
      state: {
        currentProfileId: newCurrentProfileId,
        profileIndex: newProfileIndex,
        lastRotationTime: newLastRotationTime
      }
    });
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

// =============================================================================
// API Profile Rotation Strategy Implementation
// =============================================================================

import type { APIProfile, APIProfileRotationStrategy, APIProfileUsage } from '../../shared/types';
import { getAPIProfileUsage } from '../services/profile-service';

/**
 * Check if an API profile is available for use based on rotation criteria
 *
 * @param profile - The API profile to check
 * @param usage - Usage data for the profile
 * @param strategy - Rotation strategy configuration
 * @returns Object indicating availability and reason if unavailable
 */
function checkAPIProfileAvailability(
  profile: APIProfile,
  usage: APIProfileUsage | null,
  strategy: APIProfileRotationStrategy
): { available: boolean; reason?: string } {
  // Check rate limit status
  if (usage?.isRateLimited) {
    // If rate limited but no reset time, treat as unavailable (conservative)
    if (usage.rateLimitResetTime === undefined || usage.rateLimitResetTime === null) {
      return {
        available: false,
        reason: 'rate limited (no reset time)'
      };
    }

    // Check if rate limit has expired
    const now = Date.now();
    if (usage.rateLimitResetTime > now) {
      // Still rate limited
      return {
        available: false,
        reason: `rate limited (resets ${new Date(usage.rateLimitResetTime).toISOString()})`
      };
    }
    // Rate limit has expired, profile is available
  }

  // Check usage threshold if quota limit is configured
  // Skip threshold check when maxUsagePercent is 100 (effectively disables threshold)
  if (usage?.quotaLimit && strategy.thresholds?.maxUsagePercent !== undefined && strategy.thresholds.maxUsagePercent < 100) {
    const usagePercent = (usage.requestCount / usage.quotaLimit) * 100;
    const threshold = strategy.thresholds.maxUsagePercent;

    // Using >= to reject profiles AT or ABOVE threshold (consistent with OAuth behavior)
    // This is intentional: we want to switch proactively BEFORE hitting hard limits
    if (usagePercent >= threshold) {
      return {
        available: false,
        reason: `usage ${usagePercent.toFixed(1)}% >= threshold ${threshold}%`
      };
    }
  }

  return { available: true };
}

/**
 * Result from API profile selection including state updates for persistence
 */
export interface APIProfileSelectionResult {
  /** Selected profile (null if no suitable profile found) */
  profile: APIProfile | null;
  /** State updates to persist (for round-robin, time-based strategies) */
  stateUpdates: Partial<Pick<APIProfileRotationStrategy, 'rotationIndex' | 'timeBasedCurrentProfile' | 'timeBasedLastRotationTime' | 'timeBasedProfileIndex'>>;
}

/**
 * Get the best API profile to switch to based on configured rotation strategy
 *
 * Selection Logic:
 * 1. Check the rotationStrategy from settings (default: 'priority')
 * 2. Apply the appropriate strategy:
 *    - 'priority': Use user's priority order (default behavior)
 *    - 'round-robin': Cycle through profiles sequentially
 *    - 'least-used': Select profile with lowest usage
 *    - 'random': Random selection
 *    - 'weighted': Weighted distribution
 *    - 'time-based': Rotate at configured intervals
 * 3. Return the selected profile and state updates or null if no available profiles
 *
 * @param profiles - All API profiles
 * @param strategy - Rotation strategy configuration
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Profile selection result with selected profile and state updates for persistence
 */
export function getBestAvailableAPIProfile(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): APIProfileSelectionResult {
  // Get the rotation strategy from settings (default to 'priority')
  const selectedStrategy = strategy.strategy ?? 'priority';

  if (!strategy.enabled) {
    return { profile: null, stateUpdates: {} };
  }

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Profile rotation triggered', {
      timestamp: new Date().toISOString(),
      strategy: selectedStrategy,
      profileCount: profiles.length,
      excludeProfileId: excludeProfileId || 'none',
      priorityOrder: strategy.priorityOrder?.length > 0 ? strategy.priorityOrder : 'not configured'
    });
  }

  // Apply the appropriate strategy based on settings
  let selectedProfile: APIProfile | null = null;
  let stateUpdates: APIProfileSelectionResult['stateUpdates'] = {};

  switch (selectedStrategy) {
    case 'round-robin': {
      const result = apiRoundRobinStrategy(profiles, strategy, excludeProfileId);
      selectedProfile = result.profile;
      stateUpdates = { rotationIndex: result.newIndex };
      break;
    }

    case 'least-used': {
      selectedProfile = apiLeastUsedStrategy(profiles, strategy, excludeProfileId);
      break;
    }

    case 'random': {
      selectedProfile = apiRandomStrategy(profiles, strategy, excludeProfileId);
      break;
    }

    case 'weighted': {
      selectedProfile = apiWeightedStrategy(profiles, strategy, excludeProfileId);
      break;
    }

    case 'time-based': {
      const result = apiTimeBasedStrategy(profiles, strategy, excludeProfileId);
      selectedProfile = result.profile;
      stateUpdates = {
        timeBasedCurrentProfile: result.currentProfileId,
        timeBasedLastRotationTime: result.lastRotationTime,
        timeBasedProfileIndex: result.profileIndex
      };
      break;
    }

    case 'priority':
    default: {
      // Use existing priority-based logic (default, backward compatible)
      selectedProfile = getBestAvailableAPIProfileByPriority(profiles, strategy, excludeProfileId);
      break;
    }
  }

  // Exit logging with selected profile and state updates
  if (selectedProfile) {
    const logData: {
      profileId: string;
      profileName: string;
      strategy: string;
      stateUpdates?: typeof stateUpdates;
    } = {
      profileId: selectedProfile.id,
      profileName: selectedProfile.name,
      strategy: selectedStrategy
    };

    // Include state updates if any
    if (Object.keys(stateUpdates).length > 0) {
      logData.stateUpdates = stateUpdates;
    }

    if (isDebugMode()) {
      console.log('[ProfileScorer] API Profile selected using rotation strategy:', logData);
    }
  } else {
    if (isDebugMode()) {
      console.log('[ProfileScorer] No suitable API profile found', {
        strategy: selectedStrategy,
        excludeProfileId: excludeProfileId || 'none'
      });
    }
  }

  return { profile: selectedProfile, stateUpdates };
}

/**
 * Get the best API profile to switch to based on priority order and availability
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Check each profile's availability (rate limit, thresholds)
 * 3. Sort by user's priority order
 * 4. Return the first available profile in priority order
 * 5. If none available, return the "least bad" option based on fallback scoring
 *
 * @param profiles - All API profiles
 * @param strategy - Rotation strategy configuration
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Best available API profile or null
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

  if (isDebugMode()) {
    console.warn('[ProfileScorer] Evaluating candidate API profiles', {
      count: candidates.length,
      excludeProfileId: excludeProfileId || 'none',
      priorityOrder: strategy.priorityOrder?.length > 0 ? strategy.priorityOrder : 'not configured',
      threshold: strategy.thresholds?.maxUsagePercent
    });
  }

  // Score and check availability for each profile
  interface ScoredAPIProfile {
    profile: APIProfile;
    usage: APIProfileUsage | null;
    score: number;
    priorityIndex: number;
    isAvailable: boolean;
    unavailableReason?: string;
  }

  const scoredProfiles: ScoredAPIProfile[] = [];

  for (const profile of candidates) {
    const usage = getAPIProfileUsage(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);

    // Calculate fallback score for "least bad" selection
    let score = 100;

    if (usage?.isRateLimited && usage.rateLimitResetTime && usage.rateLimitResetTime > Date.now()) {
      score -= 500; // Rate limited is bad
    }

    if (usage?.quotaLimit) {
      const usagePercent = (usage.requestCount / usage.quotaLimit) * 100;
      const threshold = strategy.thresholds?.maxUsagePercent ?? 100;
      const overage = Math.max(0, usagePercent - threshold);
      score -= overage * 2; // Penalize based on how far over threshold
    }

    const priorityIndex = strategy.priorityOrder?.indexOf(profile.id) ?? -1;

    scoredProfiles.push({
      profile,
      usage,
      score,
      priorityIndex: priorityIndex === -1 ? Infinity : priorityIndex,
      isAvailable: availability.available,
      unavailableReason: availability.reason
    });
  }

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

  if (!best) {
    return null;
  }

  if (best.isAvailable) {
    if (isDebugMode()) {
      console.log('[ProfileScorer] Priority strategy: selected available API profile', {
        profileId: best.profile.id,
        profileName: best.profile.name,
        priorityIndex: best.priorityIndex === Infinity ? 'not configured' : best.priorityIndex
      });
    }
    return best.profile;
  }

  // No profile meets all criteria - check if we should return the least bad option
  if (best.score > 0) {
    if (isDebugMode()) {
      console.log('[ProfileScorer] Priority strategy: using least-bad fallback API profile', {
        profileId: best.profile.id,
        profileName: best.profile.name,
        fallbackScore: best.score,
        unavailableReason: best.unavailableReason || 'none'
      });
    }
    return best.profile;
  }

  // All profiles are truly unusable
  if (isDebugMode()) {
    console.log('[ProfileScorer] Priority strategy: no usable API profile found');
  }
  console.warn('[ProfileScorer] No usable API profile available, all have issues');
  return null;
}

// =============================================================================
// API Profile Strategy Functions
// These will be fully implemented in subsequent subtasks
// =============================================================================

/**
 * Round-robin strategy result type
 */
interface APIRoundRobinResult {
  profile: APIProfile | null;
  newIndex: number;
}

/**
 * Time-based strategy result type
 */
interface APITimeBasedResult {
  profile: APIProfile | null;
  currentProfileId?: string;
  lastRotationTime?: string;
  profileIndex?: number;
}

/**
 * Round-robin strategy for API profiles - cycle through profiles sequentially
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Filter to available profiles only
 * 3. Get last used index from strategy.rotationIndex (default: 0)
 * 4. Move to next index in circular fashion
 * 5. Return profile at next index and the new index for state tracking
 *
 * @param profiles - All API profiles
 * @param strategy - Rotation strategy configuration (contains rotationIndex)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Object with selected profile and new index, or null if no available profiles
 */
function apiRoundRobinStrategy(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): APIRoundRobinResult {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return { profile: null, newIndex: 0 };
  }

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Round-robin strategy: evaluating candidate profiles', {
      count: candidates.length
    });
  }

  // Filter to available profiles only
  const availableProfiles: APIProfile[] = [];
  const availabilityChecks: Array<{ profile: APIProfile; available: boolean; reason?: string }> = [];

  for (const profile of candidates) {
    const usage = getAPIProfileUsage(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);
    availabilityChecks.push({ profile, available: availability.available, reason: availability.reason });

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebugMode()) {
      console.warn('[ProfileScorer] API Round-robin: profile availability check', {
        profileName: profile.name,
        available: availability.available,
        reason: availability.reason || 'none'
      });
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] API Round-robin: no available profiles');
    return { profile: null, newIndex: 0 };
  }

  // Get last used index from strategy (default to 0)
  const lastIndex = strategy.rotationIndex ?? 0;

  // Calculate next index (circular)
  const nextIndex = (lastIndex + 1) % availableProfiles.length;

  // Log index transition
  if (isDebugMode()) {
    console.log('[ProfileScorer] API Round-robin strategy: index transition', {
      lastIndex,
      nextIndex,
      availableProfilesCount: availableProfiles.length
    });
  }

  const selectedProfile = availableProfiles[nextIndex];

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Round-robin: selected profile', {
      profileName: selectedProfile.name,
      index: nextIndex
    });
  }

  // Log profile selection
  if (isDebugMode()) {
    console.log('[ProfileScorer] API Round-robin strategy: selected profile', {
      profileName: selectedProfile.name,
      profileId: selectedProfile.id,
      index: nextIndex
    });
  }

  return { profile: selectedProfile, newIndex: nextIndex };
}

/**
 * Least-used strategy for API profiles - select profile with lowest request count
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Filter to available profiles only
 * 3. Calculate usage score based on requestCount
 * 4. Sort by requestCount (ascending - lowest usage first)
 * 5. Return profile with minimum requestCount
 *
 * Usage Metrics:
 * - Primary metric: requestCount (number of requests made)
 * - Profiles with lower requestCount are preferred
 * - Missing usage data treated as 0 (prefer unused profiles)
 * - If request counts are equal, prefers profiles with higher quota limits
 *
 * @param profiles - All API profiles
 * @param strategy - Rotation strategy configuration
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Profile with lowest request count, or null if no available profiles
 */
function apiLeastUsedStrategy(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): APIProfile | null {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Least-used strategy: evaluating candidate profiles', {
      count: candidates.length
    });
  }

  // Filter to available profiles only
  const availableProfiles: APIProfile[] = [];
  const availabilityChecks: Array<{ profile: APIProfile; available: boolean; reason?: string }> = [];

  for (const profile of candidates) {
    const usage = getAPIProfileUsage(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);
    availabilityChecks.push({ profile, available: availability.available, reason: availability.reason });

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebugMode()) {
      console.warn('[ProfileScorer] API Least-used: profile availability check', {
        profileName: profile.name,
        available: availability.available,
        reason: availability.reason || 'none'
      });
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] API Least-used: no available profiles');
    return null;
  }

  // Calculate usage score for each profile
  interface APIProfileUsageScore {
    profile: APIProfile;
    usage: APIProfileUsage | null;
    score: number;
    requestCount: number;
    quotaLimit: number | null;
    usagePercent: number;
  }

  const scoredProfiles: APIProfileUsageScore[] = availableProfiles.map(profile => {
    const usage = getAPIProfileUsage(profile.id);

    // Missing usage data treated as 0 (prefer unused profiles)
    const requestCount = usage?.requestCount ?? 0;
    const quotaLimit = usage?.quotaLimit ?? null;

    // Calculate usage percentage (0 if no quota limit set)
    let usagePercent = 0;
    if (quotaLimit && quotaLimit > 0) {
      usagePercent = (requestCount / quotaLimit) * 100;
    }

    // Primary score is requestCount (lower is better)
    // If quota limits differ, also factor in usage percent as tiebreaker
    const score = requestCount + (usagePercent * 0.01);

    if (isDebugMode()) {
      console.warn('[ProfileScorer] API Least-used: profile score calculation', {
        profileName: profile.name,
        score,
        requestCount,
        quotaLimit,
        usagePercent: usagePercent.toFixed(2)
      });
    }

    return {
      profile,
      usage,
      score,
      requestCount,
      quotaLimit,
      usagePercent
    };
  });

  // Sort by score ascending (lowest usage first)
  scoredProfiles.sort((a, b) => a.score - b.score);

  const selectedProfile = scoredProfiles[0].profile;

  // Log usage scores for all profiles
  if (isDebugMode()) {
    console.log('[ProfileScorer] API Least-used strategy: profile usage scores', {
      profiles: scoredProfiles.map(sp => ({
        profileId: sp.profile.id,
        profileName: sp.profile.name,
        score: sp.score,
        requestCount: sp.requestCount,
        quotaLimit: sp.quotaLimit,
        usagePercent: sp.usagePercent.toFixed(2)
      })),
      availableCount: availableProfiles.length
    });
  }

  // Log profile selection
  if (isDebugMode()) {
    console.log('[ProfileScorer] API Least-used strategy: selected profile', {
      profileName: selectedProfile.name,
      profileId: selectedProfile.id,
      score: scoredProfiles[0].score,
      requestCount: scoredProfiles[0].requestCount,
      quotaLimit: scoredProfiles[0].quotaLimit,
      usagePercent: scoredProfiles[0].usagePercent.toFixed(2)
    });
  }

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Least-used: selected profile', {
      profileName: selectedProfile.name,
      score: scoredProfiles[0].score,
      requestCount: scoredProfiles[0].requestCount,
      usagePercent: scoredProfiles[0].usagePercent.toFixed(2)
    });
  }

  return selectedProfile;
}

/**
 * Random strategy for API profiles - select a random available profile
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Filter to available profiles only
 * 3. Randomly select one profile from available profiles
 * 4. Return the randomly selected profile
 *
 * This strategy provides unpredictability which can help:
 * - Distribute load evenly across API keys
 * - Avoid detection patterns from predictable switching
 * - Ensure all API keys get similar usage over time
 *
 * @param profiles - All API profiles
 * @param strategy - Rotation strategy configuration
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Randomly selected profile, or null if no available profiles
 */
function apiRandomStrategy(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): APIProfile | null {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Random strategy: evaluating candidate profiles', {
      count: candidates.length
    });
  }

  // Filter to available profiles only
  const availableProfiles: APIProfile[] = [];
  const availabilityChecks: Array<{ profile: APIProfile; available: boolean; reason?: string }> = [];

  for (const profile of candidates) {
    const usage = getAPIProfileUsage(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);
    availabilityChecks.push({ profile, available: availability.available, reason: availability.reason });

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebugMode()) {
      console.warn('[ProfileScorer] API Random: profile availability check', {
        profileName: profile.name,
        available: availability.available,
        reason: availability.reason || 'none'
      });
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] API Random: no available profiles');
    return null;
  }

  // Randomly select one profile
  const randomIndex = Math.floor(Math.random() * availableProfiles.length);
  const selectedProfile = availableProfiles[randomIndex];

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Random: selected profile', {
      profileName: selectedProfile.name,
      randomIndex,
      availableProfilesCount: availableProfiles.length
    });
  }

  // Log profile selection with details
  if (isDebugMode()) {
    console.log('[ProfileScorer] API Random strategy: selected profile', {
      profileName: selectedProfile.name,
      profileId: selectedProfile.id,
      randomIndex,
      availableProfilesCount: availableProfiles.length
    });
  }

  return selectedProfile;
}

/**
 * Weighted strategy for API profiles
 * @TODO: Implement in subtask-3-5
 */
/**
 * Weighted strategy for API profiles - select profile based on configured weights
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Filter to available profiles only
 * 3. Get weights from strategy.weights (Record<string, number>)
 * 4. Build weighted list with cumulative weights
 * 5. Perform weighted random selection:
 *    - Generate random value between 0 and totalWeight
 *    - Find first profile where cumulativeWeight >= randomValue
 * 6. Return the selected profile
 *
 * Weight Distribution:
 * - Each profile gets a weight (default: 1 if not specified)
 * - Zero or negative weights are treated as 1
 * - Higher weights = higher probability of selection
 * - Example: weights = { "profile1": 3, "profile2": 1 } means profile1 is 3x more likely
 *
 * @param profiles - All API profiles
 * @param strategy - Rotation strategy configuration (contains weights)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Profile selected based on weight distribution, or null if no available profiles
 */
function apiWeightedStrategy(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): APIProfile | null {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Weighted strategy: evaluating candidate profiles', {
      count: candidates.length
    });
  }

  // Filter to available profiles only
  const availableProfiles: APIProfile[] = [];
  const availabilityChecks: Array<{ profile: APIProfile; available: boolean; reason?: string }> = [];

  for (const profile of candidates) {
    const usage = getAPIProfileUsage(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);
    availabilityChecks.push({ profile, available: availability.available, reason: availability.reason });

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebugMode()) {
      console.warn('[ProfileScorer] API Weighted: profile availability check', {
        profileName: profile.name,
        available: availability.available,
        reason: availability.reason || 'none'
      });
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] API Weighted: no available profiles');
    return null;
  }

  // Get weights from strategy configuration
  const configuredWeights = strategy.weights ?? {};

  // Build weighted list with cumulative weights
  interface WeightedAPIProfile {
    profile: APIProfile;
    weight: number;
    cumulativeWeight: number;
  }

  const weightedProfiles: WeightedAPIProfile[] = [];
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

    if (isDebugMode()) {
      console.warn('[ProfileScorer] API Weighted: profile weight calculation', {
        profileName: profile.name,
        weight,
        cumulativeWeight: totalWeight
      });
    }
  }

  // Weighted random selection
  const randomValue = Math.random() * totalWeight;

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Weighted: random value', {
      randomValue: randomValue.toFixed(2),
      totalWeight
    });
  }

  // Find the profile where cumulativeWeight >= randomValue
  const selectedProfile = weightedProfiles.find(wp => wp.cumulativeWeight >= randomValue)?.profile ?? null;

  // Log weight distribution for all profiles
  if (isDebugMode()) {
    console.log('[ProfileScorer] API Weighted strategy: weight distribution', {
      profiles: weightedProfiles.map(wp => ({
        profileId: wp.profile.id,
        profileName: wp.profile.name,
        weight: wp.weight,
        cumulativeWeight: wp.cumulativeWeight,
        probabilityPercent: totalWeight > 0 ? ((wp.weight / totalWeight) * 100).toFixed(2) : '0'
      })),
      totalWeight,
      availableCount: availableProfiles.length
    });
  }

  if (selectedProfile) {
    const selectedWeighted = weightedProfiles.find(wp => wp.profile.id === selectedProfile.id);

    // Log profile selection with details
    if (isDebugMode()) {
      console.log('[ProfileScorer] API Weighted strategy: selected profile', {
        profileName: selectedProfile.name,
        profileId: selectedProfile.id,
        randomValue: randomValue.toFixed(2),
        selectedWeight: selectedWeighted?.weight,
        cumulativeWeight: selectedWeighted?.cumulativeWeight,
        probabilityPercent: selectedWeighted ? ((selectedWeighted.weight / totalWeight) * 100).toFixed(2) : '0'
      });
    }

    if (isDebugMode()) {
      console.warn('[ProfileScorer] API Weighted: selected profile', {
        profileName: selectedProfile.name,
        randomValue: randomValue.toFixed(2),
        selectedWeight: selectedWeighted?.weight,
        cumulativeWeight: selectedWeighted?.cumulativeWeight,
        probabilityPercent: selectedWeighted ? ((selectedWeighted.weight / totalWeight) * 100).toFixed(2) : '0'
      });
    }
  } else {
    if (isDebugMode()) {
      console.log('[ProfileScorer] API Weighted strategy: no profile selected (unexpected - this should not happen)');
    }
  }

  return selectedProfile;
}

/**
 * Time-based strategy for API profiles - rotate profiles at configured time intervals
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Filter to available profiles only
 * 3. Get current profile and last rotation time from strategy state
 * 4. Check if rotation interval has elapsed (strategy.rotationInterval in seconds)
 * 5. If interval elapsed: rotate to next profile in circular fashion, update state
 * 6. If interval not elapsed: continue using current profile
 * 7. Return the selected profile and updated state tracking
 *
 * State Tracking (stored in APIProfileRotationStrategy):
 * - timeBasedCurrentProfile: ID of profile currently being used
 * - timeBasedLastRotationTime: ISO timestamp of last rotation
 * - timeBasedProfileIndex: Index of current profile in available profiles list
 *
 * Rotation Behavior:
 * - Uses rotationInterval from strategy (default: 300 seconds = 5 minutes)
 * - Rotates sequentially through available profiles (similar to round-robin)
 * - Resets to first profile if current profile becomes unavailable
 * - Updates state tracking on each rotation
 *
 * @param profiles - All API profiles
 * @param strategy - Rotation strategy configuration (contains rotationInterval and state tracking fields)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Object with selected profile and updated state tracking, or null if no available profiles
 */
function apiTimeBasedStrategy(
  profiles: APIProfile[],
  strategy: APIProfileRotationStrategy,
  excludeProfileId?: string
): APITimeBasedResult {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return { profile: null, currentProfileId: undefined, lastRotationTime: undefined, profileIndex: 0 };
  }

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Time-based strategy: evaluating candidate profiles', {
      count: candidates.length
    });
  }

  // Filter to available profiles only
  const availableProfiles: APIProfile[] = [];
  const availabilityChecks: Array<{ profile: APIProfile; available: boolean; reason?: string }> = [];

  for (const profile of candidates) {
    const usage = getAPIProfileUsage(profile.id);
    const availability = checkAPIProfileAvailability(profile, usage, strategy);
    availabilityChecks.push({ profile, available: availability.available, reason: availability.reason });

    if (availability.available) {
      availableProfiles.push(profile);
    }

    if (isDebugMode()) {
      console.warn('[ProfileScorer] API Time-based: profile availability check', {
        profileName: profile.name,
        available: availability.available,
        reason: availability.reason || 'none'
      });
    }
  }

  if (availableProfiles.length === 0) {
    console.warn('[ProfileScorer] API Time-based: no available profiles');
    return { profile: null, currentProfileId: undefined, lastRotationTime: undefined, profileIndex: 0 };
  }

  const now = new Date();
  const rotationIntervalSeconds = strategy.rotationInterval ?? 300; // Default: 5 minutes
  const rotationIntervalMs = rotationIntervalSeconds * 1000;

  // Get state tracking from strategy
  const currentProfileId = strategy.timeBasedCurrentProfile;
  const lastRotationTimeStr = strategy.timeBasedLastRotationTime;
  let currentIndex = strategy.timeBasedProfileIndex ?? 0;

  // Initialize with first available profile as default
  let selectedProfile: APIProfile = availableProfiles[0];
  let shouldRotate = false;
  let newProfileIndex = currentIndex;
  let newCurrentProfileId = currentProfileId;
  let newLastRotationTime = lastRotationTimeStr;

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Time-based: configuration and state', {
      rotationIntervalSeconds,
      rotationIntervalMs,
      currentProfileId: currentProfileId || 'none',
      currentIndex,
      lastRotationTime: lastRotationTimeStr || 'none'
    });
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

      // Log decision to continue with current profile
      if (isDebugMode()) {
        console.log('[ProfileScorer] API Time-based strategy: continuing with current profile (interval not elapsed)', {
          profileId: currentProfile.id,
          profileName: currentProfile.name,
          elapsedMs,
          rotationIntervalMs,
          timeUntilRotationMs: rotationIntervalMs - elapsedMs
        });
      }

      if (isDebugMode()) {
        console.warn('[ProfileScorer] API Time-based: interval not elapsed, continuing with current profile', {
          profileName: currentProfile.name,
          elapsedMs,
          rotationIntervalMs,
          remainingMs: rotationIntervalMs - elapsedMs
        });
      }
    } else if (currentProfile && elapsedMs >= rotationIntervalMs) {
      // Interval elapsed, rotate to next profile
      shouldRotate = true;

      // Log decision to rotate (interval elapsed)
      if (isDebugMode()) {
        console.log('[ProfileScorer] API Time-based strategy: rotation interval elapsed, rotating profile', {
          currentProfileId: currentProfile.id,
          currentProfileName: currentProfile.name,
          elapsedMs,
          rotationIntervalMs,
          overdueMs: elapsedMs - rotationIntervalMs
        });
      }

      if (isDebugMode()) {
        console.warn('[ProfileScorer] API Time-based: interval elapsed, rotating to next profile', {
          currentProfileName: currentProfile.name,
          elapsedMs,
          rotationIntervalMs,
          overdueMs: elapsedMs - rotationIntervalMs
        });
      }
    } else {
      // Current profile no longer available, reset to first profile
      shouldRotate = true;
      currentIndex = 0; // Reset index
      newProfileIndex = 0;

      // Log decision to reset (current profile unavailable)
      if (isDebugMode()) {
        console.log('[ProfileScorer] API Time-based strategy: current profile no longer available, resetting to first available profile', {
          previousProfileId: currentProfileId,
          reason: 'profile not in available list'
        });
      }

      if (isDebugMode()) {
        console.warn('[ProfileScorer] API Time-based: current profile no longer available, resetting to first available profile', {
          previousProfileId: currentProfileId,
          reason: 'profile not in available list'
        });
      }
    }
  } else {
    // No state tracking, start with first profile
    shouldRotate = true;
    currentIndex = 0;
    newProfileIndex = 0;

    // Log initial state (first time using time-based strategy)
    if (isDebugMode()) {
      console.log('[ProfileScorer] API Time-based strategy: no state tracking, initializing with first available profile', {
        initialProfileId: availableProfiles[0].id,
        initialProfileName: availableProfiles[0].name,
        rotationIntervalSeconds
      });
    }

    if (isDebugMode()) {
      console.warn('[ProfileScorer] API Time-based: no state tracking, starting with first available profile', {
        initialProfileId: availableProfiles[0].id,
        initialProfileName: availableProfiles[0].name,
        rotationIntervalSeconds
      });
    }
  }

  if (shouldRotate) {
    // Calculate next index (circular)
    newProfileIndex = (currentIndex + 1) % availableProfiles.length;
    selectedProfile = availableProfiles[newProfileIndex];
    newCurrentProfileId = selectedProfile.id;
    newLastRotationTime = now.toISOString();

    // Log rotation execution with state tracking updates
    if (isDebugMode()) {
      console.log('[ProfileScorer] API Time-based strategy: profile rotation completed with state updates', {
        previousIndex: currentIndex,
        newIndex: newProfileIndex,
        selectedProfileId: selectedProfile.id,
        selectedProfileName: selectedProfile.name,
        stateUpdates: {
          currentProfileId: newCurrentProfileId,
          lastRotationTime: newLastRotationTime,
          profileIndex: newProfileIndex
        },
        availableProfilesCount: availableProfiles.length
      });
    }

    if (isDebugMode()) {
      console.warn('[ProfileScorer] API Time-based: rotated to profile', {
        profileName: selectedProfile.name,
        profileIndex: newProfileIndex,
        availableProfilesCount: availableProfiles.length
      });
    }
  } else {
    // Log state tracking when continuing with current profile
    if (isDebugMode()) {
      console.log('[ProfileScorer] API Time-based strategy: state tracking (no rotation)', {
        currentProfileId: selectedProfile.id,
        currentProfileName: selectedProfile.name,
        stateUpdates: {
          currentProfileId: newCurrentProfileId,
          lastRotationTime: newLastRotationTime,
          profileIndex: currentIndex
        }
      });
    }
  }

  if (isDebugMode()) {
    console.warn('[ProfileScorer] API Time-based: selected profile', {
      profileName: selectedProfile.name,
      state: {
        currentProfileId: newCurrentProfileId,
        profileIndex: newProfileIndex,
        lastRotationTime: newLastRotationTime
      }
    });
  }

  return {
    profile: selectedProfile,
    currentProfileId: newCurrentProfileId,
    lastRotationTime: newLastRotationTime,
    profileIndex: newProfileIndex
  };
}

/**
 * Result from profile selection with fallback
 */
export interface ProfileWithFallbackResult {
  /** Selected profile (either API or OAuth, or null if none available) */
  profile: APIProfile | ClaudeProfile | null;
  /** Type of profile selected ('api', 'oauth', or null) */
  profileType: 'api' | 'oauth' | null;
  /** Reason for selection */
  reason: string;
}

/**
 * Get the best available profile with fallback from API to OAuth
 *
 * This function tries to select an API profile first, and falls back to OAuth profiles
 * if configured to do so and no API profiles are available.
 *
 * @param apiProfiles - All API profiles
 * @param oauthProfiles - All OAuth profiles
 * @param apiStrategy - API profile rotation strategy
 * @param oauthSettings - OAuth auto-switch settings
 * @param priorityOrder - OAuth profile priority order
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @returns Profile selection result with profile, type, and reason
 */
export function getBestAvailableProfileWithFallback(
  apiProfiles: APIProfile[],
  oauthProfiles: ClaudeProfile[],
  apiStrategy: APIProfileRotationStrategy,
  oauthSettings: ClaudeAutoSwitchSettings,
  priorityOrder: string[],
  excludeProfileId?: string
): ProfileWithFallbackResult {
  // Try API profiles first
  const apiResult = getBestAvailableAPIProfile(apiProfiles, apiStrategy, excludeProfileId);

  if (apiResult.profile) {
    return {
      profile: apiResult.profile,
      profileType: 'api',
      reason: 'API profile available'
    };
  }

  // No API profile available - check if we should fallback to OAuth
  if (!apiStrategy.fallbackToOAuth) {
    return {
      profile: null,
      profileType: null,
      reason: 'No API profile available and OAuth fallback disabled'
    };
  }

  // Check if OAuth profiles are configured
  if (oauthProfiles.length === 0) {
    return {
      profile: null,
      profileType: null,
      reason: 'Fallback enabled but no OAuth profiles configured'
    };
  }

  // Try OAuth profiles
  const oauthResult = getBestAvailableProfile(oauthProfiles, oauthSettings, excludeProfileId, priorityOrder);

  if (oauthResult.profile) {
    return {
      profile: oauthResult.profile,
      profileType: 'oauth',
      reason: 'Fallback to OAuth profile (no API profiles available)'
    };
  }

  // No profiles available at all
  return {
    profile: null,
    profileType: null,
    reason: 'No profiles available (neither API nor OAuth)'
  };
}
