/**
 * History API Client
 *
 * Client functions for history CRUD endpoints:
 * - Chat history (conversation threads)
 * - Ideation history (brainstorming sessions)
 * - Roadmap history (roadmap versions)
 * - Repo history (repository interactions)
 *
 * All endpoints require JWT authentication via Bearer token.
 *
 * Base URL: Configured via VITE_API_URL environment variable (default: http://localhost:8000)
 */

import type {
  ChatHistory,
  ChatHistoryCreate,
  ChatHistoryUpdate,
  ChatHistoryListResponse,
  IdeationHistory,
  IdeationHistoryCreate,
  IdeationHistoryUpdate,
  IdeationHistoryListResponse,
  RoadmapHistory,
  RoadmapHistoryCreate,
  RoadmapHistoryUpdate,
  RoadmapHistoryListResponse,
  RepoHistory,
  RepoHistoryCreate,
  RepoHistoryUpdate,
  RepoHistoryListResponse,
  HistoryQueryParams,
} from '../shared/types/auth';

/**
 * Base URL for the history API
 *
 * The backend FastAPI server runs on localhost:8000 by default.
 * This can be overridden via environment variable if needed.
 */
const API_BASE_URL = 'http://localhost:8000';

/**
 * Custom error class for history API errors
 */
export class HistoryApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'HistoryApiError';
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

    throw new HistoryApiError(errorMessage, response.status, details);
  }

  // Handle 204 No Content (DELETE endpoints)
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Build query string from params object
 */
