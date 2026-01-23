import { create } from 'zustand';
import type { AppSettings } from '../../shared/types';
import type { APIProfile, ProfileFormData, TestConnectionResult, DiscoverModelsResult, ModelInfo } from '../../shared/types/profile';
import type { CredentialProfile, Pool, CredentialProfileFormData, PoolFormData } from '../../shared/types/credential-profile';
import type { ClaudeUsageSnapshot } from '../../shared/types/agent';
import { DEFAULT_APP_SETTINGS } from '../../shared/constants';
import { toast } from '../hooks/use-toast';
import { markSettingsLoaded } from '../lib/sentry';

// Usage cache TTL: 10 minutes in milliseconds
const USAGE_CACHE_TTL = 10 * 60 * 1000;

interface SettingsState {
  settings: AppSettings;
  isLoading: boolean;
  error: string | null;

  // API Profile state
  profiles: APIProfile[];
  activeProfileId: string | null;
  profilesLoading: boolean;
  profilesError: string | null;

  // Credential Profile state
  credentialProfiles: CredentialProfile[];
  credentialProfilesLoading: boolean;
  credentialProfilesError: string | null;

  // Pool state
  pools: Pool[];
  poolsLoading: boolean;
  poolsError: string | null;

  // Test connection state
  isTestingConnection: boolean;
  testConnectionResult: TestConnectionResult | null;

  // Model discovery state
  modelsLoading: boolean;
  modelsError: string | null;
  discoveredModels: Map<string, ModelInfo[]>; // Cache key -> models mapping

  // Usage cache state
  cachedUsage: Map<string, { data: ClaudeUsageSnapshot; fetchedAt: number }>; // profileId -> { data, timestamp } mapping

  // Actions
  setSettings: (settings: AppSettings) => void;
  updateSettings: (updates: Partial<AppSettings>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Profile actions
  setProfiles: (profiles: APIProfile[], activeProfileId: string | null) => void;
  setProfilesLoading: (loading: boolean) => void;
  setProfilesError: (error: string | null) => void;
  saveProfile: (profile: ProfileFormData) => Promise<boolean>;
  updateProfile: (profile: APIProfile) => Promise<boolean>;
  deleteProfile: (profileId: string) => Promise<boolean>;
  setActiveProfile: (profileId: string | null) => Promise<boolean>;
  testConnection: (baseUrl: string, apiKey: string, signal?: AbortSignal) => Promise<TestConnectionResult | null>;
  discoverModels: (baseUrl: string, apiKey: string, signal?: AbortSignal) => Promise<ModelInfo[] | null>;

  // Credential Profile actions
  setCredentialProfiles: (profiles: CredentialProfile[]) => void;
  addCredentialProfile: (profile: CredentialProfile) => void;
  updateCredentialProfile: (profile: CredentialProfile) => void;
  removeCredentialProfile: (profileId: string) => void;
  setCredentialProfilesLoading: (loading: boolean) => void;
  setCredentialProfilesError: (error: string | null) => void;
  saveCredentialProfile: (profile: CredentialProfileFormData) => Promise<boolean>;
  updateCredentialProfileAsync: (profile: CredentialProfile) => Promise<boolean>;
  deleteCredentialProfile: (profileId: string) => Promise<boolean>;

  // Pool actions
  setPools: (pools: Pool[]) => void;
  addPool: (pool: Pool) => void;
  updatePool: (pool: Pool) => void;
  removePool: (poolId: string) => void;
  setPoolsLoading: (loading: boolean) => void;
  setPoolsError: (error: string | null) => void;
  savePool: (pool: Pool) => Promise<boolean>;
  updatePoolAsync: (pool: Pool) => Promise<boolean>;
  deletePool: (poolId: string) => Promise<boolean>;

  // Usage cache actions
  getCachedUsage: (profileId: string) => ClaudeUsageSnapshot | null;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_APP_SETTINGS as AppSettings,
  isLoading: true,  // Start as true since we load settings on app init
  error: null,

  // API Profile state
  profiles: [],
  activeProfileId: null,
  profilesLoading: false,
  profilesError: null,

  // Credential Profile state
  credentialProfiles: [],
  credentialProfilesLoading: false,
  credentialProfilesError: null,

  // Pool state
  pools: [],
  poolsLoading: false,
  poolsError: null,

  // Test connection state
  isTestingConnection: false,
  testConnectionResult: null,

  // Model discovery state
  modelsLoading: false,
  modelsError: null,
  discoveredModels: new Map<string, ModelInfo[]>(),

  // Usage cache state
  cachedUsage: new Map<string, { data: ClaudeUsageSnapshot; fetchedAt: number }>(),

  setSettings: (settings) => set({ settings }),

  updateSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates }
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  // Profile actions
  setProfiles: (profiles, activeProfileId) => set({ profiles, activeProfileId }),

