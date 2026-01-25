"""
Auto Claude Authentication and History API
============================================

FastAPI application providing dual authentication (email/password and GitHub OAuth)
and persistent storage for user history data.

Features:
- Email/password registration and login
- GitHub OAuth authentication
- JWT token-based authentication
- CRUD operations for 4 history types: chat, ideation, roadmap, repo
- User data isolation and security

Base URL: http://localhost:8000
API Docs: http://localhost:8000/docs (Swagger UI)
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, status, Request, Query
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from authlib.integrations.starlette_client import OAuth
import secrets

# Import database, models, schemas, services, and auth utilities
from database import engine, get_db, init_db
from models import User, Base
from schemas import (
    UserCreate, UserResponse, Token,
    ChatHistoryCreate, ChatHistoryResponse, ChatHistoryUpdate
)
from services.auth_service import create_user, authenticate_user, get_user_by_id
from services.history_service import (
    create_chat_history, get_user_chat_histories,
    get_chat_history, update_chat_history, delete_chat_history
)
from auth import create_access_token, get_current_user
from typing import Dict, Any, Optional


# Environment variables
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
API_TITLE = "Auto Claude Authentication API"
API_VERSION = "1.0.0"
SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_urlsafe(32))

# GitHub OAuth configuration
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events.

    Yields:
        None: Application is running
    """
    # Startup: Initialize database connection, run migrations, etc.
    # For now, we'll keep it simple as database is set up in database.py
    print("Starting Auto Claude Authentication API...")
    yield
    # Shutdown: Close database connections, cleanup resources
    print("Shutting down Auto Claude Authentication API...")


# Create FastAPI application
app = FastAPI(
    title=API_TITLE,
    description="Authentication and history persistence API for Auto Claude",
    version=API_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)


# Add SessionMiddleware for OAuth flow (required by authlib)
app.add_middleware(
    SessionMiddleware,
    secret_key=SECRET_KEY,
    max_age=None,  # Session expires when browser closes
)


# Configure CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],  # Frontend URLs
    allow_credentials=True,  # Allow cookies and authorization headers
    allow_methods=["*"],  # Allow all HTTP methods
    allow_headers=["*"],  # Allow all headers
)


# Initialize Authlib OAuth client for GitHub integration
oauth = OAuth()

# Register GitHub OAuth application
# This will be used in subtask-3-2 and subtask-3-3 for OAuth endpoints
oauth.register(
    name='github',
    client_id=GITHUB_CLIENT_ID,
    client_secret=GITHUB_CLIENT_SECRET,
    access_token_url='https://github.com/login/oauth/access_token',
    authorize_url='https://github.com/login/oauth/authorize',
    api_base_url='https://api.github.com/',
    client_kwargs={
        'scope': 'user:email'
    }
)


# Health check endpoint
@app.get("/", tags=["Health"])
async def root() -> dict[str, str]:
    """
    Root endpoint for health check.

    Returns:
        dict: Welcome message and API status
    """
    return {
        "message": "Auto Claude Authentication API",
        "status": "running",
        "version": API_VERSION,
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
async def health_check() -> dict[str, str]:
    """
    Health check endpoint for monitoring.

    Returns:
        dict: Health status
    """
    return {"status": "healthy", "service": "auth-api"}


# ============================================================================
# Authentication Endpoints
# ============================================================================

@app.post("/auth/register", response_model=Token, status_code=status.HTTP_201_CREATED, tags=["Authentication"])
async def register_user(
    user_data: UserCreate,
    db: Session = Depends(get_db)
) -> Token:
    """
    Register a new user with email and password.

    Args:
        user_data: User registration data (email and password)
        db: Database session (injected by FastAPI)

    Returns:
        Token: JWT access token for the newly created user

    Raises:
        HTTPException 400: If validation fails (email format, password length)
        HTTPException 409: If email already exists

    Example:
        POST /auth/register
        {
            "email": "user@example.com",
            "password": "securepass123"
        }

        Response:
        {
            "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
            "token_type": "bearer"
        }
    """
    try:
        # Create user in database (password is hashed in service layer)
        new_user = create_user(db, user_data)

        # Create JWT access token
        access_token = create_access_token(data={"sub": str(new_user.id)})

        # Return token
        return Token(access_token=access_token, token_type="bearer")

    except ValueError as e:
        # Email already exists
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )
    except Exception as e:
        # Other errors (validation, database, etc.)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Registration failed: {str(e)}"
        )


