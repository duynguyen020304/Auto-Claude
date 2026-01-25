/**
 * GitHubLinkButton - Button component for linking GitHub accounts via OAuth
 *
 * This component provides a button that initiates the GitHub OAuth flow to link
 * a GitHub account to the user's profile. It handles loading states, errors,
 * and success feedback.
 *
 * Usage:
 *   <GitHubLinkButton
 *     onLinkComplete={(githubAccount) => console.log('Linked:', githubAccount)}
 *     onError={(error) => console.error('Error:', error)}
 *   />
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Github, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { useToast } from '../hooks/use-toast';

/**
 * GitHub account information returned after successful linking
 */
export interface GitHubAccount {
  id: string;
  githubId: number;
  username: string;
  avatarUrl?: string;
  linkedAt: string;
}

interface GitHubLinkButtonProps {
  /**
   * Callback fired when GitHub account is successfully linked
   */
  onLinkComplete?: (account: GitHubAccount) => void;
  /**
   * Callback fired when linking fails
   */
  onError?: (error: string) => void;
  /**
   * Button variant (default, outline, ghost, etc.)
   * @default 'default'
   */
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  /**
   * Button size
   * @default 'default'
   */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /**
   * Optional custom label for the button
   * If not provided, uses i18n key 'settings:githubAccounts.linkAccount'
   */
  label?: string;
  /**
   * Disable the button
   * @default false
   */
  disabled?: boolean;
  /**
   * Additional CSS class names
   */
  className?: string;
}

/**
 * GitHubLinkButton - Initiates OAuth flow to link GitHub account
 */
export function GitHubLinkButton({
  onLinkComplete,
  onError,
  variant = 'default',
  size = 'default',
  label,
  disabled = false,
  className
}: GitHubLinkButtonProps) {
  const { t } = useTranslation(['settings', 'common']);
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  /**
   * Initiate GitHub OAuth flow
   * This will trigger the OAuth flow for linking a GitHub account
   * The actual implementation will depend on the backend API setup
   */
  const handleLinkGitHub = useCallback(async () => {
    setIsLoading(true);
    setIsSuccess(false);

    try {
      // TODO: Implement GitHub OAuth flow
      // This will be implemented when the backend authentication API is ready
      // For now, show a placeholder message

      // Simulate OAuth delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Show success state (placeholder)
      setIsSuccess(true);
      setIsLoading(false);

      // Show info toast about implementation status
      toast({
        title: t('common:info'),
        description: 'GitHub OAuth flow will be implemented with backend API',
      });

      // Call success callback with placeholder data
      onLinkComplete?.({
        id: 'placeholder',
        githubId: 0,
        username: 'placeholder',
        linkedAt: new Date().toISOString(),
      });

    } catch (error) {
      setIsLoading(false);
      const errorMessage = error instanceof Error ? error.message : 'Failed to link GitHub account';
      toast({
        variant: 'destructive',
        title: t('common:error'),
        description: errorMessage,
      });
      onError?.(errorMessage);
    }
  }, [onLinkComplete, onError, toast, t]);

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleLinkGitHub}
      disabled={disabled || isLoading}
      className={className}
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('common:loading')}
        </>
      ) : isSuccess ? (
        <>
          <CheckCircle2 className="mr-2 h-4 w-4 text-success" />
          {t('common:success')}
        </>
      ) : (
        <>
          <Github className="mr-2 h-4 w-4" />
          {label || t('settings:githubAccounts.linkAccount')}
        </>
      )}
    </Button>
  );
}
