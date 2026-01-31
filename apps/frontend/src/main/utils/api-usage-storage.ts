/**
 * API Profile Usage Storage Module
 * Handles persistence of API profile usage data and rotation strategy settings
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { app } from 'electron';
import { join } from 'path';
import type { APIProfileUsage, APIProfileRotationStrategy } from '../../shared/types';

/**
 * Directory for API profile usage data
 */
function getStorageDir(): string {
  const userData = app.getPath('userData');
  return join(userData, 'auto-claude');
}

/**
 * Storage file paths
 */
function getUsageFilePath(): string {
  return join(getStorageDir(), 'api-profile-usage.json');
}

function getRotationStrategyFilePath(): string {
  return join(getStorageDir(), 'api-profile-rotation.json');
}

export const USAGE_STORE_VERSION = 1;
export const ROTATION_STORE_VERSION = 1;

/**
 * Default rotation strategy settings
 */
export const DEFAULT_ROTATION_STRATEGY: APIProfileRotationStrategy = {
  enabled: false,
  priorityOrder: [],
  fallbackToOAuth: false,
  thresholds: {
    maxUsagePercent: 90,
    rateLimitBackoff: 60
  }
};

/**
 * Internal storage format for API profile usage data
 */
export interface APIProfileUsageStore {
  version: number;
  profiles: Record<string, APIProfileUsage>;
}

/**
 * Internal storage format for rotation strategy
 */
export interface APIProfileRotationStore {
  version: number;
  strategy: APIProfileRotationStrategy;
}

/**
 * Ensure storage directory exists
 */
function ensureStorageDir(): void {
  const dir = getStorageDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Parse usage data from JSON with validation
 */
function parseUsageData(data: Record<string, unknown>): APIProfileUsageStore | null {
  if (data.version === USAGE_STORE_VERSION) {
    const profiles = data.profiles as Record<string, APIProfileUsage>;

    // Validate each profile's usage data
    for (const [profileId, usage] of Object.entries(profiles)) {
      // Ensure required fields exist
      if (typeof usage.requestCount !== 'number') {
        console.warn(`[APIUsageStorage] Invalid requestCount for profile ${profileId}, resetting to 0`);
        usage.requestCount = 0;
      }
      if (typeof usage.tokenUsage !== 'number') {
        console.warn(`[APIUsageStorage] Invalid tokenUsage for profile ${profileId}, resetting to 0`);
        usage.tokenUsage = 0;
      }
      if (typeof usage.lastRequestTime !== 'number') {
        console.warn(`[APIUsageStorage] Invalid lastRequestTime for profile ${profileId}, resetting to now`);
        usage.lastRequestTime = Date.now();
      }
      if (typeof usage.isRateLimited !== 'boolean') {
        console.warn(`[APIUsageStorage] Invalid isRateLimited for profile ${profileId}, resetting to false`);
        usage.isRateLimited = false;
      }
    }

    return {
      version: data.version as number,
      profiles
    };
  }

  return null;
}

/**
 * Load API profile usage data from disk
 */
export function loadUsageStore(): APIProfileUsageStore | null {
  try {
    const filePath = getUsageFilePath();
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      return parseUsageData(data);
    }
  } catch (error) {
    console.error('[APIUsageStorage] Error loading usage data:', error);
  }

  return null;
}

/**
 * Load API profile usage data from disk (async, non-blocking)
 * Use this version for initialization to avoid blocking the main process.
 */
export async function loadUsageStoreAsync(): Promise<APIProfileUsageStore | null> {
  try {
    const filePath = getUsageFilePath();
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return parseUsageData(data);
  } catch (error) {
    // ENOENT is expected if file doesn't exist yet
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[APIUsageStorage] Error loading usage data:', error);
    }
  }

  return null;
}

/**
 * Save API profile usage data to disk
 */
export function saveUsageStore(data: APIProfileUsageStore): void {
  try {
    ensureStorageDir();
    const filePath = getUsageFilePath();
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('[APIUsageStorage] Error saving usage data:', error);
  }
}

/**
 * Get usage data for a specific profile
 */
export function getProfileUsage(profileId: string): APIProfileUsage | null {
  const store = loadUsageStore();
  if (store && store.profiles[profileId]) {
    return store.profiles[profileId];
  }
  return null;
}

/**
 * Update or create usage data for a specific profile
 */
export function updateProfileUsage(profileId: string, updates: Partial<APIProfileUsage>): void {
  const store = loadUsageStore() || {
    version: USAGE_STORE_VERSION,
    profiles: {}
  };

  const currentUsage = store.profiles[profileId] || {
    profileId,
    requestCount: 0,
    tokenUsage: 0,
    lastRequestTime: Date.now(),
    isRateLimited: false
  };

  // Merge updates with current data
  const updatedUsage: APIProfileUsage = {
    ...currentUsage,
    ...updates,
    profileId // Ensure profileId is always correct
  };

  store.profiles[profileId] = updatedUsage;
  saveUsageStore(store);
}

/**
 * Reset usage data for a specific profile
 */
export function resetProfileUsage(profileId: string): void {
  const store = loadUsageStore();
  if (store && store.profiles[profileId]) {
    delete store.profiles[profileId];
    saveUsageStore(store);
  }
}

/**
 * Clear all usage data
 */
export function clearAllUsage(): void {
  const store: APIProfileUsageStore = {
    version: USAGE_STORE_VERSION,
    profiles: {}
  };
  saveUsageStore(store);
}

/**
 * Parse rotation strategy from JSON with validation
 */
