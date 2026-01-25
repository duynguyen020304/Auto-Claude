/**
 * Authentication and User Types
 *
 * Types for user accounts, JWT tokens, and dual authentication system
 * (email/password and GitHub OAuth)
 */

/**
 * User account information
 */
export interface User {
  id: number; // Database ID
  email: string; // User email (unique)
  created_at: string; // ISO timestamp when account was created
}

/**
 * GitHub account linked to a user
 */
export interface GitHubAccount {
  id: number; // Database ID
  user_id: number; // Foreign key to users.id
  github_id: number; // GitHub user ID
  username: string; // GitHub username
  avatar_url: string; // GitHub avatar URL
  linked_at: string; // ISO timestamp when account was linked
}

/**
 * User profile with linked GitHub accounts
 */
export interface UserProfile extends User {
  github_accounts?: GitHubAccount[]; // Linked GitHub accounts (optional)
}

/**
 * JWT token response from authentication endpoints
 */
export interface AuthToken {
  access_token: string; // JWT access token
  token_type: string; // Token type (usually "Bearer")
  expires_in?: number; // Expiration time in seconds (optional)
}

/**
 * Authentication response with user data and token
 */
export interface AuthResponse extends AuthToken {
  user: User; // Authenticated user information
}

/**
 * Login credentials for email/password authentication
 */
export interface LoginCredentials {
  email: string; // User email
  password: string; // User password
}

/**
 * Registration data for new user account
 */
export interface RegisterData {
  email: string; // User email
  password: string; // User password (min 8 characters)
}

/**
 * Token payload (decoded JWT)
 */
export interface TokenPayload {
  sub: number; // User ID (subject)
  exp: number; // Expiration timestamp (Unix epoch)
  iat?: number; // Issued at timestamp (Unix epoch, optional)
}

/**
 * Authentication state in frontend
 */
export interface AuthState {
  user: User | null; // Current authenticated user (null if not authenticated)
  token: string | null; // JWT access token (null if not authenticated)
  isAuthenticated: boolean; // Authentication status
}
