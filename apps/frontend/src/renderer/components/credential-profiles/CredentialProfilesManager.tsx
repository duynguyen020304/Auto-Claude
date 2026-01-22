/**
 * CredentialProfilesManager - Display and manage credential profiles
 *
 * Shows all configured credential profiles (OAuth and API Key types) with an "Add Profile" button.
 * Displays empty state when no profiles exist.
 * Allows editing and deleting profiles.
 * Shows type badges (OAuth/API) and usage limits for API profiles.
 */
import { useState } from 'react';
import { Plus, Trash2, Pencil, Key, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useSettingsStore } from '../../stores/settings-store';
import { cn } from '../../lib/utils';
import { useToast } from '../../hooks/use-toast';
import type { CredentialProfile } from '@shared/types/credential-profile';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog';
import { ProfileFormDialog } from './ProfileFormDialog';

interface CredentialProfilesManagerProps {
  /** Optional callback when a profile is saved */
  onProfileSaved?: () => void;
}

export function CredentialProfilesManager({ onProfileSaved }: CredentialProfilesManagerProps) {
  const { t } = useTranslation();
  const {
    credentialProfiles,
    deleteCredentialProfile,
    credentialProfilesError
  } = useSettingsStore();

  const { toast } = useToast();

  const [editProfile, setEditProfile] = useState<CredentialProfile | null>(null);
  const [deleteConfirmProfile, setDeleteConfirmProfile] = useState<CredentialProfile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteProfile = async () => {
    if (!deleteConfirmProfile) return;

    setIsDeleting(true);
    const success = await deleteCredentialProfile(deleteConfirmProfile.id);
    setIsDeleting(false);

    if (success) {
      toast({
        title: t('settings:credentialProfiles.toast.delete.title'),
        description: t('settings:credentialProfiles.toast.delete.description', {
          name: deleteConfirmProfile.name
        }),
      });
      setDeleteConfirmProfile(null);
      if (onProfileSaved) {
        onProfileSaved();
      }
    } else {
      toast({
        variant: 'destructive',
        title: t('settings:credentialProfiles.toast.delete.errorTitle'),
        description: credentialProfilesError || t('settings:credentialProfiles.toast.delete.errorFallback'),
      });
    }
  };

  const getProfileTypeLabel = (type: 'api_key' | 'oauth'): string => {
    return type === 'api_key'
      ? t('settings:credentialProfiles.type.api')
      : t('settings:credentialProfiles.type.oauth');
  };

  const getProfileTypeBadgeClass = (type: 'api_key' | 'oauth'): string => {
    return cn(
      'text-xs px-2 py-0.5 rounded-full font-medium',
      type === 'api_key'
        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    );
  };

  const maskCredential = (credential: string): string => {
    if (credential.length <= 8) {
      return '*'.repeat(credential.length);
    }
    return `${credential.slice(0, 4)}${'*'.repeat(credential.length - 8)}${credential.slice(-4)}`;
  };

  return (
    <div className="space-y-4">
      {/* Header with Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('settings:credentialProfiles.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('settings:credentialProfiles.description')}
          </p>
        </div>
        <Button onClick={() => setEditProfile(null)} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          {t('settings:credentialProfiles.addButton')}
        </Button>
      </div>

      {/* Empty state */}
      {credentialProfiles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 border border-dashed rounded-lg">
          <KeyRound className="h-12 w-12 text-muted-foreground mb-4" />
          <h4 className="text-lg font-medium mb-2">{t('settings:credentialProfiles.empty.title')}</h4>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
            {t('settings:credentialProfiles.empty.description')}
          </p>
          <Button onClick={() => setEditProfile(null)} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            {t('settings:credentialProfiles.empty.action')}
          </Button>
        </div>
      )}

      {/* Profile list */}
      {credentialProfiles.length > 0 && (
        <div className="space-y-2">
          {credentialProfiles.map((profile) => (
            <div
              key={profile.id}
              className={cn(
                'flex items-center justify-between p-4 rounded-lg border transition-colors',
                'border-border hover:bg-accent/50'
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-medium truncate">{profile.name}</h4>
                  <span className={getProfileTypeBadgeClass(profile.type)}>
                    {getProfileTypeLabel(profile.type)}
                  </span>
                  {profile.status === 'active' && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      {t('settings:credentialProfiles.status.active')}
                    </span>
                  )}
                  {profile.status === 'rate_limited' && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                      {t('settings:credentialProfiles.status.rateLimited')}
                    </span>
                  )}
                  {profile.status === 'disabled' && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400">
                      {t('settings:credentialProfiles.status.disabled')}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Key className="h-3 w-3" />
                    <span className="truncate max-w-[200px]">
                      {maskCredential(profile.credential_value)}
                    </span>
                  </div>
                </div>

                {/* API Key profiles show usage limit */}
                {profile.type === 'api_key' && profile.metadata?.usage_limit && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t('settings:credentialProfiles.usageLimit', {
                      limit: profile.metadata.usage_limit
                    })}
                  </div>
                )}

                {/* Show rotation mode if configured */}
                {profile.metadata?.rotation_mode && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('settings:credentialProfiles.rotationMode', {
                      mode: profile.metadata.rotation_mode
                    })}
                  </div>
                )}

                {/* Show usage metrics if available */}
                {profile.usage_metrics && profile.usage_metrics.total_requests > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t('settings:credentialProfiles.usageMetrics', {
                      requests: profile.usage_metrics.total_requests,
                      tokens: profile.usage_metrics.total_tokens
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditProfile(profile)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('settings:credentialProfiles.tooltips.edit')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteConfirmProfile(profile)}
                      className="text-destructive hover:text-destructive"
                      data-testid={`credential-profile-delete-button-${profile.id}`}
                      aria-label={t('settings:credentialProfiles.deleteAriaLabel', {
                        name: profile.name
                      })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('settings:credentialProfiles.tooltips.delete')}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteConfirmProfile !== null}
        onOpenChange={() => setDeleteConfirmProfile(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings:credentialProfiles.dialog.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings:credentialProfiles.dialog.deleteDescription', {
                name: deleteConfirmProfile?.name ?? ''
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t('settings:credentialProfiles.dialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProfile}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting
                ? t('settings:credentialProfiles.dialog.deleting')
                : t('settings:credentialProfiles.dialog.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Profile Form Dialog (Create/Edit) */}
      <ProfileFormDialog
        open={editProfile !== null}
        onOpenChange={(open) => {
          if (!open) setEditProfile(null);
        }}
        profile={editProfile ?? undefined}
        onSaved={() => {
          if (onProfileSaved) {
            onProfileSaved();
          }
        }}
      />
    </div>
  );
}