  setProfilesLoading: (profilesLoading) => set({ profilesLoading }),

  setProfilesError: (profilesError) => set({ profilesError }),

  saveProfile: async (profile: ProfileFormData): Promise<boolean> => {
    set({ profilesLoading: true, profilesError: null });
    try {
      const result = await window.electronAPI.saveAPIProfile(profile);
      if (result.success && result.data) {
        // Re-fetch profiles from backend to get authoritative activeProfileId
        // (backend only auto-activates the first profile)
        try {
          const profilesResult = await window.electronAPI.getAPIProfiles();
          if (profilesResult.success && profilesResult.data) {
            set({
              profiles: profilesResult.data.profiles,
              activeProfileId: profilesResult.data.activeProfileId,
              profilesLoading: false
            });
          } else {
            // Fallback: add profile locally but don't assume activeProfileId
            set((state) => ({
              profiles: [...state.profiles, result.data!],
              profilesLoading: false
            }));
          }
        } catch {
          // Fallback on fetch error: add profile locally
          set((state) => ({
            profiles: [...state.profiles, result.data!],
            profilesLoading: false
          }));
        }
        return true;
      }
      set({
        profilesError: result.error || 'Failed to save profile',
        profilesLoading: false
      });
      return false;
    } catch (error) {
      set({
        profilesError: error instanceof Error ? error.message : 'Failed to save profile',
        profilesLoading: false
      });
      return false;
    }
  },