function parseRotationStrategy(data: Record<string, unknown>): APIProfileRotationStore | null {
  if (data.version === ROTATION_STORE_VERSION) {
    const strategy = data.strategy as APIProfileRotationStrategy;

    // Validate strategy field with default to 'priority' for backward compatibility
    const validStrategies = ['priority', 'round-robin', 'least-used', 'random', 'weighted', 'time-based'];
    if (strategy.strategy && !validStrategies.includes(strategy.strategy)) {
      console.warn(`[APIUsageStorage] Invalid strategy "${strategy.strategy}", defaulting to 'priority'`);
      strategy.strategy = 'priority';
    } else if (!strategy.strategy) {
      // Default to 'priority' for backward compatibility with existing configs
      strategy.strategy = 'priority';
    }

    // Validate strategy structure
    if (typeof strategy.enabled !== 'boolean') {
      console.warn('[APIUsageStorage] Invalid enabled field, resetting to false');
      strategy.enabled = false;
    }
    if (!Array.isArray(strategy.priorityOrder)) {
      console.warn('[APIUsageStorage] Invalid priorityOrder, resetting to empty array');
      strategy.priorityOrder = [];
    }
    if (typeof strategy.fallbackToOAuth !== 'boolean') {
      console.warn('[APIUsageStorage] Invalid fallbackToOAuth, resetting to false');
      strategy.fallbackToOAuth = false;
    }
    if (!strategy.thresholds || typeof strategy.thresholds !== 'object') {
      console.warn('[APIUsageStorage] Invalid thresholds, resetting to defaults');
      strategy.thresholds = DEFAULT_ROTATION_STRATEGY.thresholds;
    } else {
      if (typeof strategy.thresholds.maxUsagePercent !== 'number') {
        strategy.thresholds.maxUsagePercent = DEFAULT_ROTATION_STRATEGY.thresholds.maxUsagePercent;
      }
      if (typeof strategy.thresholds.rateLimitBackoff !== 'number') {
        strategy.thresholds.rateLimitBackoff = DEFAULT_ROTATION_STRATEGY.thresholds.rateLimitBackoff;
      }
    }

    // Validate weights object if present
    if (strategy.weights !== undefined && strategy.weights !== null) {
      if (typeof strategy.weights !== 'object' || Array.isArray(strategy.weights)) {
        console.warn('[APIUsageStorage] Invalid weights (must be an object), resetting to empty object');
        strategy.weights = {};
      } else {
        // Validate each weight entry
        for (const [profileId, weight] of Object.entries(strategy.weights)) {
          if (typeof weight !== 'number' || isNaN(weight)) {
            console.warn(`[APIUsageStorage] Invalid weight for profile ${profileId} (must be a number), removing entry`);
            delete strategy.weights[profileId];
          } else if (weight <= 0) {
            console.warn(`[APIUsageStorage] Invalid weight for profile ${profileId} (must be positive), removing entry`);
            delete strategy.weights[profileId];
          }
        }
      }
    }

    // Validate rotationIndex for round-robin strategy
    if (strategy.rotationIndex !== undefined && strategy.rotationIndex !== null) {
      if (typeof strategy.rotationIndex !== 'number' || isNaN(strategy.rotationIndex)) {
        console.warn('[APIUsageStorage] Invalid rotationIndex (must be a number), resetting to 0');
        strategy.rotationIndex = 0;
      } else if (strategy.rotationIndex < 0) {
        console.warn('[APIUsageStorage] Invalid rotationIndex (must be non-negative), resetting to 0');
        strategy.rotationIndex = 0;
      }
    }

    // Validate rotationInterval for time-based strategy
    if (strategy.rotationInterval !== undefined && strategy.rotationInterval !== null) {
      if (typeof strategy.rotationInterval !== 'number' || isNaN(strategy.rotationInterval)) {
        console.warn('[APIUsageStorage] Invalid rotationInterval (must be a number), resetting to 300');
        strategy.rotationInterval = 300;
      } else if (strategy.rotationInterval <= 0) {
        console.warn('[APIUsageStorage] Invalid rotationInterval (must be positive), resetting to 300');
        strategy.rotationInterval = 300;
      }
    }

    return {
      version: data.version as number,
      strategy
    };
  }

  return null;
}

/**
 * Load rotation strategy from disk
 */
export function loadRotationStrategy(): APIProfileRotationStrategy | null {
  try {
    const filePath = getRotationStrategyFilePath();
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      const store = parseRotationStrategy(data);
      return store?.strategy || null;
    }
  } catch (error) {
    console.error('[APIUsageStorage] Error loading rotation strategy:', error);
  }

  return null;
}

/**
 * Load rotation strategy from disk (async, non-blocking)
 */
export async function loadRotationStrategyAsync(): Promise<APIProfileRotationStrategy | null> {
  try {
    const filePath = getRotationStrategyFilePath();
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    const store = parseRotationStrategy(data);
    return store?.strategy || null;
  } catch (error) {
    // ENOENT is expected if file doesn't exist yet
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[APIUsageStorage] Error loading rotation strategy:', error);
    }
  }

  return null;
}

/**
 * Save rotation strategy to disk
 */
export function saveRotationStrategy(strategy: APIProfileRotationStrategy): void {
  try {
    ensureStorageDir();
    const filePath = getRotationStrategyFilePath();
    const store: APIProfileRotationStore = {
      version: ROTATION_STORE_VERSION,
      strategy
    };
    writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
  } catch (error) {
    console.error('[APIUsageStorage] Error saving rotation strategy:', error);
  }
}

/**
 * Get rotation strategy with defaults
 */
export function getRotationStrategyOrDefault(): APIProfileRotationStrategy {
  const strategy = loadRotationStrategy();
  return strategy || DEFAULT_ROTATION_STRATEGY;
}
