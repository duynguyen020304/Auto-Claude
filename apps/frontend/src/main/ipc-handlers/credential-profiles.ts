/**
 * Credential Profiles IPC Handlers
 *
 * IPC handlers for credential profile and pool management:
 * - CREDENTIAL_PROFILE_LIST - List all credential profiles
 * - CREDENTIAL_PROFILE_SAVE - Save/create a credential profile
 * - CREDENTIAL_PROFILE_DELETE - Delete a credential profile
 * - CREDENTIAL_POOL_LIST - List all credential pools
 * - CREDENTIAL_POOL_SAVE - Save/create a credential pool
 * - CREDENTIAL_POOL_DELETE - Delete a credential pool
 * - CREDENTIAL_POOL_UPDATE_LIMITS - Update pool limits
 *
 * These handlers communicate with the Python backend (core/auth.py) to perform
 * credential storage operations using platform-specific storage (Keychain, Credential Manager, etc.)
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type {
  CredentialProfile,
  Pool,
  CredentialProfileFormData,
  PoolFormData
} from '../../shared/types/credential-profile';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { is } from '@electron-toolkit/utils';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the Python backend path
 * In development: apps/backend
 * In production: resources/backend (bundled as extraResources)
 */
function getBackendPath(): string {
  if (is.dev) {
    // Development: use apps/backend from repository root
    return path.resolve(__dirname, '..', '..', '..', '..', 'backend');
  } else {
    // Production: use bundled backend from resources
    return path.resolve(process.resourcesPath, 'backend');
  }
}

/**
 * Get the Python executable path
 * Uses the configured Python path or falls back to 'python3'
 */
function getPythonPath(): string {
  // In production, use bundled Python from resources
  // In development, use 'python3' from PATH
  return is.dev ? 'python3' : path.join(process.resourcesPath, 'python', 'python.exe');
}

/**
 * Execute a Python function from the backend
 * @param moduleName - Python module name (e.g., 'core.auth')
 * @param functionName - Function name to call
 * @param args - Arguments to pass to the function (will be JSON-encoded)
 * @returns Result from the Python function
 */
