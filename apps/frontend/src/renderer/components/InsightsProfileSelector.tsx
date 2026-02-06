/**
 * InsightsProfileSelector - API profile selector for Insights chat
 *
 * Allows users to select which API profile to use for the current Insights session.
 * Uses a DropdownMenu pattern consistent with InsightsModelSelector.
 *
 * Displays the current profile with a visual indicator (badge).
 */
import { useTranslation } from 'react-i18next';
import { Key, Check, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel
} from './ui/dropdown-menu';
import { useSettingsStore } from '../stores/settings-store';
import type { APIProfile } from '../../shared/types/profile';

interface InsightsProfileSelectorProps {
  /** Currently selected profile ID (undefined = use default/active) */
  currentProfileId?: string;
  /** Called when profile selection changes */
  onProfileChange: (profileId: string | undefined) => void;
  /** Whether the selector is disabled */
  disabled?: boolean;
}

export function InsightsProfileSelector({
  currentProfileId,
  onProfileChange,
  disabled
}: InsightsProfileSelectorProps) {
  const { t } = useTranslation('insights');
  const { profiles, activeProfileId } = useSettingsStore();

  // Find the current profile details
  const currentProfile = currentProfileId
    ? profiles.find((p) => p.id === currentProfileId)
    : null;

  // Build display text for current selection
  const getDisplayText = () => {
    if (currentProfileId === 'auto' || currentProfileId === undefined) {
      return t('profileSelector.auto');
    }
    if (currentProfile) {
      return currentProfile.name;
    }
    return t('profileSelector.chooseProfile');
  };

  const handleSelectProfile = (profileId: string | undefined) => {
    onProfileChange(profileId);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-2 px-2"
          disabled={disabled}
          title={`API Profile: ${getDisplayText()}`}
          aria-label={t('profileSelector.selectLabel')}
        >
          <Key className="h-4 w-4" />
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {getDisplayText()}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t('profileSelector.apiProfile')}</DropdownMenuLabel>

        {/* Auto option - use default/active profile */}
        <DropdownMenuItem
          onClick={() => handleSelectProfile(undefined)}
          className="flex cursor-pointer items-center gap-2"
        >
          <RefreshCw className="h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t('profileSelector.auto')}</div>
            <div className="truncate text-xs text-muted-foreground">
              {activeProfileId
                ? profiles.find((p) => p.id === activeProfileId)?.name || t('profileSelector.activeProfile')
                : t('profileSelector.oauthProfile')
              }
            </div>
          </div>
          {currentProfileId === undefined && (
            <Check className="h-4 w-4 shrink-0 text-primary" />
          )}
        </DropdownMenuItem>

        {profiles.length > 0 && <DropdownMenuSeparator />}

        {/* List all configured profiles */}
        {profiles.length === 0 ? (
          <DropdownMenuItem disabled className="flex cursor-pointer items-center gap-2">
            <Key className="h-4 w-4 shrink-0" />
            <span className="text-xs text-muted-foreground">
              {t('profileSelector.noProfiles')}
            </span>
          </DropdownMenuItem>
        ) : (
          profiles.map((profile) => {
            const isSelected = currentProfileId === profile.id;
            const isActiveProfile = activeProfileId === profile.id;
            return (
              <DropdownMenuItem
                key={profile.id}
                onClick={() => handleSelectProfile(profile.id)}
                className="flex cursor-pointer items-center gap-2"
              >
                <Key className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{profile.name}</span>
                    {isActiveProfile && (
                      <span className="text-xs text-primary">
                        {t('profileSelector.active')}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {profile.baseUrl}
                  </div>
                </div>
                {isSelected && (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                )}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
