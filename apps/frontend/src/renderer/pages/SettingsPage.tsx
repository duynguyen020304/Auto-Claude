import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Github, LogOut, User as UserIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog';
import { useAuthStore } from '../stores/authStore';
import { getGitHubAccounts, unlinkGitHubAccount } from '../../api/github';
import type { GitHubAccount } from '../../shared/types/auth';
import { AuthApiError } from '../../api/auth';

/**
 * Settings page component
 *
 * Provides user account management:
 * - View user profile (email, member since date)
 * - Manage linked GitHub accounts
 * - Logout
 *
 * Features:
 * - Display user email and join date
 * - List linked GitHub accounts with avatars
 * - Link new GitHub accounts via OAuth
 * - Unlink existing GitHub accounts
 * - Logout with confirmation dialog
 * - Error handling with user-friendly messages
 * - i18n support for all UI text
 * - Loading state during operations
 */
export function SettingsPage() {
  const { t } = useTranslation(['settings', 'common', 'dialogs', 'buttons']);
  const { user, token, logout, fetchProfile } = useAuthStore();

  const [githubAccounts, setGithubAccounts] = useState<GitHubAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Format date to readable string
   */
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  /**
   * Fetch linked GitHub accounts
   */
  const loadGitHubAccounts = async () => {
    if (!token) {
      return;
    }

    setIsLoadingAccounts(true);
    setError(null);

    try {
      const accounts = await getGitHubAccounts();
      setGithubAccounts(accounts);
    } catch (err) {
      const errorMessage = err instanceof AuthApiError
        ? err.message
        : t('settings:githubAccounts.linkError.description');
      setError(errorMessage);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  /**
   * Unlink a GitHub account
   */
  const handleUnlinkAccount = async (accountId: number) => {
    setIsUnlinking(accountId);
    setError(null);

    try {
      await unlinkGitHubAccount(accountId);

      // Remove account from local state
      setGithubAccounts((prev) => prev.filter((acc) => acc.id !== accountId));

      // Refresh user profile to update github_accounts
      await fetchProfile();
    } catch (err) {
      const errorMessage = err instanceof AuthApiError
        ? err.message
        : t('settings:githubAccounts.unlinkError.description');
      setError(errorMessage);
    } finally {
      setIsUnlinking(null);
    }
  };

  /**
   * Handle GitHub OAuth callback
   *
   * This function is called when the user is redirected back to the settings page
   * after completing the GitHub OAuth flow. It checks for the OAuth success flag
   * in sessionStorage and reloads the accounts if present.
   */
  useEffect(() => {
    const checkOAuthCallback = () => {
      const oauthSuccess = sessionStorage.getItem('github_oauth_success');
      if (oauthSuccess === 'true') {
        // Clear the flag
        sessionStorage.removeItem('github_oauth_success');
        // Reload the accounts
        loadGitHubAccounts();
      }
    };

    checkOAuthCallback();
  }, [token]);

  /**
   * Load GitHub accounts on component mount
   */
  useEffect(() => {
    loadGitHubAccounts();
  }, [token]);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t('settings:userProfile.title')}</CardTitle>
            <CardDescription>{t('errors:notFound')}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t('settings:title')}</h1>
        <p className="text-muted-foreground mt-2">{t('settings:userProfile.description')}</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 rounded-md bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="space-y-6">
        {/* User Profile Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="h-5 w-5" />
              {t('settings:userProfile.title')}
            </CardTitle>
            <CardDescription>{t('settings:userProfile.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Email */}
            <div className="flex items-center justify-between py-2 border-b">
              <div>
                <p className="text-sm font-medium">{t('settings:userProfile.email')}</p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>

            {/* Member Since */}
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">
                  {t('settings:userProfile.memberSince', {
                    date: formatDate(user.created_at),
                  })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* GitHub Accounts Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              {t('settings:githubAccounts.title')}
            </CardTitle>
            <CardDescription>{t('settings:githubAccounts.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Link Account Button */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {t('settings:githubAccounts.linkAccountDescription')}
              </p>
              <Button
                onClick={() => {
                  // Store current URL for redirect after OAuth
                  sessionStorage.setItem('github_oauth_redirect', '/settings');
                  // Redirect to GitHub OAuth endpoint
                  window.location.href = 'http://localhost:8000/github/link';
                }}
                variant="outline"
                className="gap-2"
              >
                <Github className="h-4 w-4" />
                {t('settings:githubAccounts.linkAccount')}
              </Button>
            </div>

            {/* Accounts List */}
            {isLoadingAccounts ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t('labels.loading')}
              </div>
            ) : githubAccounts.length === 0 ? (
              <div className="py-8 text-center">
                <Github className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-sm font-medium">{t('settings:githubAccounts.noAccounts')}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('settings:githubAccounts.noAccountsDescription')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {githubAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card"
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <img
                        src={account.avatar_url}
                        alt={account.username}
                        className="h-10 w-10 rounded-full"
                      />
                      <div>
                        <p className="text-sm font-medium">{account.username}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('settings:githubAccounts.linkedAt', {
                            date: formatDate(account.linked_at),
                          })}
                        </p>
                      </div>
                    </div>

                    {/* Unlink Button */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isUnlinking === account.id}
                        >
                          {isUnlinking === account.id
                            ? t('settings:githubAccounts.unlinking')
                            : t('settings:githubAccounts.unlinkAccount')}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t('settings:githubAccounts.unlinkAccount')}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('dialogs:deleteDescription')}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('buttons.cancel')}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleUnlinkAccount(account.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {t('buttons.delete')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Logout Section */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('settings:userProfile.logout')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('settings:userProfile.logoutDescription')}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <LogOut className="h-4 w-4" />
                    {t('settings:userProfile.logout')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t('settings:userProfile.logout')}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('settings:userProfile.logoutDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('buttons.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={logout}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {t('settings:userProfile.logout')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