  updateProfile: async (profile: APIProfile): Promise<boolean> => {
    set({ profilesLoading: true, profilesError: null });
    try {
      const result = await window.electronAPI.updateAPIProfile(profile);
      if (result.success && result.data) {
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === result.data!.id ? result.data! : p
          ),
          profilesLoading: false
        }));
        return true;
      }
      set({
        profilesError: result.error || 'Failed to update profile',
        profilesLoading: false
      });
      return false;
    } catch (error) {
      set({
        profilesError: error instanceof Error ? error.message : 'Failed to update profile',
        profilesLoading: false
      });
      return false;
    }
  },

  deleteProfile: async (profileId: string): Promise<boolean> => {
    set({ profilesLoading: true, profilesError: null });
    try {
      const result = await window.electronAPI.deleteAPIProfile(profileId);
      if (result.success) {
        set((state) => ({
          profiles: state.profiles.filter((p) => p.id !== profileId),
          activeProfileId: state.activeProfileId === profileId ? null : state.activeProfileId,
          profilesLoading: false
        }));
        return true;
      }
      set({
        profilesError: result.error || 'Failed to delete profile',
        profilesLoading: false
      });
      return false;
    } catch (error) {
      set({
        profilesError: error instanceof Error ? error.message : 'Failed to delete profile',
        profilesLoading: false
      });
      return false;
    }
  },

  setActiveProfile: async (profileId: string | null): Promise<boolean> => {
    set({ profilesLoading: true, profilesError: null });
    try {
      const result = await window.electronAPI.setActiveAPIProfile(profileId);
      if (result.success) {
        set({ activeProfileId: profileId, profilesLoading: false });
        return true;
      }
      set({
        profilesError: result.error || 'Failed to set active profile',
        profilesLoading: false
      });
      return false;
    } catch (error) {
      set({
        profilesError: error instanceof Error ? error.message : 'Failed to set active profile',
        profilesLoading: false
      });
      return false;
    }
  },

  testConnection: async (baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<TestConnectionResult | null> => {
    set({ isTestingConnection: true, testConnectionResult: null });
    try {
      const result = await window.electronAPI.testConnection(baseUrl, apiKey, signal);

      // Type narrowing pattern
      if (result.success && result.data) {
        set({ testConnectionResult: result.data, isTestingConnection: false });

        // Show toast on success
        // TODO: Use i18n translation keys (settings:connection.successTitle, settings:connection.successDescription)
        // Note: Zustand stores can't use useTranslation() hook - need to pass t() or use i18n.t()
        if (result.data.success) {
          toast({
            title: 'Connection successful',
            description: 'Your API credentials are valid.'
          });
        }
        return result.data;
      }

      // Error from IPC layer - set testConnectionResult for inline display
      const errorResult: TestConnectionResult = {
        success: false,
        errorType: 'unknown',
        message: result.error || 'Failed to test connection'
      };
      set({ testConnectionResult: errorResult, isTestingConnection: false });
      toast({
        variant: 'destructive',
        title: 'Connection test failed',
        description: result.error || 'Failed to test connection'
      });
      return errorResult;
    } catch (error) {
      // Unexpected error - set testConnectionResult for inline display
      const errorResult: TestConnectionResult = {
        success: false,
        errorType: 'unknown',
        message: error instanceof Error ? error.message : 'Failed to test connection'
      };
      set({ testConnectionResult: errorResult, isTestingConnection: false });
      toast({
        variant: 'destructive',
        title: 'Connection test failed',
        description: error instanceof Error ? error.message : 'Failed to test connection'
      });
      return errorResult;
    }
  },

  discoverModels: async (baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<ModelInfo[] | null> => {
    console.log('[settings-store] discoverModels called with:', { baseUrl, apiKey: `${apiKey.slice(-4)}` });
    // Generate cache key from baseUrl and apiKey (last 4 chars)
    const cacheKey = `${baseUrl}::${apiKey.slice(-4)}`;

    // Check cache first
    const state = useSettingsStore.getState();
    const cached = state.discoveredModels.get(cacheKey);
    if (cached) {
      console.log('[settings-store] Returning cached models');
      return cached;
    }

    // Fetch from API
    set({ modelsLoading: true, modelsError: null });
    try {
      console.log('[settings-store] Calling window.electronAPI.discoverModels...');
      const result = await window.electronAPI.discoverModels(baseUrl, apiKey, signal);
      console.log('[settings-store] discoverModels result:', result);

      if (result.success && result.data) {
        const models = result.data.models;
        // Cache the results
        set((state) => ({
          discoveredModels: new Map(state.discoveredModels).set(cacheKey, models),
          modelsLoading: false
        }));
        return models;
      }

      // Error from IPC layer
      set({ modelsError: result.error || 'Failed to discover models', modelsLoading: false });
      return null;
    } catch (error) {
      set({
        modelsError: error instanceof Error ? error.message : 'Failed to discover models',
        modelsLoading: false
      });
      return null;
    }
  },

  // Credential Profile actions
  setCredentialProfiles: (credentialProfiles) => set({ credentialProfiles }),

  addCredentialProfile: (profile) =>
    set((state) => ({
      credentialProfiles: [...state.credentialProfiles, profile]
    })),

  updateCredentialProfile: (profile) =>
    set((state) => ({
      credentialProfiles: state.credentialProfiles.map((p) =>
        p.id === profile.id ? profile : p
      )
    })),

  removeCredentialProfile: (profileId) =>
    set((state) => ({
      credentialProfiles: state.credentialProfiles.filter((p) => p.id !== profileId)
    })),

  setCredentialProfilesLoading: (credentialProfilesLoading) => set({ credentialProfilesLoading }),

  setCredentialProfilesError: (credentialProfilesError) => set({ credentialProfilesError }),

  saveCredentialProfile: async (profile: CredentialProfileFormData): Promise<boolean> => {
    set({ credentialProfilesLoading: true, credentialProfilesError: null });
    try {
      const result = await window.electronAPI.saveCredentialProfile(profile);
      if (result.success && result.data) {
        // Re-fetch profiles from backend to get authoritative data
        try {
          const profilesResult = await window.electronAPI.listCredentialProfiles();
          if (profilesResult.success && profilesResult.data) {
            set({
              credentialProfiles: profilesResult.data,
              credentialProfilesLoading: false
            });
          } else {
            // Fallback: add profile locally
            set((state) => ({
              credentialProfiles: [...state.credentialProfiles, result.data!],
              credentialProfilesLoading: false
            }));
          }
        } catch {
          // Fallback on fetch error: add profile locally
          set((state) => ({
            credentialProfiles: [...state.credentialProfiles, result.data!],
            credentialProfilesLoading: false
          }));
        }
        return true;
      }
      set({
        credentialProfilesError: result.error || 'Failed to save credential profile',
        credentialProfilesLoading: false
      });
      return false;
    } catch (error) {
      set({
        credentialProfilesError: error instanceof Error ? error.message : 'Failed to save credential profile',
        credentialProfilesLoading: false
      });
      return false;
    }
  },

  updateCredentialProfileAsync: async (profile: CredentialProfile): Promise<boolean> => {
    set({ credentialProfilesLoading: true, credentialProfilesError: null });
    try {
      // Convert CredentialProfile to CredentialProfileFormData for the API
      const formData: CredentialProfileFormData & { id: string } = {
        id: profile.id,
        type: profile.type,
        name: profile.name,
        credential_value: profile.credential_value,
        usage_limit: profile.metadata?.usage_limit ? Number(profile.metadata.usage_limit) : undefined,
        rotation_mode: profile.metadata?.rotation_mode as any,
        rate_limit_threshold: profile.metadata?.rate_limit_threshold ? Number(profile.metadata.rate_limit_threshold) : undefined,
        metadata: profile.metadata || undefined
      };

      const result = await window.electronAPI.saveCredentialProfile(formData);
      if (result.success && result.data) {
        set((state) => ({
          credentialProfiles: state.credentialProfiles.map((p) =>
            p.id === result.data!.id ? result.data! : p
          ),
          credentialProfilesLoading: false
        }));
        return true;
      }
      set({
        credentialProfilesError: result.error || 'Failed to update credential profile',
        credentialProfilesLoading: false
      });
      return false;
    } catch (error) {
      set({
        credentialProfilesError: error instanceof Error ? error.message : 'Failed to update credential profile',
        credentialProfilesLoading: false
      });
      return false;
    }
  },

  deleteCredentialProfile: async (profileId: string): Promise<boolean> => {
    set({ credentialProfilesLoading: true, credentialProfilesError: null });
    try {
      const result = await window.electronAPI.deleteCredentialProfile(profileId);
      if (result.success) {
        set((state) => ({
          credentialProfiles: state.credentialProfiles.filter((p) => p.id !== profileId),
          credentialProfilesLoading: false
        }));
        return true;
      }
      set({
        credentialProfilesError: result.error || 'Failed to delete credential profile',
        credentialProfilesLoading: false
      });
      return false;
    } catch (error) {
      set({
        credentialProfilesError: error instanceof Error ? error.message : 'Failed to delete credential profile',
        credentialProfilesLoading: false
      });
      return false;
    }
  },

  // Pool actions
  setPools: (pools) => set({ pools }),

  addPool: (pool) =>
    set((state) => ({
      pools: [...state.pools, pool]
    })),

  updatePool: (pool) =>
    set((state) => ({
      pools: state.pools.map((p) =>
        p.id === pool.id ? pool : p
      )
    })),

  removePool: (poolId) =>
    set((state) => ({
      pools: state.pools.filter((p) => p.id !== poolId)
    })),

  setPoolsLoading: (poolsLoading) => set({ poolsLoading }),

  setPoolsError: (poolsError) => set({ poolsError }),

  savePool: async (pool: Pool): Promise<boolean> => {
    set({ poolsLoading: true, poolsError: null });
    try {
      const result = await window.electronAPI.saveCredentialPool(pool);
      if (result.success && result.data) {
        // Re-fetch pools from backend to get authoritative data
        try {
          const poolsResult = await window.electronAPI.listCredentialPools();
          if (poolsResult.success && poolsResult.data) {
            set({
              pools: poolsResult.data,
              poolsLoading: false
            });
          } else {
            // Fallback: add pool locally
            set((state) => ({
              pools: [...state.pools, result.data!],
              poolsLoading: false
            }));
          }
        } catch {
          // Fallback on fetch error: add pool locally
          set((state) => ({
            pools: [...state.pools, result.data!],
            poolsLoading: false
          }));
        }
        return true;
      }
      set({
        poolsError: result.error || 'Failed to save pool',
        poolsLoading: false
      });
      return false;
    } catch (error) {
      set({
        poolsError: error instanceof Error ? error.message : 'Failed to save pool',
        poolsLoading: false
      });
      return false;
    }
  },

  updatePoolAsync: async (pool: Pool): Promise<boolean> => {
    set({ poolsLoading: true, poolsError: null });
    try {
      // Convert Pool to PoolFormData for the API (they have the same structure)
      const formData: PoolFormData & { id: string } = {
        id: pool.id,
        name: pool.name,
        profile_ids: pool.profile_ids,
        limit: pool.limit,
        rotation_config: pool.rotation_config
      };

      const result = await window.electronAPI.saveCredentialPool(formData);
      if (result.success && result.data) {
        set((state) => ({
          pools: state.pools.map((p) =>
            p.id === result.data!.id ? result.data! : p
          ),
          poolsLoading: false
        }));
        return true;
      }
      set({
        poolsError: result.error || 'Failed to update pool',
        poolsLoading: false
      });
      return false;
    } catch (error) {
      set({
        poolsError: error instanceof Error ? error.message : 'Failed to update pool',
        poolsLoading: false
      });
      return false;
    }
  },

  deletePool: async (poolId: string): Promise<boolean> => {
    set({ poolsLoading: true, poolsError: null });
    try {
      const result = await window.electronAPI.deleteCredentialPool(poolId);
      if (result.success) {
        set((state) => ({
          pools: state.pools.filter((p) => p.id !== poolId),
          poolsLoading: false
        }));
        return true;
      }
      set({
        poolsError: result.error || 'Failed to delete pool',
        poolsLoading: false
      });
      return false;
    } catch (error) {
      set({
        poolsError: error instanceof Error ? error.message : 'Failed to delete pool',
        poolsLoading: false
      });
      return false;
    }
  },

  getCachedUsage: (profileId: string): ClaudeUsageSnapshot | null => {
    const state = useSettingsStore.getState();
    const cached = state.cachedUsage.get(profileId);

    // Return null if no cached entry
    if (!cached) {
      console.log('[settings-store] Usage cache miss - no entry for profile:', profileId);
      return null;
    }

    // Check if cache has expired
    const now = Date.now();
    const cacheAge = now - cached.fetchedAt;
    if (cacheAge > USAGE_CACHE_TTL) {
      console.log('[settings-store] Usage cache expired for profile:', profileId, 'age:', cacheAge, 'ms');
      return null;
    }

    // Return cached data if valid
    console.log('[settings-store] Usage cache hit for profile:', profileId, 'age:', cacheAge, 'ms');
    return cached.data;
  },
}));

