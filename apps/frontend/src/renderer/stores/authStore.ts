import { create } from 'zustand';
import type {
  User,
  UserProfile,
  LoginCredentials,
  RegisterData,
} from '../../shared/types/auth';
import {
  login as apiLogin,
  register as apiRegister,
  githubLogin as apiGithubLogin,
  getMe,
  setAuthToken,
  getAuthToken,
  clearAuthToken,
  AuthApiError,
} from '../../api/auth';

/**
 * LocalStorage key for authentication token
 */
const AUTH_TOKEN_KEY = 'auth_token';

/**
 * Authentication state interface
 */
interface AuthState {
  // State
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  loginWithGitHub: () => void;
  logout: () => void;
  fetchProfile: () => Promise<void>;
  updateUser: (user: User) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  initialize: () => void;

  // Selectors
  getUserEmail: () => string | null;
  getUserId: () => number | null;
}

/**
 * Authentication store
 *
 * Manages user authentication state, token management, and auth actions.
 * Follows Zustand patterns from task-store.ts.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  // Initial state
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  /**
   * Login with email and password
   *
   * @param credentials - Login credentials (email, password)
   * @throws AuthApiError on login failure
   */
  login: async (credentials: LoginCredentials) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiLogin(credentials);

      // Store token and update state
      setAuthToken(response.access_token);
      set({
        user: response.user,
        token: response.access_token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const errorMessage = error instanceof AuthApiError
        ? error.message
        : 'Login failed. Please try again.';
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        error: errorMessage,
      });
      throw error;
    }
  },

  /**
   * Register a new user with email and password
   *
   * @param data - Registration data (email, password)
   * @throws AuthApiError on registration failure
   */
  register: async (data: RegisterData) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiRegister(data);

      // Store token and update state
      setAuthToken(response.access_token);
      set({
        user: response.user,
        token: response.access_token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const errorMessage = error instanceof AuthApiError
        ? error.message
        : 'Registration failed. Please try again.';
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        error: errorMessage,
      });
      throw error;
    }
  },

  /**
   * Initiate GitHub OAuth login flow
   *
   * This will redirect the browser to GitHub's authorization page.
   * After authorization, the backend callback will handle the OAuth response
   * and create/login the user.
   */
  loginWithGitHub: () => {
    apiGithubLogin();
  },

  /**
   * Logout current user
   *
   * Clears token from localStorage and resets auth state
   */
  logout: () => {
    clearAuthToken();
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      error: null,
    });
  },

  /**
   * Fetch current user profile from backend
   *
   * Refreshes user data from the server. Useful for updating user state
   * after linking/unlinking GitHub accounts or other profile changes.
   *
   * @throws AuthApiError if token is invalid or expired
   */
  fetchProfile: async () => {
    const { token } = get();
    if (!token) {
      throw new Error('No authentication token available');
    }

    set({ isLoading: true, error: null });
    try {
      const profile: UserProfile = await getMe(token);
      set({
        user: profile,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const errorMessage = error instanceof AuthApiError
        ? error.message
        : 'Failed to fetch user profile';

      // If token is invalid/expired, logout user
      if (error instanceof AuthApiError && error.statusCode === 401) {
        get().logout();
      }

      set({
        isLoading: false,
        error: errorMessage,
      });
      throw error;
    }
  },

  /**
   * Update user state (for manual updates without API call)
   *
   * @param user - Updated user object
   */
  updateUser: (user: User) => {
    set({ user });
  },

  /**
   * Set loading state
   *
   * @param loading - Loading state
   */
  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },

  /**
   * Set error state
   *
   * @param error - Error message or null to clear
   */
  setError: (error: string | null) => {
    set({ error });
  },

  /**
   * Clear error state
   */
  clearError: () => {
    set({ error: null });
  },

  /**
   * Initialize auth state from localStorage
   *
   * Should be called on app startup to restore authentication state.
   * Loads token from localStorage and validates it with the backend.
   */
  initialize: () => {
    const token = getAuthToken();
    if (token) {
      set({
        token,
        isAuthenticated: true,
        isLoading: true,
      });

      // Validate token and fetch user profile
      get().fetchProfile().catch(() => {
        // Token is invalid, clear auth state
        get().logout();
      });
    }
  },

  /**
   * Get current user's email
   *
   * @returns User email or null if not authenticated
   */
  getUserEmail: () => {
    const { user } = get();
    return user?.email ?? null;
  },

  /**
   * Get current user's ID
   *
   * @returns User ID or null if not authenticated
   */
  getUserId: () => {
    const { user } = get();
    return user?.id ?? null;
  },
}));