@app.post("/auth/login", response_model=Token, tags=["Authentication"])
async def login_user(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
) -> Token:
    """
    Login a user with email and password.

    Args:
        form_data: OAuth2 password request form (username=email, password)
        db: Database session (injected by FastAPI)

    Returns:
        Token: JWT access token for authenticated user

    Raises:
        HTTPException 401: If email or password is incorrect

    Example:
        POST /auth/login
        Content-Type: application/x-www-form-urlencoded

        username=test@example.com&password=testpass123

        Response:
        {
            "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
            "token_type": "bearer"
        }

    Note:
        Uses OAuth2PasswordRequestForm for OAuth2 compatibility.
        The 'username' field maps to the user's email address.
    """
    # Authenticate user with email (username field) and password
    user = authenticate_user(db, form_data.username, form_data.password)

    # If authentication fails, return 401 Unauthorized
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Create JWT access token
    access_token = create_access_token(data={"sub": str(user.id)})

    # Return token
    return Token(access_token=access_token, token_type="bearer")


async def get_current_active_user(
    token_payload: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> User:
    """
    Dependency to get the current authenticated user from database.

    Args:
        token_payload: Decoded JWT token payload (contains user_id in "sub" field)
        db: Database session (injected by FastAPI)

    Returns:
        User: Current authenticated user object

    Raises:
        HTTPException 401: If token is invalid or user not found

    Note:
        Extracts user_id from token payload's "sub" field and queries
        the database to get the full user object.
    """
    # Extract user_id from token payload
    user_id = token_payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Convert to int if it's a string
    try:
        user_id = int(user_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user ID in token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Query database for user
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


@app.get("/auth/me", response_model=UserResponse, tags=["Authentication"])
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user)
) -> UserResponse:
    """
    Get current authenticated user information.

    Args:
        current_user: Current authenticated user (injected by dependency)

    Returns:
        UserResponse: Current user's information (id, email, created_at)

    Raises:
        HTTPException 401: If no valid token is provided

    Example:
        GET /auth/me
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        {
            "id": 1,
            "email": "user@example.com",
            "created_at": "2025-01-25T10:00:00Z"
        }

    Note:
        This is a protected route that requires a valid JWT token
        in the Authorization header.
    """
    return current_user


@app.get("/auth/github", tags=["Authentication"])
async def github_login(request: Request) -> RedirectResponse:
    """
    Redirect to GitHub OAuth authorization page.

    This endpoint initiates the GitHub OAuth flow by redirecting the user
    to GitHub's authorization page where they can grant access to their account.

    Args:
        request: FastAPI request object (needed for OAuth redirect URL generation)

    Returns:
        RedirectResponse: HTTP 302 redirect to GitHub authorization page

    Raises:
        HTTPException 500: If GitHub OAuth is not configured or redirect fails

    Example:
        GET /auth/github

        Response:
        HTTP 302 Found
        Location: https://github.com/login/oauth/authorize?client_id=...&scope=...

    Note:
        The user will be redirected back to /auth/github/callback after
        authorizing on GitHub.
    """
    try:
        # Generate the redirect URL to GitHub OAuth authorization page
        # The redirect_uri points to our callback endpoint
        redirect_uri = f"{FRONTEND_URL}/auth/github/callback"

        # Use authlib to create the authorization redirect
        return await oauth.github.authorize_redirect(request, redirect_uri)

    except Exception as e:
        # Handle any errors during redirect generation
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to initiate GitHub OAuth: {str(e)}"
        )