/**
 * Check if settings need migration for onboardingCompleted flag.
 * Existing users (with tokens or projects configured) should have
 * onboardingCompleted set to true to skip the onboarding wizard.
 */
function migrateOnboardingCompleted(settings: AppSettings): AppSettings {
  // Only migrate if onboardingCompleted is undefined (not explicitly set)
  if (settings.onboardingCompleted !== undefined) {
    return settings;
  }

  // Check for signs of an existing user:
  // - Has a Claude OAuth token configured
  // - Has the auto-build source path configured
  const hasOAuthToken = Boolean(settings.globalClaudeOAuthToken);
  const hasAutoBuildPath = Boolean(settings.autoBuildPath);

  const isExistingUser = hasOAuthToken || hasAutoBuildPath;

  if (isExistingUser) {
    // Mark onboarding as completed for existing users
    return { ...settings, onboardingCompleted: true };
  }

  // New user - set to false to trigger onboarding wizard
  return { ...settings, onboardingCompleted: false };
}

/**
 * Load settings from main process
 */
export async function loadSettings(): Promise<void> {
  const store = useSettingsStore.getState();
  store.setLoading(true);

  try {
    const result = await window.electronAPI.getSettings();
    if (result.success && result.data) {
      // Apply migration for onboardingCompleted flag
      const migratedSettings = migrateOnboardingCompleted(result.data);
      store.setSettings(migratedSettings);

      // If migration changed the settings, persist them
      if (migratedSettings.onboardingCompleted !== result.data.onboardingCompleted) {
        await window.electronAPI.saveSettings({
          onboardingCompleted: migratedSettings.onboardingCompleted
        });
      }

      // Only mark settings as loaded on SUCCESS
      // This ensures Sentry respects user's opt-out preference even if settings fail to load
      // (If settings fail to load, Sentry's beforeSend drops all events until successful load)
      markSettingsLoaded();
    }
    // Note: If result.success is false, we intentionally do NOT mark settings as loaded.
    // This means Sentry will drop events, which is the safe default for privacy.
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to load settings');
    // Note: On exception, we intentionally do NOT mark settings as loaded.
    // Sentry's beforeSend will drop events, respecting potential user opt-out.
  } finally {
    store.setLoading(false);
  }
}

