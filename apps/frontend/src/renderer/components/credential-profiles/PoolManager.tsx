/**
 * PoolManager - Display and manage credential pools
 *
 * Shows all configured credential pools with an "Add Pool" button.
 * Displays empty state when no pools exist.
 * Allows editing and deleting pools.
 * Shows contained profiles (API + OAuth), task count vs. limit, and rotation configuration.
 */
import { useState } from 'react';
import { Plus, Trash2, Pencil, Layers, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useSettingsStore } from '../../stores/settings-store';
import { cn } from '../../lib/utils';
import { useToast } from '../../hooks/use-toast';
import type { Pool } from '@shared/types/credential-profile';
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
// TODO: Import PoolFormDialog in subtask-6-2
// import { PoolFormDialog } from './PoolFormDialog';

interface PoolManagerProps {
  /** Optional callback when a pool is saved */
  onPoolSaved?: () => void;
}

export function PoolManager({ onPoolSaved }: PoolManagerProps) {
  const { t } = useTranslation();
  const {
    pools,
    credentialProfiles,
    deletePool,
    poolsError
  } = useSettingsStore();

  const { toast } = useToast();

  const [editPool, setEditPool] = useState<Pool | null>(null);
  const [deleteConfirmPool, setDeleteConfirmPool] = useState<Pool | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeletePool = async () => {
    if (!deleteConfirmPool) return;

    setIsDeleting(true);
    const success = await deletePool(deleteConfirmPool.id);
    setIsDeleting(false);

    if (success) {
      toast({
        title: t('settings:pools.toast.delete.title'),
        description: t('settings:pools.toast.delete.description', {
          name: deleteConfirmPool.name
        }),
      });
      setDeleteConfirmPool(null);
      if (onPoolSaved) {
        onPoolSaved();
      }
    } else {
      toast({
        variant: 'destructive',
        title: t('settings:pools.toast.delete.errorTitle'),
        description: poolsError || t('settings:pools.toast.delete.errorFallback'),
      });
    }
  };

  /**
   * Get profiles contained in a pool
   */
  const getPoolProfiles = (pool: Pool) => {
    return credentialProfiles.filter(profile => pool.profile_ids.includes(profile.id));
  };

  /**
   * Count profiles by type in a pool
   */
  const getProfileTypeCounts = (pool: Pool) => {
    const profiles = getPoolProfiles(pool);
    return {
      api: profiles.filter(p => p.type === 'api_key').length,
      oauth: profiles.filter(p => p.type === 'oauth').length,
      total: profiles.length
    };
  };

  /**
   * Calculate task usage for a pool
   * NOTE: This will be updated in subtask-7-2 when we implement UsageMonitor
   * For now, we show 0 tasks as placeholder
   */
  const getTaskUsage = (pool: Pool) => {
    // TODO: Implement actual task counting when UsageMonitor is created
    // For now, return placeholder values
    return {
      current: 0,
      limit: pool.limit,
      percentage: pool.limit > 0 ? 0 : 0
    };
  };

  /**
   * Get rotation mode label
   */
  const getRotationModeLabel = (mode: string): string => {
    const labels: Record<string, string> = {
      manual: t('settings:pools.rotationMode.manual'),
      round_robin: t('settings:pools.rotationMode.roundRobin'),
      usage_based: t('settings:pools.rotationMode.usageBased'),
      rate_limit_aware: t('settings:pools.rotationMode.rateLimitAware')
    };
    return labels[mode] || mode;
  };

  return (
    <div className="space-y-4">
      {/* Header with Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('settings:pools.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('settings:pools.description')}
          </p>
        </div>
        <Button onClick={() => setEditPool(null)} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          {t('settings:pools.addButton')}
        </Button>
      </div>

      {/* Empty state */}
      {pools.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 border border-dashed rounded-lg">
          <Layers className="h-12 w-12 text-muted-foreground mb-4" />
          <h4 className="text-lg font-medium mb-2">{t('settings:pools.empty.title')}</h4>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
            {t('settings:pools.empty.description')}
          </p>
          <Button onClick={() => setEditPool(null)} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            {t('settings:pools.empty.action')}
          </Button>
        </div>
      )}

      {/* Pool list */}
      {pools.length > 0 && (
        <div className="space-y-2">
          {pools.map((pool) => {
            const profileCounts = getProfileTypeCounts(pool);
            const taskUsage = getTaskUsage(pool);

            return (
              <div
                key={pool.id}
                className={cn(
                  'flex items-center justify-between p-4 rounded-lg border transition-colors',
                  'border-border hover:bg-accent/50'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium truncate">{pool.name}</h4>

                    {/* Profile count badge */}
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                      {profileCounts.total === 1
                        ? t('settings:pools.profileCount.single', { count: profileCounts.total })
                        : t('settings:pools.profileCount.multiple', { count: profileCounts.total })
                      }
                    </span>

                    {/* Profile type breakdown */}
                    {profileCounts.total > 0 && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {profileCounts.api > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            {t('settings:pools.profileType.api')} {profileCounts.api}
                          </span>
                        )}
                        {profileCounts.oauth > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            {t('settings:pools.profileType.oauth')} {profileCounts.oauth}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Rotation mode */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="text-xs">
                      {t('settings:pools.rotationMode.label')}: {getRotationModeLabel(pool.rotation_config.mode)}
                    </span>
                  </div>

                  {/* Task count vs. limit */}
                  {pool.limit > 0 && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>{t('settings:pools.taskUsage.label')}</span>
                        <span>
                          {taskUsage.current} / {taskUsage.limit}
                          {taskUsage.limit > 0 && ` (${Math.round(taskUsage.percentage)}%)`}
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                        <div
                          className={cn(
                            'h-full transition-all duration-300',
                            taskUsage.percentage >= 90
                              ? 'bg-red-500'
                              : taskUsage.percentage >= 70
                                ? 'bg-yellow-500'
                                : 'bg-green-500'
                          )}
                          style={{ width: `${Math.min(taskUsage.percentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Show rate limit threshold if rate_limit_aware mode */}
                  {pool.rotation_config.mode === 'rate_limit_aware' && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {t('settings:pools.rateLimitThreshold', {
                        threshold: pool.rotation_config.rate_limit_threshold
                      })}
                    </div>
                  )}

                  {/* No profiles warning */}
                  {profileCounts.total === 0 && (
                    <div className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">
                      {t('settings:pools.warnings.noProfiles')}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditPool(pool)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('settings:pools.tooltips.edit')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirmPool(pool)}
                        className="text-destructive hover:text-destructive"
                        data-testid={`pool-delete-button-${pool.id}`}
                        aria-label={t('settings:pools.deleteAriaLabel', {
                          name: pool.name
                        })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('settings:pools.tooltips.delete')}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteConfirmPool !== null}
        onOpenChange={() => setDeleteConfirmPool(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings:pools.dialog.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings:pools.dialog.deleteDescription', {
                name: deleteConfirmPool?.name ?? ''
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t('settings:pools.dialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePool}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting
                ? t('settings:pools.dialog.deleting')
                : t('settings:pools.dialog.delete')
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pool Form Dialog (Create/Edit) */}
      {/* TODO: Uncomment in subtask-6-2 when PoolFormDialog is created */}
      {/* <PoolFormDialog
        open={editPool !== null}
        onOpenChange={(open) => {
          if (!open) setEditPool(null);
        }}
        pool={editPool ?? undefined}
        onSaved={() => {
          if (onPoolSaved) {
            onPoolSaved();
          }
        }}
      /> */}
    </div>
  );
}
