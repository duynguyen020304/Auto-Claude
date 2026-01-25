/**
 * GitHubAccountItem - Display a linked GitHub account with unlink functionality
 *
 * This component displays a single linked GitHub account with:
 * - Avatar and username
 * - Linked date
 * - Unlink button with confirmation dialog
 *
 * Used in the settings page to show linked GitHub accounts.
 *
 * Usage:
 *   <GitHubAccountItem
 *     account={githubAccount}
 *     onUnlink={(accountId) => console.log('Unlinked:', accountId)}
 *   />
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Github, Loader2, Unlink } from 'lucide-react';
import { Button } from './ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { useToast } from '../hooks/use-toast';
import { cn } from '../lib/utils';

/**
 * GitHub account information structure
 */
export interface GitHubAccount {
  id: string;
  githubId: number;
  username: string;
  avatarUrl?: string;
  linkedAt: string;
}

interface GitHubAccountItemProps {
  /**
   * GitHub account to display
   */
  account: GitHubAccount;
  /**
   * Callback fired when account is unlinked
   */
  onUnlink: (accountId: string) => Promise<void>;
  /**
   * Disable the unlink button
   * @default false
   */
  disabled?: boolean;
  /**
   * Additional CSS class names
   */
  className?: string;
}

/**
 * Format a date string to a localized display format
 */
function formatLinkedDate(dateString: string, locale: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * GitHubAccountItem - Display linked GitHub account with unlink button
 */
export function GitHubAccountItem({
  account,
  onUnlink,
  disabled = false,
  className
}: GitHubAccountItemProps) {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const { toast } = useToast();

  const [isUnlinking, setIsUnlinking] = useState(false);
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false);

  /**
   * Handle unlink action with confirmation
   */
  const handleUnlink = async () => {
    setIsUnlinking(true);
    setShowUnlinkDialog(false);

    try {
      await onUnlink(account.id);

      // Show success toast
      toast({
        title: t('settings:githubAccounts.unlinkSuccess.title'),
        description: t('settings:githubAccounts.unlinkSuccess.description', {
          username: account.username,
        }),
      });

    } catch (error) {
      // Show error toast
      const errorMessage = error instanceof Error ? error.message : 'Failed to unlink account';
      toast({
        variant: 'destructive',
        title: t('settings:githubAccounts.unlinkError.title'),
        description: t('settings:githubAccounts.unlinkError.description'),
      });
    } finally {
      setIsUnlinking(false);
    }
  };

  // Format the linked date
  const linkedDate = formatLinkedDate(account.linkedAt, i18n.language);

  return (
    <>
      <div
        className={cn(
          'flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors',
          className
        )}
      >
        {/* Account Info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Avatar */}
          <div className="flex-shrink-0">
            {account.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt={account.username}
                className="h-10 w-10 rounded-full border border-border"
              />
            ) : (
              <div className="h-10 w-10 rounded-full bg-muted border border-border flex items-center justify-center">
                <Github className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Username and Link Date */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {account.username}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('settings:githubAccounts.linkedAt', { date: linkedDate })}
            </p>
          </div>
        </div>

        {/* Unlink Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowUnlinkDialog(true)}
          disabled={disabled || isUnlinking}
          className="flex-shrink-0"
        >
          {isUnlinking ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('settings:githubAccounts.unlinking')}
            </>
          ) : (
            <>
              <Unlink className="mr-2 h-4 w-4" />
              {t('settings:githubAccounts.unlinkAccount')}
            </>
          )}
        </Button>
      </div>

      {/* Unlink Confirmation Dialog */}
      <AlertDialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings:githubAccounts.unlinkAccount')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to unlink the GitHub account "{account.username}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnlinking}>
              {t('common:cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnlink}
              disabled={isUnlinking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isUnlinking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('settings:githubAccounts.unlinking')}
                </>
              ) : (
                t('common:confirm')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