function buildQueryString(params?: HistoryQueryParams): string {
  if (!params) {
    return '';
  }

  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.append('search', params.search);
  }
  if (params.date_start) {
    searchParams.append('date_start', params.date_start);
  }
  if (params.date_end) {
    searchParams.append('date_end', params.date_end);
  }
  if (params.sort) {
    searchParams.append('sort', params.sort);
  }
  if (params.page) {
    searchParams.append('page', params.page.toString());
  }
  if (params.limit) {
    searchParams.append('limit', params.limit.toString());
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

// ============================================
// Chat History API Functions
// ============================================

/**
 * Create a new chat history
 *
 * @param token - JWT access token
 * @param data - Chat history creation data
 * @returns Promise resolving to created chat history
 * @throws HistoryApiError on creation failure
 *
 * Example:
 * ```ts
 * const chat = await createChatHistory(token, {
 *   title: 'My Chat',
 *   messages: [{ role: 'user', content: 'Hello' }]
 * });
 * ```
 */
export async function createChatHistory(
  token: string,
  data: ChatHistoryCreate
): Promise<ChatHistory> {
  const response = await fetch(`${API_BASE_URL}/history/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  return handleResponse<ChatHistory>(response);
}

/**
 * Get all chat histories for the authenticated user
 *
 * @param token - JWT access token
 * @param params - Optional query parameters (search, filter, pagination)
 * @returns Promise resolving to paginated list of chat histories
 * @throws HistoryApiError on fetch failure
 *
 * Example:
 * ```ts
 * const result = await getChatHistories(token, {
 *   search: 'project',
 *   page: 1,
 *   limit: 20
 * });
 * console.log(result.items); // Array of ChatHistory
 * ```
 */
export async function getChatHistories(
  token: string,
  params?: HistoryQueryParams
): Promise<ChatHistoryListResponse> {
  const queryString = buildQueryString(params);
  const response = await fetch(`${API_BASE_URL}/history/chat${queryString}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<ChatHistoryListResponse>(response);
}

/**
 * Get a specific chat history by ID
 *
 * @param token - JWT access token
 * @param id - Chat history ID
 * @returns Promise resolving to chat history
 * @throws HistoryApiError if not found or access denied
 *
 * Example:
 * ```ts
 * const chat = await getChatHistoryById(token, 123);
 * ```
 */
export async function getChatHistoryById(
  token: string,
  id: number
): Promise<ChatHistory> {
  const response = await fetch(`${API_BASE_URL}/history/chat/${id}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<ChatHistory>(response);
}

/**
 * Update a chat history
 *
 * @param token - JWT access token
 * @param id - Chat history ID
 * @param data - Update data (all fields optional)
 * @returns Promise resolving to updated chat history
 * @throws HistoryApiError if not found or access denied
 *
 * Example:
 * ```ts
 * const updated = await updateChatHistory(token, 123, {
 *   title: 'Updated Title'
 * });
 * ```
 */
export async function updateChatHistory(
  token: string,
  id: number,
  data: ChatHistoryUpdate
): Promise<ChatHistory> {
  const response = await fetch(`${API_BASE_URL}/history/chat/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  return handleResponse<ChatHistory>(response);
}

/**
 * Delete a chat history
 *
 * @param token - JWT access token
 * @param id - Chat history ID
 * @returns Promise that resolves when deleted
 * @throws HistoryApiError if not found or access denied
 *
 * Example:
 * ```ts
 * await deleteChatHistory(token, 123);
 * ```
 */
export async function deleteChatHistory(
  token: string,
  id: number
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/history/chat/${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<void>(response);
}

// ============================================
// Ideation History API Functions
// ============================================

/**
 * Create a new ideation history
 *
 * @param token - JWT access token
 * @param data - Ideation history creation data
 * @returns Promise resolving to created ideation history
 * @throws HistoryApiError on creation failure
 */
export async function createIdeationHistory(
  token: string,
  data: IdeationHistoryCreate
): Promise<IdeationHistory> {
  const response = await fetch(`${API_BASE_URL}/history/ideation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  return handleResponse<IdeationHistory>(response);
}

/**
 * Get all ideation histories for the authenticated user
 *
 * @param token - JWT access token
 * @param params - Optional query parameters (search, filter, pagination)
 * @returns Promise resolving to paginated list of ideation histories
 * @throws HistoryApiError on fetch failure
 */
export async function getIdeationHistories(
  token: string,
  params?: HistoryQueryParams
): Promise<IdeationHistoryListResponse> {
  const queryString = buildQueryString(params);
  const response = await fetch(`${API_BASE_URL}/history/ideation${queryString}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<IdeationHistoryListResponse>(response);
}

/**
 * Get a specific ideation history by ID
 *
 * @param token - JWT access token
 * @param id - Ideation history ID
 * @returns Promise resolving to ideation history
 * @throws HistoryApiError if not found or access denied
 */
export async function getIdeationHistoryById(
  token: string,
  id: number
): Promise<IdeationHistory> {
  const response = await fetch(`${API_BASE_URL}/history/ideation/${id}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<IdeationHistory>(response);
}

/**
 * Update an ideation history
 *
 * @param token - JWT access token
 * @param id - Ideation history ID
 * @param data - Update data (all fields optional)
 * @returns Promise resolving to updated ideation history
 * @throws HistoryApiError if not found or access denied
 */
export async function updateIdeationHistory(
  token: string,
  id: number,
  data: IdeationHistoryUpdate
): Promise<IdeationHistory> {
  const response = await fetch(`${API_BASE_URL}/history/ideation/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  return handleResponse<IdeationHistory>(response);
}

/**
 * Delete an ideation history
 *
 * @param token - JWT access token
 * @param id - Ideation history ID
 * @returns Promise that resolves when deleted
 * @throws HistoryApiError if not found or access denied
 */
export async function deleteIdeationHistory(
  token: string,
  id: number
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/history/ideation/${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<void>(response);
}

// ============================================
// Roadmap History API Functions
// ============================================

/**
 * Create a new roadmap history
 *
 * @param token - JWT access token
 * @param data - Roadmap history creation data
 * @returns Promise resolving to created roadmap history
 * @throws HistoryApiError on creation failure
 */
export async function createRoadmapHistory(
  token: string,
  data: RoadmapHistoryCreate
): Promise<RoadmapHistory> {
  const response = await fetch(`${API_BASE_URL}/history/roadmap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  return handleResponse<RoadmapHistory>(response);
}

/**
 * Get all roadmap histories for the authenticated user
 *
 * @param token - JWT access token
 * @param params - Optional query parameters (search, filter, pagination)
 * @returns Promise resolving to paginated list of roadmap histories
 * @throws HistoryApiError on fetch failure
 */
export async function getRoadmapHistories(
  token: string,
  params?: HistoryQueryParams
): Promise<RoadmapHistoryListResponse> {
  const queryString = buildQueryString(params);
  const response = await fetch(`${API_BASE_URL}/history/roadmap${queryString}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<RoadmapHistoryListResponse>(response);
}

/**
 * Get a specific roadmap history by ID
 *
 * @param token - JWT access token
 * @param id - Roadmap history ID
 * @returns Promise resolving to roadmap history
 * @throws HistoryApiError if not found or access denied
 */
export async function getRoadmapHistoryById(
  token: string,
  id: number
): Promise<RoadmapHistory> {
  const response = await fetch(`${API_BASE_URL}/history/roadmap/${id}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<RoadmapHistory>(response);
}

/**
 * Update a roadmap history
 *
 * @param token - JWT access token
 * @param id - Roadmap history ID
 * @param data - Update data (all fields optional)
 * @returns Promise resolving to updated roadmap history
 * @throws HistoryApiError if not found or access denied
 */
export async function updateRoadmapHistory(
  token: string,
  id: number,
  data: RoadmapHistoryUpdate
): Promise<RoadmapHistory> {
  const response = await fetch(`${API_BASE_URL}/history/roadmap/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  return handleResponse<RoadmapHistory>(response);
}

/**
 * Delete a roadmap history
 *
 * @param token - JWT access token
 * @param id - Roadmap history ID
 * @returns Promise that resolves when deleted
 * @throws HistoryApiError if not found or access denied
 */
export async function deleteRoadmapHistory(
  token: string,
  id: number
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/history/roadmap/${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<void>(response);
}

// ============================================
// Repo History API Functions
// ============================================

/**
 * Create a new repo history
 *
 * @param token - JWT access token
 * @param data - Repo history creation data
 * @returns Promise resolving to created repo history
 * @throws HistoryApiError on creation failure
 */
export async function createRepoHistory(
  token: string,
  data: RepoHistoryCreate
): Promise<RepoHistory> {
  const response = await fetch(`${API_BASE_URL}/history/repo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  return handleResponse<RepoHistory>(response);
}

/**
 * Get all repo histories for the authenticated user
 *
 * @param token - JWT access token
 * @param params - Optional query parameters (search, filter, pagination)
 * @returns Promise resolving to paginated list of repo histories
 * @throws HistoryApiError on fetch failure
 */
export async function getRepoHistories(
  token: string,
  params?: HistoryQueryParams
): Promise<RepoHistoryListResponse> {
  const queryString = buildQueryString(params);
  const response = await fetch(`${API_BASE_URL}/history/repo${queryString}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<RepoHistoryListResponse>(response);
}

/**
 * Get a specific repo history by ID
 *
 * @param token - JWT access token
 * @param id - Repo history ID
 * @returns Promise resolving to repo history
 * @throws HistoryApiError if not found or access denied
 */
export async function getRepoHistoryById(
  token: string,
  id: number
): Promise<RepoHistory> {
  const response = await fetch(`${API_BASE_URL}/history/repo/${id}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<RepoHistory>(response);
}

/**
 * Update a repo history
 *
 * @param token - JWT access token
 * @param id - Repo history ID
 * @param data - Update data (all fields optional)
 * @returns Promise resolving to updated repo history
 * @throws HistoryApiError if not found or access denied
 */
export async function updateRepoHistory(
  token: string,
  id: number,
  data: RepoHistoryUpdate
): Promise<RepoHistory> {
  const response = await fetch(`${API_BASE_URL}/history/repo/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  return handleResponse<RepoHistory>(response);
}

/**
 * Delete a repo history
 *
 * @param token - JWT access token
 * @param id - Repo history ID
 * @returns Promise that resolves when deleted
 * @throws HistoryApiError if not found or access denied
 */
export async function deleteRepoHistory(
  token: string,
  id: number
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/history/repo/${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return handleResponse<void>(response);
}
