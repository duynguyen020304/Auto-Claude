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

// ============================================
// History Types
// ============================================

/**
 * Chat history - stores conversation threads per user
 */
export interface ChatHistory {
  id: number; // Database ID
  user_id: number; // Foreign key to users.id
  title: string; // Chat thread title
  messages: Message[]; // Array of chat messages (JSON)
  created_at: string; // ISO timestamp when created
  updated_at: string; // ISO timestamp when last updated
}

/**
 * Individual message within a chat history
 */
export interface Message {
  role: 'user' | 'assistant'; // Message sender role
  content: string; // Message content
  timestamp?: string; // Optional timestamp (ISO format)
}

/**
 * Create chat history request
 */
export interface ChatHistoryCreate {
  title: string; // Chat thread title
  messages: Message[]; // Initial messages array
}

/**
 * Update chat history request
 */
export interface ChatHistoryUpdate {
  title?: string; // Optional new title
  messages?: Message[]; // Optional updated messages array
}

/**
 * Ideation history - saves brainstorming sessions per user
 */
export interface IdeationHistory {
  id: number; // Database ID
  user_id: number; // Foreign key to users.id
  title: string; // Ideation session title
  content: string; // Session content/text
  tags: string[]; // Array of tags for categorization
  created_at: string; // ISO timestamp when created
  updated_at: string; // ISO timestamp when last updated
}

/**
 * Create ideation history request
 */
export interface IdeationHistoryCreate {
  title: string; // Session title
  content: string; // Session content
  tags?: string[]; // Optional tags array
}

/**
 * Update ideation history request
 */
export interface IdeationHistoryUpdate {
  title?: string; // Optional new title
  content?: string; // Optional updated content
  tags?: string[]; // Optional updated tags
}

/**
 * Roadmap history - tracks roadmap versions and changes per user
 */
export interface RoadmapHistory {
  id: number; // Database ID
  user_id: number; // Foreign key to users.id
  title: string; // Roadmap title
  version: string; // Roadmap version (e.g., "1.0", "2.1")
  content: string; // Roadmap content (JSON string)
  created_at: string; // ISO timestamp when created
  updated_at: string; // ISO timestamp when last updated
}

/**
 * Create roadmap history request
 */
export interface RoadmapHistoryCreate {
  title: string; // Roadmap title
  version: string; // Roadmap version
  content: string; // Roadmap content
}

/**
 * Update roadmap history request
 */
export interface RoadmapHistoryUpdate {
  title?: string; // Optional new title
  version?: string; // Optional new version
  content?: string; // Optional updated content
}

/**
 * Repo history - maintains repository interaction records per user
 */
export interface RepoHistory {
  id: number; // Database ID
  user_id: number; // Foreign key to users.id
  repo_name: string; // Repository name (e.g., "owner/repo")
  repo_url: string; // Repository URL
  interaction_type: string; // Type of interaction (e.g., "clone", "fork", "pr")
  metadata: Record<string, unknown>; // Additional metadata (JSON object)
  created_at: string; // ISO timestamp when created
}

/**
 * Create repo history request
 */
export interface RepoHistoryCreate {
  repo_name: string; // Repository name
  repo_url: string; // Repository URL
  interaction_type: string; // Interaction type
  metadata?: Record<string, unknown>; // Optional metadata
}

/**
 * Update repo history request
 */
export interface RepoHistoryUpdate {
  repo_name?: string; // Optional new repository name
  repo_url?: string; // Optional new repository URL
  interaction_type?: string; // Optional new interaction type
  metadata?: Record<string, unknown>; // Optional updated metadata
}

// ============================================
// List & Pagination Types
// ============================================

/**
 * Paginated list response for chat histories
 */
export interface ChatHistoryListResponse {
  items: ChatHistory[]; // Array of chat history items
  total: number; // Total number of items
  page: number; // Current page number
  limit: number; // Number of items per page
  has_more: boolean; // Whether more items exist
}

/**
 * Paginated list response for ideation histories
 */
export interface IdeationHistoryListResponse {
  items: IdeationHistory[]; // Array of ideation history items
  total: number; // Total number of items
  page: number; // Current page number
  limit: number; // Number of items per page
  has_more: boolean; // Whether more items exist
}

/**
 * Paginated list response for roadmap histories
 */
export interface RoadmapHistoryListResponse {
  items: RoadmapHistory[]; // Array of roadmap history items
  total: number; // Total number of items
  page: number; // Current page number
  limit: number; // Number of items per page
  has_more: boolean; // Whether more items exist
}

/**
 * Paginated list response for repo histories
 */
export interface RepoHistoryListResponse {
  items: RepoHistory[]; // Array of repo history items
  total: number; // Total number of items
  page: number; // Current page number
  limit: number; // Number of items per page
  has_more: boolean; // Whether more items exist
}

// ============================================
// Search & Filter Types
// ============================================

/**
 * Common query parameters for history list endpoints
 */
export interface HistoryQueryParams {
  search?: string; // Search query (filters by title/content)
  date_start?: string; // Start date filter (YYYY-MM-DD format)
  date_end?: string; // End date filter (YYYY-MM-DD format)
  sort?: 'newest' | 'oldest'; // Sort order (default: 'newest')
  page?: number; // Page number for pagination (default: 1)
  limit?: number; // Number of items per page (default: 20, max: 100)
}
