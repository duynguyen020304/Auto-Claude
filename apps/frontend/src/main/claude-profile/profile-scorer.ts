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