/**
 * Save settings to main process
 */
export async function saveSettings(updates: Partial<AppSettings>): Promise<boolean> {
  const store = useSettingsStore.getState();

  try {
    const result = await window.electronAPI.saveSettings(updates);
    if (result.success) {
      store.updateSettings(updates);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Load API profiles from main process
 */
export async function loadProfiles(): Promise<void> {
  const store = useSettingsStore.getState();
  store.setProfilesLoading(true);

  try {
    const result = await window.electronAPI.getAPIProfiles();
    if (result.success && result.data) {
      store.setProfiles(result.data.profiles, result.data.activeProfileId);
    }
  } catch (error) {
    store.setProfilesError(error instanceof Error ? error.message : 'Failed to load profiles');
  } finally {
    store.setProfilesLoading(false);
  }
}

/**
 * Load credential profiles from main process
 */
export async function loadCredentialProfiles(): Promise<void> {
  const store = useSettingsStore.getState();
  store.setCredentialProfilesLoading(true);

  try {
    const result = await window.electronAPI.listCredentialProfiles();
    if (result.success && result.data) {
      store.setCredentialProfiles(result.data);
    }
  } catch (error) {
    store.setCredentialProfilesError(error instanceof Error ? error.message : 'Failed to load credential profiles');
  } finally {
    store.setCredentialProfilesLoading(false);
  }
}

/**
 * Load credential pools from main process
 */
export async function loadPools(): Promise<void> {
  const store = useSettingsStore.getState();
  store.setPoolsLoading(true);

  try {
    const result = await window.electronAPI.listCredentialPools();
    if (result.success && result.data) {
      store.setPools(result.data);
    }
  } catch (error) {
    store.setPoolsError(error instanceof Error ? error.message : 'Failed to load pools');
  } finally {
    store.setPoolsLoading(false);
  }
}
