/**
 * Tests for api-usage-storage.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIProfileUsage } from '../../../shared/types/profile';

// Mock Electron app.getPath
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') {
        return '/mock/userdata';
      }
      return '/mock/path';
    })
  }
}));

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn()
}));

// Import mocked functions
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';

// Import module under test AFTER mocks are set up
import {
  loadUsageStore,
  loadUsageStoreAsync,
  saveUsageStore,
  getProfileUsage,
  updateProfileUsage,
  resetProfileUsage,
  clearAllUsage,
  loadRotationStrategy,
  loadRotationStrategyAsync,
  saveRotationStrategy,
  getRotationStrategyOrDefault,
  DEFAULT_ROTATION_STRATEGY
} from '../api-usage-storage';

describe('api-usage-storage', () => {
  const mockUsageFilePath = '/mock/userdata/auto-claude/api-profile-usage.json';
  const mockRotationFilePath = '/mock/userdata/auto-claude/api-profile-rotation.json';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Usage Store', () => {
    describe('loadUsageStore', () => {
      it('should return null when file does not exist', () => {
        vi.mocked(existsSync).mockReturnValue(false);

        const result = loadUsageStore();

        expect(result).toBeNull();
      });

      it('should return null when file is corrupted JSON', () => {
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue('invalid json{');

        const result = loadUsageStore();

        expect(result).toBeNull();
      });

      it('should load valid usage store', () => {
        const mockUsageData = {
          version: 1,
          profiles: {
            'profile-1': {
              profileId: 'profile-1',
              requestCount: 100,
              tokenUsage: 50000,
              lastRequestTime: Date.now(),
              isRateLimited: false
            }
          }
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockUsageData));

        const result = loadUsageStore();

        expect(result).toEqual(mockUsageData);
      });

      it('should validate and fix invalid usage data', () => {
        const invalidData = {
          version: 1,
          profiles: {
            'profile-1': {
              profileId: 'profile-1',
              requestCount: 'invalid' as unknown as number,
              tokenUsage: null as unknown as number,
              lastRequestTime: 'invalid' as unknown as number,
              isRateLimited: 'yes' as unknown as boolean
            }
          }
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(invalidData));

        const result = loadUsageStore();

        expect(result).not.toBeNull();
        expect(result?.profiles['profile-1'].requestCount).toBe(0);
        expect(result?.profiles['profile-1'].tokenUsage).toBe(0);
        expect(result?.profiles['profile-1'].isRateLimited).toBe(false);
      });
    });

    describe('loadUsageStoreAsync', () => {
      it('should return null when file does not exist', async () => {
        vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

        const result = await loadUsageStoreAsync();

        expect(result).toBeNull();
      });

      it('should load valid usage store asynchronously', async () => {
        const mockUsageData = {
          version: 1,
          profiles: {
            'profile-1': {
              profileId: 'profile-1',
              requestCount: 100,
              tokenUsage: 50000,
              lastRequestTime: Date.now(),
              isRateLimited: false
            }
          }
        };

        vi.mocked(readFile).mockResolvedValue(
          Buffer.from(JSON.stringify(mockUsageData))
        );

        const result = await loadUsageStoreAsync();

        expect(result).toEqual(mockUsageData);
      });
    });

    describe('saveUsageStore', () => {
      it('should save usage data to disk', () => {
        const mockData = {
          version: 1,
          profiles: {
            'profile-1': {
              profileId: 'profile-1',
              requestCount: 100,
              tokenUsage: 50000,
              lastRequestTime: Date.now(),
              isRateLimited: false
            }
          }
        };

        // Mock existsSync to return false so mkdirSync gets called
        vi.mocked(existsSync).mockReturnValue(false);
        vi.mocked(mkdirSync).mockReturnValue(undefined);
        vi.mocked(writeFileSync).mockReturnValue(undefined);

        saveUsageStore(mockData);

        expect(vi.mocked(existsSync)).toHaveBeenCalled();
        expect(vi.mocked(mkdirSync)).toHaveBeenCalled();
        expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
          mockUsageFilePath,
          JSON.stringify(mockData, null, 2),
          'utf-8'
        );
      });
    });

    describe('getProfileUsage', () => {
      it('should return usage for existing profile', () => {
        const mockUsage: APIProfileUsage = {
          profileId: 'profile-1',
          requestCount: 100,
          tokenUsage: 50000,
          lastRequestTime: Date.now(),
          isRateLimited: false
        };

        const mockStore = {
          version: 1,
          profiles: {
            'profile-1': mockUsage
          }
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStore));

        const result = getProfileUsage('profile-1');

        expect(result).toEqual(mockUsage);
      });

      it('should return null for non-existent profile', () => {
        const mockStore = {
          version: 1,
          profiles: {}
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStore));

        const result = getProfileUsage('profile-1');

        expect(result).toBeNull();
      });

      it('should return null when store does not exist', () => {
        vi.mocked(existsSync).mockReturnValue(false);

        const result = getProfileUsage('profile-1');

        expect(result).toBeNull();
      });
    });

    describe('updateProfileUsage', () => {
      it('should create new usage data for new profile', () => {
        vi.mocked(existsSync).mockReturnValue(false);
        vi.mocked(mkdirSync).mockReturnValue(undefined);
        vi.mocked(writeFileSync).mockReturnValue(undefined);

        updateProfileUsage('profile-1', {
          requestCount: 10,
          tokenUsage: 5000
        });

        expect(writeFileSync).toHaveBeenCalled();
        const savedData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
        expect(savedData.profiles['profile-1']).toBeDefined();
        expect(savedData.profiles['profile-1'].requestCount).toBe(10);
        expect(savedData.profiles['profile-1'].tokenUsage).toBe(5000);
      });

      it('should update existing usage data', () => {
        const existingStore = {
          version: 1,
          profiles: {
            'profile-1': {
              profileId: 'profile-1',
              requestCount: 100,
              tokenUsage: 50000,
              lastRequestTime: Date.now(),
              isRateLimited: false
            }
          }
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(existingStore));
        vi.mocked(mkdirSync).mockReturnValue(undefined);
        vi.mocked(writeFileSync).mockReturnValue(undefined);

        updateProfileUsage('profile-1', {
          requestCount: 110,
          tokenUsage: 55000
        });

        expect(writeFileSync).toHaveBeenCalled();
        const savedData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
        expect(savedData.profiles['profile-1'].requestCount).toBe(110);
        expect(savedData.profiles['profile-1'].tokenUsage).toBe(55000);
      });
    });

    describe('resetProfileUsage', () => {
      it('should remove usage data for specific profile', () => {
        const existingStore = {
          version: 1,
          profiles: {
            'profile-1': {
              profileId: 'profile-1',
              requestCount: 100,
              tokenUsage: 50000,
              lastRequestTime: Date.now(),
              isRateLimited: false
            },
            'profile-2': {
              profileId: 'profile-2',
              requestCount: 50,
              tokenUsage: 25000,
              lastRequestTime: Date.now(),
              isRateLimited: false
            }
          }
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(existingStore));
        vi.mocked(writeFileSync).mockReturnValue(undefined);

        resetProfileUsage('profile-1');

        expect(writeFileSync).toHaveBeenCalled();
        const savedData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
        expect(savedData.profiles['profile-1']).toBeUndefined();
        expect(savedData.profiles['profile-2']).toBeDefined();
      });
    });

    describe('clearAllUsage', () => {
      it('should clear all usage data', () => {
        vi.mocked(mkdirSync).mockReturnValue(undefined);
        vi.mocked(writeFileSync).mockReturnValue(undefined);

        clearAllUsage();

        expect(writeFileSync).toHaveBeenCalled();
        const savedData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
        expect(savedData.profiles).toEqual({});
      });
    });
  });

  describe('Rotation Strategy Store', () => {
    describe('loadRotationStrategy', () => {
      it('should return null when file does not exist', () => {
        vi.mocked(existsSync).mockReturnValue(false);

        const result = loadRotationStrategy();

        expect(result).toBeNull();
      });

      it('should return null when file is corrupted JSON', () => {
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue('invalid json{');

        const result = loadRotationStrategy();

        expect(result).toBeNull();
      });

      it('should load valid rotation strategy', () => {
        const mockStrategy = {
          enabled: true,
          priorityOrder: ['profile-1', 'profile-2'],
          fallbackToOAuth: true,
          thresholds: {
            maxUsagePercent: 85,
            rateLimitBackoff: 120
          }
        };

        const mockStore = {
          version: 1,
          strategy: mockStrategy
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStore));

        const result = loadRotationStrategy();

        // Strategy field should be added with default value for backward compatibility
        expect(result).toEqual({
          ...mockStrategy,
          strategy: 'priority'
        });
      });

      it('should validate and fix invalid strategy data', () => {
        const invalidStrategy = {
          enabled: 'yes' as unknown as boolean,
          priorityOrder: 'invalid' as unknown as string[],
          fallbackToOAuth: 'no' as unknown as boolean,
          thresholds: 'invalid' as unknown as { maxUsagePercent: number; rateLimitBackoff: number }
        };

        const mockStore = {
          version: 1,
          strategy: invalidStrategy
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStore));

        const result = loadRotationStrategy();

        expect(result).not.toBeNull();
        expect(result?.enabled).toBe(false);
        expect(result?.priorityOrder).toEqual([]);
        expect(result?.fallbackToOAuth).toBe(false);
        expect(result?.thresholds).toEqual(DEFAULT_ROTATION_STRATEGY.thresholds);
      });

      it('should validate valid weights object', () => {
        const strategyWithWeights = {
          enabled: true,
          priorityOrder: ['profile-1', 'profile-2'],
          fallbackToOAuth: false,
          thresholds: {
            maxUsagePercent: 90,
            rateLimitBackoff: 60
          },
          weights: {
            'profile-1': 10,
            'profile-2': 5
          }
        };

        const mockStore = {
          version: 1,
          strategy: strategyWithWeights
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStore));

        const result = loadRotationStrategy();

        expect(result).not.toBeNull();
        expect(result?.weights).toEqual({ 'profile-1': 10, 'profile-2': 5 });
      });

      it('should reset invalid weights (array) to empty object', () => {
        const strategyWithInvalidWeights = {
          enabled: true,
          priorityOrder: ['profile-1'],
          fallbackToOAuth: false,
          thresholds: {
            maxUsagePercent: 90,
            rateLimitBackoff: 60
          },
          weights: ['invalid', 'array'] as unknown as Record<string, number>
        };

        const mockStore = {
          version: 1,
          strategy: strategyWithInvalidWeights
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStore));

        const result = loadRotationStrategy();

        expect(result).not.toBeNull();
        expect(result?.weights).toEqual({});
      });

      it('should remove invalid weight entries (non-numeric values)', () => {
        const strategyWithInvalidWeightValues = {
          enabled: true,
          priorityOrder: ['profile-1', 'profile-2', 'profile-3'],
          fallbackToOAuth: false,
          thresholds: {
            maxUsagePercent: 90,
            rateLimitBackoff: 60
          },
          weights: {
            'profile-1': 10,
            'profile-2': 'invalid' as unknown as number,
            'profile-3': 5
          }
        };

        const mockStore = {
          version: 1,
          strategy: strategyWithInvalidWeightValues
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStore));

        const result = loadRotationStrategy();

        expect(result).not.toBeNull();
        expect(result?.weights).toEqual({ 'profile-1': 10, 'profile-3': 5 });
      });

      it('should remove invalid weight entries (non-positive values)', () => {
        const strategyWithInvalidWeightValues = {
          enabled: true,
          priorityOrder: ['profile-1', 'profile-2', 'profile-3', 'profile-4'],
          fallbackToOAuth: false,
          thresholds: {
            maxUsagePercent: 90,
            rateLimitBackoff: 60
          },
          weights: {
            'profile-1': 10,
            'profile-2': 0,
            'profile-3': -5,
            'profile-4': 5
          }
        };

        const mockStore = {
          version: 1,
          strategy: strategyWithInvalidWeightValues
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStore));

        const result = loadRotationStrategy();

        expect(result).not.toBeNull();
        expect(result?.weights).toEqual({ 'profile-1': 10, 'profile-4': 5 });
      });
    });

    describe('loadRotationStrategyAsync', () => {
      it('should return null when file does not exist', async () => {
        vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

        const result = await loadRotationStrategyAsync();

        expect(result).toBeNull();
      });

      it('should load valid rotation strategy asynchronously', async () => {
        const mockStrategy = {
          enabled: true,
          priorityOrder: ['profile-1', 'profile-2'],
          fallbackToOAuth: true,
          thresholds: {
            maxUsagePercent: 85,
            rateLimitBackoff: 120
          }
        };

        const mockStore = {
          version: 1,
          strategy: mockStrategy
        };

        vi.mocked(readFile).mockResolvedValue(
          Buffer.from(JSON.stringify(mockStore))
        );

        const result = await loadRotationStrategyAsync();

        // Strategy field should be added with default value for backward compatibility
        expect(result).toEqual({
          ...mockStrategy,
          strategy: 'priority'
        });
      });
    });

    describe('saveRotationStrategy', () => {
      it('should save rotation strategy to disk', () => {
        const mockStrategy = {
          enabled: true,
          priorityOrder: ['profile-1', 'profile-2'],
          fallbackToOAuth: true,
          thresholds: {
            maxUsagePercent: 85,
            rateLimitBackoff: 120
          }
        };

        // Mock existsSync to return false so mkdirSync gets called
        vi.mocked(existsSync).mockReturnValue(false);
        vi.mocked(mkdirSync).mockReturnValue(undefined);
        vi.mocked(writeFileSync).mockReturnValue(undefined);

        saveRotationStrategy(mockStrategy);

        expect(vi.mocked(existsSync)).toHaveBeenCalled();
        expect(vi.mocked(mkdirSync)).toHaveBeenCalled();
        expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
          mockRotationFilePath,
          JSON.stringify({ version: 1, strategy: mockStrategy }, null, 2),
          'utf-8'
        );
      });
    });

    describe('getRotationStrategyOrDefault', () => {
      it('should return default strategy when none exists', () => {
        vi.mocked(existsSync).mockReturnValue(false);

        const result = getRotationStrategyOrDefault();

        expect(result).toEqual(DEFAULT_ROTATION_STRATEGY);
      });

      it('should return existing strategy when available', () => {
        const mockStrategy = {
          enabled: true,
          priorityOrder: ['profile-1', 'profile-2'],
          fallbackToOAuth: true,
          thresholds: {
            maxUsagePercent: 85,
            rateLimitBackoff: 120
          }
        };

        const mockStore = {
          version: 1,
          strategy: mockStrategy
        };

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStore));

        const result = getRotationStrategyOrDefault();

        // Strategy field should be added with default value for backward compatibility
        expect(result).toEqual({
          ...mockStrategy,
          strategy: 'priority'
        });
      });
    });
  });
});