@app.get("/auth/github/callback", tags=["Authentication"])
async def github_callback(
    request: Request,
    db: Session = Depends(get_db)
) -> RedirectResponse:
    """
    Handle GitHub OAuth callback and create/login user.

    This endpoint receives the OAuth callback from GitHub after user authorization.
    It exchanges the authorization code for an access token, fetches the user's
    GitHub profile, creates a new user account or links to an existing one,
    and returns a JWT token via URL redirect to the frontend.

    Args:
        request: FastAPI request object (contains OAuth state and code)
        db: Database session (injected by FastAPI)

    Returns:
        RedirectResponse: HTTP 302 redirect to frontend with JWT token in URL hash

    Raises:
        HTTPException 401: If OAuth authorization fails or code is invalid
        HTTPException 500: If user creation fails or GitHub API error occurs

    Example:
        GET /auth/github/callback?code=xxx&state=yyy

        Response:
        HTTP 302 Found
        Location: http://localhost:3000/auth/callback#access_token=eyJhbG...

    Note:
        - Token is passed in URL hash (fragment) to prevent it from being sent to server
        - Frontend should extract token from URL hash and store in localStorage
        - If GitHub account already exists, user is logged in
        - If GitHub account is new, a new user is created automatically
        - User's email is retrieved from GitHub API for account creation
    """
    try:
        # Exchange authorization code for access token
        # authlib handles the OAuth token exchange automatically
        token = await oauth.github.authorize_access_token(request)

        # Fetch user profile from GitHub API using the access token
        # The 'user' endpoint returns: id, login, name, email, avatar_url, etc.
        response = await oauth.github.get('user', token=token)
        github_user = response.json()

        # Extract relevant GitHub user information
        github_id = github_user.get('id')
        github_username = github_user.get('login')
        github_email = github_user.get('email')
        github_avatar = github_user.get('avatar_url')
        github_access_token = token.get('access_token')

        # Validate that we received required data
        if not github_id or not github_username:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid GitHub user data received"
            )

        # Import models here to avoid circular imports
        from models import GitHubAccount

        # Check if GitHub account already exists in our database
        existing_github_account = db.query(GitHubAccount).filter(
            GitHubAccount.github_id == github_id
        ).first()

        user = None

        if existing_github_account:
            # GitHub account already linked - login the existing user
            user = existing_github_account.user

            # Update access token and profile data
            existing_github_account.access_token = github_access_token
            existing_github_account.username = github_username
            if github_avatar:
                existing_github_account.avatar_url = github_avatar
            db.commit()

        else:
            # New GitHub account - create new user
            # Use GitHub email if available, otherwise use a placeholder
            # Note: GitHub users can choose to hide their email
            if not github_email:
                # Generate a unique email based on GitHub username
                github_email = f"{github_username}@github.local"

            # Check if user with this email already exists
            # (User might have registered with email/password previously)
            existing_user = db.query(User).filter(User.email == github_email).first()

            if existing_user:
                # Link GitHub account to existing user
                user = existing_user

                # Create GitHub account link
                new_github_account = GitHubAccount(
                    user_id=user.id,
                    github_id=github_id,
                    username=github_username,
                    avatar_url=github_avatar,
                    access_token=github_access_token
                )
                db.add(new_github_account)
                db.commit()

            else:
                # Create completely new user with GitHub account
                # Generate a random password (user won't use it for GitHub login)
                import random
                import string
                random_password = ''.join(random.choices(string.ascii_letters + string.digits, k=32))

                # Hash the random password
                from auth import hash_password
                hashed_password = hash_password(random_password)

                # Create new user
                new_user = User(
                    email=github_email,
                    hashed_password=hashed_password
                )
                db.add(new_user)
                db.flush()  # Flush to get the user ID before creating GitHub account

                # Create GitHub account link
                new_github_account = GitHubAccount(
                    user_id=new_user.id,
                    github_id=github_id,
                    username=github_username,
                    avatar_url=github_avatar,
                    access_token=github_access_token
                )
                db.add(new_github_account)
                db.commit()

                user = new_user

        # Create JWT access token for the user
        access_token = create_access_token(data={"sub": str(user.id)})

        # Redirect to frontend with token in URL hash
        # Using hash (fragment) prevents token from being sent in redirect request
        frontend_callback_url = f"{FRONTEND_URL}/auth/callback#access_token={access_token}"

        return RedirectResponse(frontend_callback_url)

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors (GitHub API errors, database errors, etc.)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"GitHub OAuth callback failed: {str(e)}"
        )



