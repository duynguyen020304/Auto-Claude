import { useEffect, ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * Props for AuthGuard component
 */
interface AuthGuardProps {
  /**
   * Child components to render if authenticated
   */
  children: ReactNode;
}

/**
 * Navigate to a path
 *
 * Since this Electron app doesn't use React Router,
 * we use window.location for navigation.
 *
 * @param path - Path to navigate to (e.g., '/login')
 */
function navigate(path: string): void {
  // In Electron with hash-based routing, navigate to hash path
  window.location.hash = path;
}

/**
 * AuthGuard component
 *
 * Routing guard that redirects unauthenticated users to the login page.
 * Renders children only when user is authenticated.
 *
 * Features:
 * - Checks authentication status from authStore
 * - Redirects to /login if not authenticated
 * - Prevents flash of unauthenticated content during token validation
 * - Handles initialization state (shows loading while validating token)
 *
 * Usage:
 * ```tsx
 * <AuthGuard>
 *   <ProtectedPage />
 * </AuthGuard>
 * ```
 *
 * @param props - AuthGuard props
 * @returns Rendered children or redirects to login
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading, initialize } = useAuthStore();

  /**
   * Initialize auth state on mount
   *
   * Loads token from localStorage and validates it with backend.
   * This ensures authentication state is restored on page refresh.
   */
  useEffect(() => {
    initialize();
  }, [initialize]);

  /**
   * Redirect to login if not authenticated
   *
   * Only redirect after initialization is complete to avoid
   * redirecting while token is being validated.
   */
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Store current path for redirect after login
      const currentPath = window.location.hash || '#/';
      sessionStorage.setItem('redirectPath', currentPath);

      // Redirect to login page
      navigate('/login');
    }
  }, [isLoading, isAuthenticated]);

  /**
   * Show loading state during initialization
   *
   * This prevents flashing unauthenticated content while
   * the token is being validated.
   */
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-sm text-muted-foreground">Validating authentication...</p>
        </div>
      </div>
    );
  }

  /**
   * Render children only if authenticated
   */
  return isAuthenticated ? <>{children}</> : null;
}
