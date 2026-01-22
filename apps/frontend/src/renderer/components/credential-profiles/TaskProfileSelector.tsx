/**
 * TaskProfileSelector - Component for selecting API profiles or pools in task forms
 *
 * Provides mutually exclusive selection between API profiles and pools.
 * - When an API profile is selected, the pool selector is disabled
 * - When a pool is selected, the API profile selector is disabled
 * - Prevents tasks from having both API Profiles AND Pool Profiles (XOR logic)
 *
 * Used in TaskCreationWizard and TaskEditDialog.
 */
import { Key, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { useSettingsStore } from '../../stores/settings-store';
import type { CredentialProfile, Pool } from '@shared/types/credential-profile';

interface TaskProfileSelectorProps {
  /** Currently selected API profile ID (empty string for no selection) */
  profileId: string;
  /** Currently selected pool ID (empty string for no selection) */
  poolId: string;
  /** Called when API profile selection changes */
  onProfileChange: (profileId: string) => void;
  /** Called when pool selection changes */
  onPoolChange: (poolId: string) => void;
  /** Whether the selectors are disabled */
  disabled?: boolean;
}

export function TaskProfileSelector({
  profileId,
  poolId,
  onProfileChange,
  onPoolChange,
  disabled
}: TaskProfileSelectorProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const { credentialProfiles, pools } = useSettingsStore();

  // Filter only API Key profiles (not OAuth)
  const apiProfiles = credentialProfiles.filter(
    (profile) => profile.type === 'api_key'
  );

  const handleProfileSelect = (selectedId: string) => {
    onProfileChange(selectedId);
    // Clear pool selection when API profile is selected (mutual exclusivity)
    if (selectedId && poolId) {
      onPoolChange('');
    }
  };

  const handlePoolSelect = (selectedId: string) => {
    onPoolChange(selectedId);
    // Clear API profile selection when pool is selected (mutual exclusivity)
    if (selectedId && profileId) {
      onProfileChange('');
    }
  };

  const hasApiProfiles = apiProfiles.length > 0;
  const hasPools = pools.length > 0;

  // Disable pool selector if API profile is selected
  const poolDisabled = disabled || !!profileId || !hasPools;
  // Disable API profile selector if pool is selected
  const profileDisabled = disabled || !!poolId || !hasApiProfiles;

  return (
    <div className="space-y-4">
      {/* API Profile Selector */}
      <div className="space-y-2">
        <Label htmlFor="api-profile" className="text-sm font-medium text-foreground">
          {t('tasks:taskProfile.apiProfile.label')}
        </Label>
        <Select
          value={profileId}
          onValueChange={handleProfileSelect}
          disabled={profileDisabled}
        >
          <SelectTrigger id="api-profile" className="h-10">
            <SelectValue placeholder={t('tasks:taskProfile.apiProfile.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {hasApiProfiles ? (
              apiProfiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 shrink-0" />
                    <div>
                      <span className="font-medium">{profile.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {profile.metadata?.usage_limit
                          ? `(${t('tasks:taskProfile.apiProfile.limit')}: ${profile.metadata.usage_limit})`
                          : ''}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              ))
            ) : (
              <SelectItem value="empty" disabled>
                {t('tasks:taskProfile.apiProfile.empty')}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        {!hasApiProfiles && !disabled && (
          <p className="text-xs text-muted-foreground">
            {t('tasks:taskProfile.apiProfile.empty')}
          </p>
        )}
        {poolId && (
          <p className="text-xs text-muted-foreground italic">
            {t('tasks:taskProfile.apiProfile.disabledBecausePool')}
          </p>
        )}
      </div>

      {/* Pool Selector */}
      <div className="space-y-2">
        <Label htmlFor="pool" className="text-sm font-medium text-foreground">
          {t('tasks:taskProfile.pool.label')}
        </Label>
        <Select value={poolId} onValueChange={handlePoolSelect} disabled={poolDisabled}>
          <SelectTrigger id="pool" className="h-10">
            <SelectValue placeholder={t('tasks:taskProfile.pool.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {hasPools ? (
              pools.map((pool) => (
                <SelectItem key={pool.id} value={pool.id}>
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 shrink-0" />
                    <div>
                      <span className="font-medium">{pool.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({pool.profile_ids.length} {t('tasks:taskProfile.pool.profiles')})
                      </span>
                    </div>
                  </div>
                </SelectItem>
              ))
            ) : (
              <SelectItem value="empty" disabled>
                {t('tasks:taskProfile.pool.empty')}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        {!hasPools && !disabled && (
          <p className="text-xs text-muted-foreground">
            {t('tasks:taskProfile.pool.empty')}
          </p>
        )}
        {profileId && (
          <p className="text-xs text-muted-foreground italic">
            {t('tasks:taskProfile.pool.disabledBecauseProfile')}
          </p>
        )}
      </div>

      {/* Validation Error - shows if both are somehow selected (defensive programming) */}
      {profileId && poolId && (
        <p className="text-sm text-destructive">
          {t('tasks:taskProfile.validation.bothSelected')}
        </p>
      )}
    </div>
  );
}
