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
 * Register page component
 *
 * Provides dual registration options:
 * - Email/password registration
 * - GitHub OAuth registration
 *
 * Features:
 * - Form validation (required fields, email format, password strength, password confirmation)
 * - Error handling with user-friendly messages
 * - i18n support for all UI text
 * - Loading state during registration
 * - Link to login page
 */
export function RegisterPage() {
  const { t } = useTranslation('common');
  const { register, loginWithGitHub, isLoading, error, clearError } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationErrors, setValidationErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});

  /**
   * Validate form fields
   */
  const validateForm = (): boolean => {
    const errors: typeof validationErrors = {};

    // Email validation
    if (!email.trim()) {
      errors.email = t('auth.register.emailRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = t('auth.register.invalidEmail');
    }

    // Password validation
    if (!password.trim()) {
      errors.password = t('auth.register.passwordRequired');
    } else if (password.length < 8) {
      errors.password = t('auth.register.passwordTooShort');
    }

    // Confirm password validation
    if (!confirmPassword.trim()) {
      errors.confirmPassword = t('auth.register.confirmPasswordRequired');
    } else if (password !== confirmPassword) {
      errors.confirmPassword = t('auth.register.passwordsDoNotMatch');
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
      await register({ email: email.trim(), password });
      // On successful registration, auth store will update and parent component will handle redirect
    } catch (error) {
      // Error is already set in auth store
      if (error instanceof AuthApiError) {
        // Show specific error message from API
        if (error.statusCode === 409) {
          setValidationErrors({
            email: t('auth.register.emailAlreadyExists'),
          });
        }
      }
    }
  };

  /**
   * Handle GitHub OAuth registration
   */
  const handleGitHubRegister = () => {
    clearError();
    loginWithGitHub();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            {t('auth.register.title')}
          </CardTitle>
          <CardDescription className="text-center">
            Enter your email and password to create a new account
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email field */}
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.register.email')}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t('auth.register.emailPlaceholder')}
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
              <Label htmlFor="password">{t('auth.register.password')}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t('auth.register.passwordPlaceholder')}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  // Clear validation errors when user starts typing
                  if (validationErrors.password || validationErrors.confirmPassword) {
                    setValidationErrors((prev) => ({
                      ...prev,
                      password: undefined,
                      confirmPassword: undefined,
                    }));
                  }
                }}
                disabled={isLoading}
                aria-invalid={!!validationErrors.password}
                aria-describedby={
                  validationErrors.password ? 'password-error' : undefined
                }
                autoComplete="new-password"
              />
              {validationErrors.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {validationErrors.password}
                </p>
              )}
            </div>

            {/* Confirm password field */}
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t('auth.register.confirmPassword')}</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder={t('auth.register.confirmPasswordPlaceholder')}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  // Clear validation error when user starts typing
                  if (validationErrors.confirmPassword) {
                    setValidationErrors((prev) => ({
                      ...prev,
                      confirmPassword: undefined,
                    }));
                  }
                }}
                disabled={isLoading}
                aria-invalid={!!validationErrors.confirmPassword}
                aria-describedby={
                  validationErrors.confirmPassword ? 'confirm-password-error' : undefined
                }
                autoComplete="new-password"
              />
              {validationErrors.confirmPassword && (
                <p id="confirm-password-error" className="text-sm text-destructive">
                  {validationErrors.confirmPassword}
                </p>
              )}
            </div>

            {/* General error message */}
            {error &&
              !validationErrors.email &&
              !validationErrors.password &&
              !validationErrors.confirmPassword && (
                <div className="rounded-md bg-destructive/10 p-3">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

            {/* Register button */}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t('labels.loading') : t('auth.register.registerButton')}
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

            {/* GitHub registration button */}
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={handleGitHubRegister}
              disabled={isLoading}
            >
              <Github className="h-4 w-4" />
              {t('auth.register.registerWithGitHub')}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            {t('auth.register.hasAccount')}{' '}
            <a
              href="/login"
              className="text-primary underline-offset-4 hover:underline"
            >
              {t('auth.register.loginLink')}
            </a>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
