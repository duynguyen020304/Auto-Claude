/**
 * GitHub API Client
 *
 * Client functions for GitHub account management:
 * - Link GitHub account via OAuth
 * - List linked GitHub accounts
 * - Unlink GitHub accounts
 *
 * Base URL: Configured via VITE_API_URL environment variable (default: http://localhost:8000)
 */

import type { GitHubAccount } from '../shared/types/auth';
import { getAuthToken } from './auth';
import { AuthApiError } from './auth';

/**
 * Base URL for the GitHub API
 *
 * The backend FastAPI server runs on localhost:8000 by default.
 * This can be overridden via environment variable if needed.
 */
const API_BASE_URL = 'http://localhost:8000';

/**
 * Link GitHub account request
 */
export interface LinkGitHubAccountRequest {
  code: string; // OAuth authorization code from GitHub
}

/**
 * Link GitHub account response
 */
export interface LinkGitHubAccountResponse {
  id: number;
  user_id: number;
  github_id: number;
  username: string;
  avatar_url: string;
  linked_at: string;
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
 * Link a GitHub account to the authenticated user
 *
 * This endpoint should be called after receiving an OAuth authorization code
 * from GitHub. The code will be exchanged for an access token, and the GitHub
 * user profile will be fetched and linked to the user's account.
 *
 * @param code - OAuth authorization code from GitHub
 * @returns Promise resolving to linked GitHub account
 * @throws AuthApiError on linking failure
 *
 * Example:
 * ```ts
 * const account = await linkGitHubAccount('github_oauth_code');
 * console.log(account.username); // 'githubusername'
 * ```
 */
export async function linkGitHubAccount(code: string): Promise<GitHubAccount> {
  const token = getAuthToken();
  if (!token) {
    throw new AuthApiError('No authentication token available', 401);
  }

  const response = await fetch(`${API_BASE_URL}/github/link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ code }),
  });

  return handleResponse<LinkGitHubAccountResponse>(response);
}

/**
 * Get all GitHub accounts linked to the authenticated user
 *
 * Returns a list of all GitHub accounts that have been linked to the user's
 * account, ordered by most recently linked first.
 *
 * @returns Promise resolving to array of linked GitHub accounts
 * @throws AuthApiError if token is invalid or expired
 *
 * Example:
 * ```ts
 * const accounts = await getGitHubAccounts();
 * accounts.forEach(account => {
 *   console.log(account.username); // 'githubusername'
 * });
 * ```
 */
export async function getGitHubAccounts(): Promise<GitHubAccount[]> {
  const token = getAuthToken();
  if (!token) {
    throw new AuthApiError('No authentication token available', 401);
  }

  const response = await fetch(`${API_BASE_URL}/github/accounts`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<GitHubAccount[]>(response);
}

/**
 * Unlink a GitHub account from the authenticated user
 *
 * Removes the link between a GitHub account and the user's account.
 * The account must belong to the authenticated user.
 *
 * @param accountId - Database ID of the GitHub account to unlink
 * @returns Promise that resolves on success
 * @throws AuthApiError if token is invalid, account not found, or account belongs to different user
 *
 * Example:
 * ```ts
 * await unlinkGitHubAccount(123);
 * console.log('Account unlinked successfully');
 * ```
 */
export async function unlinkGitHubAccount(accountId: number): Promise<void> {
  const token = getAuthToken();
  if (!token) {
    throw new AuthApiError('No authentication token available', 401);
  }

  const response = await fetch(`${API_BASE_URL}/github/unlink/${accountId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (response.status === 204) {
    return;
  }

  // For error responses, try to parse the error message
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
}
