import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Github } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { useAuthStore } from '../stores/authStore';
import { AuthApiError } from '../../api/auth';

/**
 * Login page component
 *
 * Provides dual authentication options:
 * - Email/password login
 * - GitHub OAuth login
 *
 * Features:
 * - Form validation (required fields)
 * - Error handling with user-friendly messages
 * - i18n support for all UI text
 * - Loading state during authentication
 * - Link to registration page
 */
export function LoginPage() {
  const { t } = useTranslation('common');
  const { login, loginWithGitHub, isLoading, error, clearError } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [validationErrors, setValidationErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  /**
   * Validate form fields
   */
  const validateForm = (): boolean => {
    const errors: typeof validationErrors = {};

    if (!email.trim()) {
      errors.email = t('auth.login.emailRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = t('auth.register.invalidEmail');
    }

    if (!password.trim()) {
      errors.password = t('auth.login.passwordRequired');
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Clear previous errors
    clearError();

    // Validate form
    if (!validateForm()) {
      return;
    }

    try {
      await login({ email: email.trim(), password });
      // On successful login, auth store will update and parent component will handle redirect
    } catch (error) {
      // Error is already set in auth store
      if (error instanceof AuthApiError) {
        // Show specific error message from API
        if (error.statusCode === 401) {
          setValidationErrors({
            email: t('auth.login.invalidCredentials'),
            password: t('auth.login.invalidCredentials'),
          });
        }
      }
    }
  };

  /**
   * Handle GitHub OAuth login
   */
  const handleGitHubLogin = () => {
    clearError();
    loginWithGitHub();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            {t('auth.login.title')}
          </CardTitle>
          <CardDescription className="text-center">
            Enter your email and password to sign in to your account
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email field */}
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.login.email')}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t('auth.login.emailPlaceholder')}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  // Clear validation error when user starts typing
                  if (validationErrors.email) {
                    setValidationErrors((prev) => ({ ...prev, email: undefined }));
                  }
                }}
                disabled={isLoading}
                aria-invalid={!!validationErrors.email}
                aria-describedby={validationErrors.email ? 'email-error' : undefined}
                autoComplete="email"
              />
              {validationErrors.email && (
                <p id="email-error" className="text-sm text-destructive">
                  {validationErrors.email}
                </p>
              )}
            </div>

            {/* Password field */}
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.login.password')}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t('auth.login.passwordPlaceholder')}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  // Clear validation error when user starts typing
                  if (validationErrors.password) {
                    setValidationErrors((prev) => ({ ...prev, password: undefined }));
                  }
                }}
                disabled={isLoading}
                aria-invalid={!!validationErrors.password}
                aria-describedby={validationErrors.password ? 'password-error' : undefined}
                autoComplete="current-password"
              />
              {validationErrors.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {validationErrors.password}
                </p>
              )}
            </div>

            {/* General error message */}
            {error && !validationErrors.email && !validationErrors.password && (
              <div className="rounded-md bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Login button */}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t('labels.loading') : t('auth.login.loginButton')}
            </Button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  Or continue with
                </span>
              </div>
            </div>

            {/* GitHub login button */}
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={handleGitHubLogin}
              disabled={isLoading}
            >
              <Github className="h-4 w-4" />
              {t('auth.login.loginWithGitHub')}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            {t('auth.login.noAccount')}{' '}
            <a
              href="/register"
              className="text-primary underline-offset-4 hover:underline"
            >
              {t('auth.login.registerLink')}
            </a>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