# ============================================================================
# History Endpoints
# ============================================================================

@app.post("/history/chat", response_model=ChatHistoryResponse, status_code=status.HTTP_201_CREATED, tags=["History"])
async def create_chat_history_endpoint(
    history_data: ChatHistoryCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> ChatHistoryResponse:
    """
    Create a new chat history record for the authenticated user.

    Args:
        history_data: Chat history creation data (title, messages)
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        ChatHistoryResponse: Created chat history record

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 500: If creation fails

    Example:
        POST /history/chat
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
        Content-Type: application/json

        {
            "title": "Project Planning Discussion",
            "messages": [
                {"role": "user", "content": "How do I create a spec?"},
                {"role": "assistant", "content": "Use the spec_runner.py command."}
            ]
        }

        Response:
        {
            "id": 1,
            "title": "Project Planning Discussion",
            "messages": [
                {"role": "user", "content": "How do I create a spec?"},
                {"role": "assistant", "content": "Use the spec_runner.py command."}
            ],
            "created_at": "2025-01-25T10:00:00Z",
            "updated_at": "2025-01-25T10:00:00Z"
        }

    Note:
        This is a protected route that requires a valid JWT token.
        The chat history is automatically linked to the authenticated user.
    """
    try:
        # Create chat history linked to authenticated user
        new_history = create_chat_history(db, current_user.id, history_data)

        # Return created history
        return new_history

    except Exception as e:
        # Handle any errors during creation
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create chat history: {str(e)}"
        )


@app.get("/history/chat", response_model=list[ChatHistoryResponse], tags=["History"])
async def get_user_chat_histories_endpoint(
    page: int = Query(1, ge=1, description="Page number (starts from 1)"),
    limit: int = Query(20, ge=1, le=100, description="Number of items per page"),
    search: Optional[str] = Query(None, description="Search term for title"),
    date_start: Optional[str] = Query(None, description="Start date filter (YYYY-MM-DD)"),
    date_end: Optional[str] = Query(None, description="End date filter (YYYY-MM-DD)"),
    sort: str = Query("newest", regex="^(newest|oldest)$", description="Sort order: newest or oldest"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> list[ChatHistoryResponse]:
    """
    Get all chat histories for the authenticated user with pagination and filtering.

    Args:
        page: Page number (starts from 1, default: 1)
        limit: Number of items per page (default: 20, max: 100)
        search: Optional search term for title (case-insensitive partial match)
        date_start: Optional start date filter (YYYY-MM-DD format)
        date_end: Optional end date filter (YYYY-MM-DD format)
        sort: Sort order - "newest" (default) or "oldest"
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        list[ChatHistoryResponse]: List of chat history records for the user

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 500: If retrieval fails

    Example:
        GET /history/chat?page=1&limit=20&search=project&sort=newest
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        [
            {
                "id": 2,
                "title": "Project Planning Discussion",
                "messages": [...],
                "created_at": "2025-01-25T10:00:00Z",
                "updated_at": "2025-01-25T11:00:00Z"
            },
            {
                "id": 1,
                "title": "Code Review Notes",
                "messages": [...],
                "created_at": "2025-01-24T15:30:00Z",
                "updated_at": "2025-01-24T15:30:00Z"
            }
        ]

    Note:
        - This is a protected route that requires a valid JWT token
        - Only returns chat histories belonging to the authenticated user
        - Pagination: page 1 returns items 1-20, page 2 returns items 21-40, etc.
        - Search performs case-insensitive partial match on title field
        - Date filters apply to created_at timestamp
        - Sort defaults to newest first (created_at descending)
    """
    try:
        # Calculate skip offset for pagination (page 1 = skip 0, page 2 = skip 20, etc.)
        skip = (page - 1) * limit

        # Determine sort order
        sort_newest = (sort == "newest")

        # Get user's chat histories with filtering and pagination
        histories = get_user_chat_histories(
            db,
            current_user.id,
            skip=skip,
            limit=limit,
            search=search,
            date_start=date_start,
            date_end=date_end,
            sort_newest=sort_newest
        )

        # Return list of histories (FastAPI automatically converts to response model)
        return histories

    except Exception as e:
        # Handle any errors during retrieval
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve chat histories: {str(e)}"
        )


@app.get("/history/chat/{history_id}", response_model=ChatHistoryResponse, tags=["History"])
async def get_chat_history_endpoint(
    history_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> ChatHistoryResponse:
    """
    Get a specific chat history by ID for the authenticated user.

    Args:
        history_id: Chat history record ID
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        ChatHistoryResponse: Chat history record if found and owned by user

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If retrieval fails

    Example:
        GET /history/chat/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        {
            "id": 1,
            "title": "Project Planning Discussion",
            "messages": [...],
            "created_at": "2025-01-25T10:00:00Z",
            "updated_at": "2025-01-25T11:00:00Z"
        }

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only access their own chat histories
        - Returns 404 if history exists but belongs to different user
    """
    try:
        # Get chat history (service layer enforces user isolation)
        history = get_chat_history(db, history_id, current_user.id)

        if not history:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Chat history with ID {history_id} not found"
            )

        return history

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during retrieval
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve chat history: {str(e)}"
        )