function executePythonFunction<T>(
  moduleName: string,
  functionName: string,
  args: Record<string, unknown> = {}
): T {
  const backendPath = getBackendPath();
  const pythonPath = getPythonPath();

  // Verify backend path exists
  if (!existsSync(backendPath)) {
    throw new Error(`Backend path does not exist: ${backendPath}`);
  }

  // Create Python script to execute the function
  const script = `
import sys
import json

# Add backend to path
sys.path.insert(0, ${JSON.stringify(backendPath)})

# Import the module
from ${moduleName} import ${functionName}

# Parse arguments
args = json.loads('''${JSON.stringify(JSON.stringify(args))}''')

# Call the function with arguments
result = ${functionName}(**args)

# Output result as JSON
print(json.dumps(result))
`;

  try {
    const result = execFileSync(pythonPath, ['-c', script], {
      encoding: 'utf-8',
      timeout: 30000, // 30 second timeout
      windowsHide: true,
      cwd: backendPath
    });

    const output = result.trim();
    if (!output) {
      throw new Error('No output from Python script');
    }

    return JSON.parse(output) as T;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[executePythonFunction] Error calling ${moduleName}.${functionName}:`, errorMessage);
    throw new Error(`Failed to execute ${functionName}: ${errorMessage}`);
  }
}

/**
 * Register all credential profile-related IPC handlers
 */
export function registerCredentialProfilesHandlers(): void {
  /**
   * List all credential profiles
   */
  ipcMain.handle(
    IPC_CHANNELS.CREDENTIAL_PROFILE_LIST,
    async (): Promise<IPCResult<CredentialProfile[]>> => {
      try {
        const profiles = executePythonFunction<CredentialProfile[]>(
          'core.auth',
          'list_credentials'
        );

        return { success: true, data: profiles };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list credential profiles'
        };
      }
    }
  );

  /**
   * Save/create a credential profile
   */
  ipcMain.handle(
    IPC_CHANNELS.CREDENTIAL_PROFILE_SAVE,
    async (_, profileData: CredentialProfileFormData & { id?: string }): Promise<IPCResult<CredentialProfile>> => {
      try {
        // Convert form data to credential dict format expected by backend
        const credential: Record<string, unknown> = {
          id: profileData.id || `cred-${Date.now()}`,
          type: profileData.type,
          name: profileData.name,
          credential_value: profileData.credential_value,
          usage_limit: profileData.usage_limit,
          rotation_mode: profileData.rotation_mode || 'manual',
          rate_limit_threshold: profileData.rate_limit_threshold,
          metadata: profileData.metadata || {}
        };

        const success = executePythonFunction<boolean>(
          'core.auth',
          'save_credential',
          { credential }
        );

        if (!success) {
          throw new Error('Failed to save credential profile');
        }

        // Return the saved profile (backend doesn't return it, so construct from input)
        const savedProfile: CredentialProfile = {
          id: credential.id as string,
          type: credential.type as 'api_key' | 'oauth',
          name: credential.name as string,
          status: 'active',
          credential_value: credential.credential_value as string,
          usage_metrics: {
            total_requests: 0,
            total_tokens: 0,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            last_used: null
          },
          rate_limit_info: null,
          last_validated: null,
          created_at: Date.now(),
          metadata: (credential.metadata as Record<string, string>) || null
        };

        return { success: true, data: savedProfile };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save credential profile'
        };
      }
    }
  );

  /**
   * Delete a credential profile
   */
  ipcMain.handle(
    IPC_CHANNELS.CREDENTIAL_PROFILE_DELETE,
    async (_, profileId: string): Promise<IPCResult<void>> => {
      try {
        const success = executePythonFunction<boolean>(
          'core.auth',
          'delete_credential',
          { cred_id: profileId }
        );

        if (!success) {
          throw new Error('Failed to delete credential profile');
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete credential profile'
        };
      }
    }
  );

  /**
   * List all credential pools
   */
  ipcMain.handle(
    IPC_CHANNELS.CREDENTIAL_POOL_LIST,
    async (): Promise<IPCResult<Pool[]>> => {
      try {
        const pools = executePythonFunction<Pool[]>(
          'core.auth',
          'list_pools'
        );

        return { success: true, data: pools };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list credential pools'
        };
      }
    }
  );

  /**
   * Save/create a credential pool
   */
  ipcMain.handle(
    IPC_CHANNELS.CREDENTIAL_POOL_SAVE,
    async (_, poolData: PoolFormData & { id?: string }): Promise<IPCResult<Pool>> => {
      try {
        // Generate pool ID if not provided
        const poolId = poolData.id || `pool-${Date.now()}`;

        // Convert form data to pool format expected by backend
        const pool: Record<string, unknown> = {
          name: poolData.name,
          profile_ids: poolData.profile_ids,
          limit: poolData.limit,
          rotation_config: poolData.rotation_config
        };

        const success = executePythonFunction<boolean>(
          'core.auth',
          'save_pool',
          {
            name: pool.name as string,
            profile_ids: pool.profile_ids as string[],
            limit: pool.limit as number,
            rotation_config: pool.rotation_config as Record<string, unknown>
          }
        );

        if (!success) {
          throw new Error('Failed to save credential pool');
        }

        // Return the saved pool (backend doesn't return it, so construct from input)
        const savedPool: Pool = {
          id: poolId,
          name: pool.name as string,
          profile_ids: pool.profile_ids as string[],
          limit: pool.limit as number,
          rotation_config: pool.rotation_config as {
            mode: 'manual' | 'round_robin' | 'usage_based' | 'rate_limit_aware';
            credential_pool: string[];
            rate_limit_threshold: number;
            max_retries: number;
            retry_delay_seconds: number;
          }
        };

        return { success: true, data: savedPool };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save credential pool'
        };
      }
    }
  );

  /**
   * Delete a credential pool
   */
  ipcMain.handle(
    IPC_CHANNELS.CREDENTIAL_POOL_DELETE,
    async (_, poolId: string): Promise<IPCResult<void>> => {
      try {
        const success = executePythonFunction<boolean>(
          'core.auth',
          'delete_pool',
          { pool_id: poolId }
        );

        if (!success) {
          throw new Error('Failed to delete credential pool');
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete credential pool'
        };
      }
    }
  );

  /**
   * Update pool limits
   */
  ipcMain.handle(
    IPC_CHANNELS.CREDENTIAL_POOL_UPDATE_LIMITS,
    async (_, poolId: string, limit: number): Promise<IPCResult<void>> => {
      try {
        const success = executePythonFunction<boolean>(
          'core.auth',
          'update_pool_limits',
          { pool_id: poolId, limit }
        );

        if (!success) {
          throw new Error('Failed to update pool limits');
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update pool limits'
        };
      }
    }
  );
}
