/**
 * Authentication API Client
 *
 * Client functions for authentication endpoints:
 * - Email/password registration and login
 * - GitHub OAuth authentication
 * - Get current user profile
 *
 * Base URL: Configured via VITE_API_URL environment variable (default: http://localhost:8000)
 */

import type {
  UserProfile,
  AuthResponse,
  RegisterData,
  LoginCredentials,
} from '../shared/types/auth';

/**
 * Base URL for the authentication API
 *
 * The backend FastAPI server runs on localhost:8000 by default.
 * This can be overridden via environment variable if needed.
 */
const API_BASE_URL = 'http://localhost:8000';

/**
 * Custom error class for authentication API errors
 */
export class AuthApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

/**
 * Handle fetch response and throw appropriate errors
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let details: unknown;

    try {
      const errorData = await response.json();
      errorMessage = errorData.detail || errorMessage;
      details = errorData;
    } catch {
      // If response is not JSON, use status text
    }

    throw new AuthApiError(errorMessage, response.status, details);
  }

  return response.json() as Promise<T>;
}

/**
 * Register a new user with email and password
 *
 * @param data - Registration data (email, password)
 * @returns Promise resolving to auth response with token and user
 * @throws AuthApiError on registration failure
 *
 * Example:
 * ```ts
 * const result = await register({
 *   email: 'user@example.com',
 *   password: 'securepassword123'
 * });
 * console.log(result.access_token); // JWT token
 * console.log(result.user.email); // 'user@example.com'
 * ```
 */
export async function register(data: RegisterData): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  return handleResponse<AuthResponse>(response);
}

/**
 * Login with email and password
 *
 * NOTE: This endpoint requires form-urlencoded data (not JSON)
 * because it uses FastAPI's OAuth2PasswordRequestForm.
 *
 * @param credentials - Login credentials (email, password)
 * @returns Promise resolving to auth response with token and user
 * @throws AuthApiError on login failure
 *
 * Example:
 * ```ts
 * const result = await login({
 *   email: 'user@example.com',
 *   password: 'securepassword123'
 * });
 * console.log(result.access_token); // JWT token
 * ```
 */
export async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  // OAuth2PasswordRequestForm requires form-urlencoded data
  // The 'username' field is used for email in OAuth2 spec
  const formData = new URLSearchParams();
  formData.append('username', credentials.email);
  formData.append('password', credentials.password);

  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData,
  });

  return handleResponse<AuthResponse>(response);
}

/**
 * Initiate GitHub OAuth login flow
 *
 * This function redirects the browser to GitHub's authorization page.
 * After user authorization, GitHub will redirect to the backend callback
 * endpoint (/auth/github/callback), which will create/login the user and
 * return a JWT token.
 *
 * The OAuth flow is:
 * 1. Frontend calls this function (or redirects directly to /auth/github)
 * 2. Backend redirects to GitHub authorization page
 * 3. User authorizes the application
 * 4. GitHub redirects to backend callback with authorization code
 * 5. Backend exchanges code for access token, creates user account
 * 6. Backend returns JWT token (usually via redirect to frontend with token)
 *
 * @returns void - This function initiates a redirect
 *
 * Example:
 * ```ts
 * // Redirect to GitHub OAuth page
 * githubLogin();
 * // Browser will navigate away to GitHub authorization page
 * ```
 *
 * Alternative: Redirect directly in component
 * ```tsx
 * <a href="${API_BASE_URL}/auth/github">Login with GitHub</a>
 * ```
 */
export function githubLogin(): void {
  // Redirect to backend GitHub OAuth endpoint
  window.location.href = `${API_BASE_URL}/auth/github`;
}

/**
 * Get current authenticated user profile
 *
 * Requires a valid JWT token in Authorization header.
 * Returns user profile including linked GitHub accounts.
 *
 * @param token - JWT access token
 * @returns Promise resolving to user profile
 * @throws AuthApiError if token is invalid or expired
 *
 * Example:
 * ```ts
 * const profile = await getMe(accessToken);
 * console.log(profile.email); // 'user@example.com'
 * console.log(profile.github_accounts); // Array of linked accounts
 * ```
 */
export async function getMe(token: string): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<UserProfile>(response);
}

/**
 * Store authentication token in localStorage
 *
 * @param token - JWT access token
 */
export function setAuthToken(token: string): void {
  localStorage.setItem('auth_token', token);
}

/**
 * Get authentication token from localStorage
 *
 * @returns JWT token or null if not found
 */
export function getAuthToken(): string | null {
  return localStorage.getItem('auth_token');
}

/**
 * Remove authentication token from localStorage
 *
 * Call this function when logging out
 */
export function clearAuthToken(): void {
  localStorage.removeItem('auth_token');
}

/**
 * Check if user is authenticated (has valid token in localStorage)
 *
 * Note: This only checks for token existence, not validity.
 * Use getMe() to verify token validity.
 *
 * @returns true if token exists in localStorage
 */
export function hasAuthToken(): boolean {
  return getAuthToken() !== null;
}