@app.put("/history/chat/{history_id}", response_model=ChatHistoryResponse, tags=["History"])
async def update_chat_history_endpoint(
    history_id: int,
    history_data: ChatHistoryUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> ChatHistoryResponse:
    """
    Update a specific chat history by ID for the authenticated user.

    Args:
        history_id: Chat history record ID
        history_data: Update data (title, messages)
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        ChatHistoryResponse: Updated chat history record

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If update fails

    Example:
        PUT /history/chat/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
        Content-Type: application/json

        {
            "title": "Updated Project Planning Discussion",
            "messages": [
                {"role": "user", "content": "How do I create a spec?"},
                {"role": "assistant", "content": "Use the spec_runner.py command."},
                {"role": "user", "content": "Thanks!"}
            ]
        }

        Response:
        {
            "id": 1,
            "title": "Updated Project Planning Discussion",
            "messages": [...],
            "created_at": "2025-01-25T10:00:00Z",
            "updated_at": "2025-01-25T12:00:00Z"
        }

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only update their own chat histories
        - Only updates fields that are provided (partial update supported)
        - updated_at timestamp auto-updated by database
    """
    try:
        # Update chat history (service layer enforces user isolation)
        updated_history = update_chat_history(db, history_id, current_user.id, history_data)

        if not updated_history:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Chat history with ID {history_id} not found"
            )

        return updated_history

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during update
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update chat history: {str(e)}"
        )


@app.delete("/history/chat/{history_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["History"])
async def delete_chat_history_endpoint(
    history_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    Delete a specific chat history by ID for the authenticated user.

    Args:
        history_id: Chat history record ID
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        None: HTTP 204 No Content on success

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If deletion fails

    Example:
        DELETE /history/chat/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        HTTP 204 No Content

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only delete their own chat histories
        - Hard delete - record permanently removed from database
        - Returns 204 No Content on successful deletion
        - Returns 404 if history exists but belongs to different user
    """
    try:
        # Delete chat history (service layer enforces user isolation)
        deleted = delete_chat_history(db, history_id, current_user.id)

        if not deleted:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Chat history with ID {history_id} not found"
            )

        # Return 204 No Content (FastAPI does this automatically with status_code=204)

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during deletion
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete chat history: {str(e)}"
        )


# Placeholder for router imports
# These will be added in subsequent subtasks:
# from routers import auth_router, history_router, github_router
# app.include_router(auth_router, prefix="/auth", tags=["Authentication"])
# app.include_router(history_router, prefix="/history", tags=["History"])
# app.include_router(github_router, prefix="/github", tags=["GitHub"])


if __name__ == "__main__":
    import uvicorn

    # Run the application
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # Enable auto-reload during development
    )
