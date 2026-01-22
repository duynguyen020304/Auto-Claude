/**
 * Credential Profile API
 *
 * Exposes credential profile and pool management operations to the renderer process.
 * This API bridges the frontend UI with the backend credential storage system.
 */

import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type {
  CredentialProfile,
  Pool,
  CredentialProfileFormData,
  PoolFormData
} from '../../shared/types/credential-profile';

export interface CredentialProfileAPI {
  // Credential Profile operations
  listCredentialProfiles: () => Promise<IPCResult<CredentialProfile[]>>;
  saveCredentialProfile: (
    profile: CredentialProfileFormData & { id?: string }
  ) => Promise<IPCResult<CredentialProfile>>;
  deleteCredentialProfile: (profileId: string) => Promise<IPCResult<void>>;

  // Credential Pool operations
  listCredentialPools: () => Promise<IPCResult<Pool[]>>;
  saveCredentialPool: (
    pool: PoolFormData & { id?: string }
  ) => Promise<IPCResult<Pool>>;
  deleteCredentialPool: (poolId: string) => Promise<IPCResult<void>>;
  updateCredentialPoolLimits: (
    poolId: string,
    limit: number
  ) => Promise<IPCResult<void>>;
}

export const createCredentialProfileAPI = (): CredentialProfileAPI => ({
  // List all credential profiles
  listCredentialProfiles: (): Promise<IPCResult<CredentialProfile[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_PROFILE_LIST),

  // Save/create a credential profile
  saveCredentialProfile: (
    profile: CredentialProfileFormData & { id?: string }
  ): Promise<IPCResult<CredentialProfile>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_PROFILE_SAVE, profile),

  // Delete a credential profile
  deleteCredentialProfile: (profileId: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_PROFILE_DELETE, profileId),

  // List all credential pools
  listCredentialPools: (): Promise<IPCResult<Pool[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_POOL_LIST),

  // Save/create a credential pool
  saveCredentialPool: (
    pool: PoolFormData & { id?: string }
  ): Promise<IPCResult<Pool>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_POOL_SAVE, pool),

  // Delete a credential pool
  deleteCredentialPool: (poolId: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_POOL_DELETE, poolId),

  // Update pool limits
  updateCredentialPoolLimits: (
    poolId: string,
    limit: number
  ): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_POOL_UPDATE_LIMITS, poolId, limit)
});
