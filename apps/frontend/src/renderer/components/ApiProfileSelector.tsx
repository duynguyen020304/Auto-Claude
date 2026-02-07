/**
 * ApiProfileSelector - Reusable component for selecting API profile in task forms
 *
 * Provides a dropdown for selecting from user-configured API profiles.
 * Shows an empty state when no profiles are available.
 *
 * Used in TaskCreationWizard and TaskEditDialog.
 */
import { Key, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import { useSettingsStore } from '../stores/settings-store';
import type { APIProfile } from '../../shared/types/profile';
import { cn } from '../lib/utils';

interface ApiProfileSelectorProps {
  /** Currently selected profile ID (empty string for no selection) */
  profileId: string;
  /** Called when profile selection changes */
  onProfileChange: (profileId: string) => void;
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Optional phase for phase-specific labels ('spec' | 'planning' | 'coding' | 'qa') */
  phase?: 'spec' | 'planning' | 'coding' | 'qa';
}

export function ApiProfileSelector({
  profileId,
  onProfileChange,
  disabled,
  phase
}: ApiProfileSelectorProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const { profiles } = useSettingsStore();

  const handleProfileSelect = (selectedId: string) => {
    onProfileChange(selectedId);
  };

  const hasProfiles = profiles && profiles.length > 0;

  // Generate unique ID for the select trigger (support multiple phase selectors)
  const selectId = phase ? `api-profile-${phase}` : 'api-profile';

  // Get label key based on phase
  const getLabelKey = () => {
    if (phase) {
      return `tasks:apiProfile.phases.${phase}.label`;
    }
    return 'tasks:apiProfile.label';
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={selectId} className="text-sm font-medium text-foreground">
        {t(getLabelKey())}
      </Label>
      <Select
        value={profileId}
        onValueChange={handleProfileSelect}
        disabled={disabled || !hasProfiles}
      >
        <SelectTrigger id={selectId} className="h-10">
          <SelectValue placeholder={t('tasks:apiProfile.placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {hasProfiles ? (
            <>
              <SelectItem value="auto">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 shrink-0" />
                  <span className="font-medium">{t('tasks:apiProfile.auto')}</span>
                </div>
              </SelectItem>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 shrink-0" />
                    <div>
                      <span className="font-medium">{profile.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({profile.baseUrl})
                      </span>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </>
          ) : (
            <SelectItem value="empty" disabled>
              {t('tasks:apiProfile.empty')}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {!hasProfiles && !disabled && (
        <p className="text-xs text-muted-foreground">
          {t('tasks:apiProfile.empty')}
        </p>
      )}
    </div>
  );
}
