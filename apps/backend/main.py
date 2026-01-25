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
    GitHubLinkRequest, GitHubAccountResponse,
    ChatHistoryCreate, ChatHistoryResponse, ChatHistoryUpdate,
    IdeationHistoryCreate, IdeationHistoryResponse, IdeationHistoryUpdate,
    RoadmapHistoryCreate, RoadmapHistoryResponse, RoadmapHistoryUpdate,
    RepoHistoryCreate, RepoHistoryResponse, RepoHistoryUpdate
)
from services.auth_service import create_user, authenticate_user, get_user_by_id
from services.history_service import (
    create_chat_history, get_user_chat_histories,
    get_chat_history, update_chat_history, delete_chat_history,
    create_ideation_history, get_user_ideation_histories,
    get_ideation_history, update_ideation_history, delete_ideation_history,
    create_roadmap_history, get_user_roadmap_histories,
    get_roadmap_history, update_roadmap_history, delete_roadmap_history,
    create_repo_history, get_user_repo_histories,
    get_repo_history, update_repo_history, delete_repo_history
)
from services.github_service import link_github_account, unlink_github_account, get_user_github_accounts
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
# GitHub Account Linking Endpoints
# ============================================================================

@app.post("/github/link", response_model=GitHubAccountResponse, tags=["GitHub"])
async def link_github_account_endpoint(
    link_data: GitHubLinkRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> GitHubAccountResponse:
    """
    Link a GitHub account to the authenticated user.

    This endpoint exchanges a GitHub OAuth authorization code for an access token,
    fetches the user's GitHub profile, and links the GitHub account to the
    authenticated user. Users can link multiple GitHub accounts.

    Args:
        link_data: GitHub OAuth authorization code
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        GitHubAccountResponse: Linked GitHub account information

    Raises:
        HTTPException 401: If no valid token is provided or OAuth code is invalid
        HTTPException 409: If GitHub account is already linked (idempotent - returns existing account)
        HTTPException 500: If linking fails or GitHub API error occurs

    Example:
        POST /github/link
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
        Content-Type: application/json

        {
            "code": "c59f9b3d8b0f4e9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4"
        }

        Response:
        {
            "id": 1,
            "github_id": 12345678,
            "username": "octocat",
            "avatar_url": "https://github.com/images/error/octocat_happy.gif",
            "linked_at": "2025-01-25T10:00:00Z"
        }

    Note:
        - This is a protected route that requires a valid JWT token
        - The OAuth code should be obtained from the GitHub OAuth flow
        - Users can link multiple GitHub accounts
        - Attempting to link the same GitHub account twice is idempotent (returns existing account)
        - The access token is stored for future GitHub API calls
    """
    try:
        # Exchange the authorization code for an access token
        # We need to create a mock token dict with the code
        # Note: This is different from the callback flow where we receive the code in the query params
        # For manual linking, we need to use the code to fetch the access token

        # Create a token dict from the authorization code
        # In a real OAuth flow, we would exchange the code for a token
        # For this implementation, we'll use authlib to fetch the user info directly

        # Fetch user info from GitHub using the authorization code
        # We need to manually exchange the code for an access token first
        import httpx

        # Exchange code for access token
        async with httpx.AsyncClient() as client:
            token_response = await client.post(
                'https://github.com/login/oauth/access_token',
                data={
                    'client_id': GITHUB_CLIENT_ID,
                    'client_secret': GITHUB_CLIENT_SECRET,
                    'code': link_data.code
                },
                headers={'Accept': 'application/json'}
            )
            token_data = token_response.json()

            if 'error' in token_data:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"GitHub OAuth error: {token_data.get('error_description', 'Invalid code')}"
                )

            github_access_token = token_data.get('access_token')

            if not github_access_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Failed to obtain GitHub access token"
                )

            # Fetch user profile from GitHub API
            user_response = await client.get(
                'https://api.github.com/user',
                headers={'Authorization': f'Bearer {github_access_token}'}
            )
            github_user = user_response.json()

        # Extract relevant GitHub user information
        github_id = github_user.get('id')
        github_username = github_user.get('login')
        github_avatar = github_user.get('avatar_url')

        # Validate that we received required data
        if not github_id or not github_username:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid GitHub user data received"
            )

        # Link the GitHub account to the authenticated user
        linked_account = link_github_account(
            db=db,
            user=current_user,
            github_id=github_id,
            username=github_username,
            avatar_url=github_avatar,
            access_token=github_access_token
        )

        # Return the linked account information
        return linked_account

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors (GitHub API errors, database errors, etc.)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to link GitHub account: {str(e)}"
        )


@app.get("/github/accounts", response_model=list[GitHubAccountResponse], tags=["GitHub"])
async def get_user_github_accounts_endpoint(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> list[GitHubAccountResponse]:
    """
    Get all GitHub accounts linked to the authenticated user.

    This endpoint returns a list of all GitHub accounts that have been linked
    to the authenticated user. Users can link multiple GitHub accounts for
    different purposes (e.g., personal, work, open source contributions).

    Args:
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        list[GitHubAccountResponse]: List of linked GitHub account information

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 500: If retrieval fails

    Example:
        GET /github/accounts
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        [
            {
                "id": 2,
                "github_id": 98765432,
                "username": "workuser",
                "avatar_url": "https://github.com/images/error/workuser_happy.gif",
                "linked_at": "2025-01-25T11:00:00Z"
            },
            {
                "id": 1,
                "github_id": 12345678,
                "username": "octocat",
                "avatar_url": "https://github.com/images/error/octocat_happy.gif",
                "linked_at": "2025-01-25T10:00:00Z"
            }
        ]

    Note:
        - This is a protected route that requires a valid JWT token
        - Only returns GitHub accounts linked to the authenticated user
        - Returns empty list if no accounts are linked
        - Ordered by linked_at timestamp (newest first)
        - Does NOT include access tokens in response (security measure)
    """
    try:
        # Get all GitHub accounts linked to the authenticated user
        github_accounts = get_user_github_accounts(db, current_user)

        # Return list of accounts (FastAPI automatically converts to response model)
        return github_accounts

    except Exception as e:
        # Handle any errors during retrieval
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve GitHub accounts: {str(e)}"
        )


@app.delete("/github/unlink/{account_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["GitHub"])
async def unlink_github_account_endpoint(
    account_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    Unlink a GitHub account from the authenticated user.

    This endpoint removes the link between a GitHub account and the authenticated user.
    The GitHub account record is permanently deleted from the database.

    Args:
        account_id: ID of the GitHub account to unlink
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        None: HTTP 204 No Content on success

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 403: If GitHub account does not belong to the user
        HTTPException 404: If GitHub account not found
        HTTPException 500: If unlinking fails

    Example:
        DELETE /github/unlink/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        HTTP 204 No Content

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only unlink their own GitHub accounts
        - Hard delete - GitHub account link permanently removed from database
        - Returns 204 No Content on successful deletion
        - Returns 403 if account exists but belongs to different user
        - Returns 404 if account not found
        - Does NOT delete the user account, only the GitHub link
    """
    try:
        # Unlink the GitHub account (service layer verifies ownership)
        unlinked_account = unlink_github_account(db, current_user, account_id)

        if not unlinked_account:
            # Account not found
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GitHub account with ID {account_id} not found"
            )

        # Return 204 No Content (FastAPI does this automatically with status_code=204)

    except ValueError as e:
        # Account ownership verification failed
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e)
        )
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during unlinking
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to unlink GitHub account: {str(e)}"
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


@app.post("/history/ideation", response_model=IdeationHistoryResponse, status_code=status.HTTP_201_CREATED, tags=["History"])
async def create_ideation_history_endpoint(
    history_data: IdeationHistoryCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> IdeationHistoryResponse:
    """
    Create a new ideation history record for the authenticated user.

    Args:
        history_data: Ideation history creation data (title, content, tags)
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        IdeationHistoryResponse: Created ideation history record

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 500: If creation fails

    Example:
        POST /history/ideation
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
        Content-Type: application/json

        {
            "title": "Product Brainstorm",
            "content": "# Ideas\\n- Feature A\\n- Feature B\\n- Feature C",
            "tags": ["product", "brainstorm", "features"]
        }

        Response:
        {
            "id": 1,
            "title": "Product Brainstorm",
            "content": "# Ideas\\n- Feature A\\n- Feature B\\n- Feature C",
            "tags": ["product", "brainstorm", "features"],
            "created_at": "2025-01-25T10:00:00Z",
            "updated_at": "2025-01-25T10:00:00Z"
        }

    Note:
        This is a protected route that requires a valid JWT token.
        The ideation history is automatically linked to the authenticated user.
    """
    try:
        # Create ideation history linked to authenticated user
        new_history = create_ideation_history(db, current_user.id, history_data)

        # Return created history
        return new_history

    except Exception as e:
        # Handle any errors during creation
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create ideation history: {str(e)}"
        )


@app.get("/history/ideation", response_model=list[IdeationHistoryResponse], tags=["History"])
async def get_user_ideation_histories_endpoint(
    page: int = Query(1, ge=1, description="Page number (starts from 1)"),
    limit: int = Query(20, ge=1, le=100, description="Number of items per page"),
    search: Optional[str] = Query(None, description="Search term for title or content"),
    date_start: Optional[str] = Query(None, description="Start date filter (YYYY-MM-DD)"),
    date_end: Optional[str] = Query(None, description="End date filter (YYYY-MM-DD)"),
    sort: str = Query("newest", regex="^(newest|oldest)$", description="Sort order: newest or oldest"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> list[IdeationHistoryResponse]:
    """
    Get all ideation histories for the authenticated user with pagination and filtering.

    Args:
        page: Page number (starts from 1, default: 1)
        limit: Number of items per page (default: 20, max: 100)
        search: Optional search term for title or content (case-insensitive partial match)
        date_start: Optional start date filter (YYYY-MM-DD format)
        date_end: Optional end date filter (YYYY-MM-DD format)
        sort: Sort order - "newest" (default) or "oldest"
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        list[IdeationHistoryResponse]: List of ideation history records for the user

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 500: If retrieval fails

    Example:
        GET /history/ideation?page=1&limit=20&search=product&sort=newest
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        [
            {
                "id": 2,
                "title": "Product Brainstorm",
                "content": "# Ideas\\n- Feature A\\n- Feature B",
                "tags": ["product", "brainstorm"],
                "created_at": "2025-01-25T10:00:00Z",
                "updated_at": "2025-01-25T11:00:00Z"
            },
            {
                "id": 1,
                "title": "Feature Ideas",
                "content": "## Features\\n- Authentication",
                "tags": ["features"],
                "created_at": "2025-01-24T15:30:00Z",
                "updated_at": "2025-01-24T15:30:00Z"
            }
        ]

    Note:
        - This is a protected route that requires a valid JWT token
        - Only returns ideation histories belonging to the authenticated user
        - Pagination: page 1 returns items 1-20, page 2 returns items 21-40, etc.
        - Search performs case-insensitive partial match on title OR content fields
        - Date filters apply to created_at timestamp
        - Sort defaults to newest first (created_at descending)
    """
    try:
        # Calculate skip offset for pagination (page 1 = skip 0, page 2 = skip 20, etc.)
        skip = (page - 1) * limit

        # Determine sort order
        sort_newest = (sort == "newest")

        # Get user's ideation histories with filtering and pagination
        histories = get_user_ideation_histories(
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
            detail=f"Failed to retrieve ideation histories: {str(e)}"
        )


@app.get("/history/ideation/{history_id}", response_model=IdeationHistoryResponse, tags=["History"])
async def get_ideation_history_endpoint(
    history_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> IdeationHistoryResponse:
    """
    Get a specific ideation history by ID for the authenticated user.

    Args:
        history_id: Ideation history record ID
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        IdeationHistoryResponse: Ideation history record if found and owned by user

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If retrieval fails

    Example:
        GET /history/ideation/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        {
            "id": 1,
            "title": "Product Brainstorm",
            "content": "# Ideas\\n- Feature A\\n- Feature B\\n- Feature C",
            "tags": ["product", "brainstorm", "features"],
            "created_at": "2025-01-25T10:00:00Z",
            "updated_at": "2025-01-25T11:00:00Z"
        }

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only access their own ideation histories
        - Returns 404 if history exists but belongs to different user
    """
    try:
        # Get ideation history (service layer enforces user isolation)
        history = get_ideation_history(db, history_id, current_user.id)

        if not history:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Ideation history with ID {history_id} not found"
            )

        return history

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during retrieval
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve ideation history: {str(e)}"
        )


@app.put("/history/ideation/{history_id}", response_model=IdeationHistoryResponse, tags=["History"])
async def update_ideation_history_endpoint(
    history_id: int,
    history_data: IdeationHistoryUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> IdeationHistoryResponse:
    """
    Update a specific ideation history by ID for the authenticated user.

    Args:
        history_id: Ideation history record ID
        history_data: Update data (title, content, tags)
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        IdeationHistoryResponse: Updated ideation history record

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If update fails

    Example:
        PUT /history/ideation/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
        Content-Type: application/json

        {
            "title": "Updated Product Brainstorm",
            "content": "# Updated Ideas\\n- Feature A\\n- Feature B\\n- Feature C\\n- Feature D",
            "tags": ["product", "brainstorm", "features", "updated"]
        }

        Response:
        {
            "id": 1,
            "title": "Updated Product Brainstorm",
            "content": "# Updated Ideas\\n- Feature A\\n- Feature B\\n- Feature C\\n- Feature D",
            "tags": ["product", "brainstorm", "features", "updated"],
            "created_at": "2025-01-25T10:00:00Z",
            "updated_at": "2025-01-25T12:00:00Z"
        }

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only update their own ideation histories
        - Only updates fields that are provided (partial update supported)
        - updated_at timestamp auto-updated by database
    """
    try:
        # Update ideation history (service layer enforces user isolation)
        updated_history = update_ideation_history(db, history_id, current_user.id, history_data)

        if not updated_history:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Ideation history with ID {history_id} not found"
            )

        return updated_history

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during update
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update ideation history: {str(e)}"
        )


@app.delete("/history/ideation/{history_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["History"])
async def delete_ideation_history_endpoint(
    history_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    Delete a specific ideation history by ID for the authenticated user.

    Args:
        history_id: Ideation history record ID
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        None: HTTP 204 No Content on success

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If deletion fails

    Example:
        DELETE /history/ideation/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        HTTP 204 No Content

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only delete their own ideation histories
        - Hard delete - record permanently removed from database
        - Returns 204 No Content on successful deletion
        - Returns 404 if history exists but belongs to different user
    """
    try:
        # Delete ideation history (service layer enforces user isolation)
        deleted = delete_ideation_history(db, history_id, current_user.id)

        if not deleted:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Ideation history with ID {history_id} not found"
            )

        # Return 204 No Content (FastAPI does this automatically with status_code=204)

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during deletion
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete ideation history: {str(e)}"
        )


@app.post("/history/roadmap", response_model=RoadmapHistoryResponse, status_code=status.HTTP_201_CREATED, tags=["History"])
async def create_roadmap_history_endpoint(
    history_data: RoadmapHistoryCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> RoadmapHistoryResponse:
    """
    Create a new roadmap history record for the authenticated user.

    Args:
        history_data: Roadmap history creation data (title, version, content)
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        RoadmapHistoryResponse: Created roadmap history record

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 500: If creation fails

    Example:
        POST /history/roadmap
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
        Content-Type: application/json

        {
            "title": "Q1 2025 Roadmap",
            "version": "1.0",
            "content": "## Milestones\\n- Week 1: Authentication\\n- Week 2: History API"
        }

        Response:
        {
            "id": 1,
            "title": "Q1 2025 Roadmap",
            "version": "1.0",
            "content": "## Milestones\\n- Week 1: Authentication\\n- Week 2: History API",
            "created_at": "2025-01-25T10:00:00Z",
            "updated_at": "2025-01-25T10:00:00Z"
        }

    Note:
        This is a protected route that requires a valid JWT token.
        The roadmap history is automatically linked to the authenticated user.
    """
    try:
        # Create roadmap history linked to authenticated user
        new_history = create_roadmap_history(db, current_user.id, history_data)

        # Return created history
        return new_history

    except Exception as e:
        # Handle any errors during creation
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create roadmap history: {str(e)}"
        )


@app.get("/history/roadmap", response_model=list[RoadmapHistoryResponse], tags=["History"])
async def get_user_roadmap_histories_endpoint(
    page: int = Query(1, ge=1, description="Page number (starts from 1)"),
    limit: int = Query(20, ge=1, le=100, description="Number of items per page"),
    search: Optional[str] = Query(None, description="Search term for title or content"),
    date_start: Optional[str] = Query(None, description="Start date filter (YYYY-MM-DD)"),
    date_end: Optional[str] = Query(None, description="End date filter (YYYY-MM-DD)"),
    sort: str = Query("newest", regex="^(newest|oldest)$", description="Sort order: newest or oldest"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> list[RoadmapHistoryResponse]:
    """
    Get all roadmap histories for the authenticated user with pagination and filtering.

    Args:
        page: Page number (starts from 1, default: 1)
        limit: Number of items per page (default: 20, max: 100)
        search: Optional search term for title or content (case-insensitive partial match)
        date_start: Optional start date filter (YYYY-MM-DD format)
        date_end: Optional end date filter (YYYY-MM-DD format)
        sort: Sort order - "newest" (default) or "oldest"
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        list[RoadmapHistoryResponse]: List of roadmap history records for the user

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 500: If retrieval fails

    Example:
        GET /history/roadmap?page=1&limit=20&search=q1&sort=newest
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        [
            {
                "id": 2,
                "title": "Q1 2025 Roadmap",
                "version": "1.0",
                "content": "## Milestones\\n- Week 1: Authentication",
                "created_at": "2025-01-25T10:00:00Z",
                "updated_at": "2025-01-25T11:00:00Z"
            },
            {
                "id": 1,
                "title": "Q4 2024 Roadmap",
                "version": "2.0",
                "content": "## Completed",
                "created_at": "2025-01-24T15:30:00Z",
                "updated_at": "2025-01-24T15:30:00Z"
            }
        ]

    Note:
        - This is a protected route that requires a valid JWT token
        - Only returns roadmap histories belonging to the authenticated user
        - Pagination: page 1 returns items 1-20, page 2 returns items 21-40, etc.
        - Search performs case-insensitive partial match on title OR content fields
        - Date filters apply to created_at timestamp
        - Sort defaults to newest first (created_at descending)
    """
    try:
        # Calculate skip offset for pagination (page 1 = skip 0, page 2 = skip 20, etc.)
        skip = (page - 1) * limit

        # Determine sort order
        sort_newest = (sort == "newest")

        # Get user's roadmap histories with filtering and pagination
        histories = get_user_roadmap_histories(
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
            detail=f"Failed to retrieve roadmap histories: {str(e)}"
        )


@app.get("/history/roadmap/{history_id}", response_model=RoadmapHistoryResponse, tags=["History"])
async def get_roadmap_history_endpoint(
    history_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> RoadmapHistoryResponse:
    """
    Get a specific roadmap history by ID for the authenticated user.

    Args:
        history_id: Roadmap history record ID
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        RoadmapHistoryResponse: Roadmap history record if found and owned by user

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If retrieval fails

    Example:
        GET /history/roadmap/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        {
            "id": 1,
            "title": "Q1 2025 Roadmap",
            "version": "1.0",
            "content": "## Milestones\\n- Week 1: Authentication\\n- Week 2: History API",
            "created_at": "2025-01-25T10:00:00Z",
            "updated_at": "2025-01-25T11:00:00Z"
        }

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only access their own roadmap histories
        - Returns 404 if history exists but belongs to different user
    """
    try:
        # Get roadmap history (service layer enforces user isolation)
        history = get_roadmap_history(db, history_id, current_user.id)

        if not history:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Roadmap history with ID {history_id} not found"
            )

        return history

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during retrieval
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve roadmap history: {str(e)}"
        )


@app.put("/history/roadmap/{history_id}", response_model=RoadmapHistoryResponse, tags=["History"])
async def update_roadmap_history_endpoint(
    history_id: int,
    history_data: RoadmapHistoryUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> RoadmapHistoryResponse:
    """
    Update a specific roadmap history by ID for the authenticated user.

    Args:
        history_id: Roadmap history record ID
        history_data: Update data (title, version, content)
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        RoadmapHistoryResponse: Updated roadmap history record

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If update fails

    Example:
        PUT /history/roadmap/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
        Content-Type: application/json

        {
            "title": "Updated Q1 2025 Roadmap",
            "version": "1.1",
            "content": "## Updated Milestones\\n- Week 1: Authentication\\n- Week 2: History API\\n- Week 3: Testing"
        }

        Response:
        {
            "id": 1,
            "title": "Updated Q1 2025 Roadmap",
            "version": "1.1",
            "content": "## Updated Milestones\\n- Week 1: Authentication\\n- Week 2: History API\\n- Week 3: Testing",
            "created_at": "2025-01-25T10:00:00Z",
            "updated_at": "2025-01-25T12:00:00Z"
        }

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only update their own roadmap histories
        - Only updates fields that are provided (partial update supported)
        - updated_at timestamp auto-updated by database
    """
    try:
        # Update roadmap history (service layer enforces user isolation)
        updated_history = update_roadmap_history(db, history_id, current_user.id, history_data)

        if not updated_history:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Roadmap history with ID {history_id} not found"
            )

        return updated_history

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during update
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update roadmap history: {str(e)}"
        )


@app.delete("/history/roadmap/{history_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["History"])
async def delete_roadmap_history_endpoint(
    history_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    Delete a specific roadmap history by ID for the authenticated user.

    Args:
        history_id: Roadmap history record ID
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        None: HTTP 204 No Content on success

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If deletion fails

    Example:
        DELETE /history/roadmap/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        HTTP 204 No Content

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only delete their own roadmap histories
        - Hard delete - record permanently removed from database
        - Returns 204 No Content on successful deletion
        - Returns 404 if history exists but belongs to different user
    """
    try:
        # Delete roadmap history (service layer enforces user isolation)
        deleted = delete_roadmap_history(db, history_id, current_user.id)

        if not deleted:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Roadmap history with ID {history_id} not found"
            )

        # Return 204 No Content (FastAPI does this automatically with status_code=204)

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during deletion
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete roadmap history: {str(e)}"
        )


@app.post("/history/repo", response_model=RepoHistoryResponse, status_code=status.HTTP_201_CREATED, tags=["History"])
async def create_repo_history_endpoint(
    history_data: RepoHistoryCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> RepoHistoryResponse:
    """
    Create a new repo history record for the authenticated user.

    Args:
        history_data: Repo history creation data (repo_name, repo_url, interaction_type, interaction_metadata)
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        RepoHistoryResponse: Created repo history record

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 500: If creation fails

    Example:
        POST /history/repo
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
        Content-Type: application/json

        {
            "repo_name": "Andymik90/Auto-Claude",
            "repo_url": "https://github.com/Andymik90/Auto-Claude",
            "interaction_type": "clone",
            "interaction_metadata": {"branch": "develop", "commit": "abc123"}
        }

        Response:
        {
            "id": 1,
            "repo_name": "Andymik90/Auto-Claude",
            "repo_url": "https://github.com/Andymik90/Auto-Claude",
            "interaction_type": "clone",
            "interaction_metadata": {"branch": "develop", "commit": "abc123"},
            "created_at": "2025-01-25T10:00:00Z"
        }

    Note:
        This is a protected route that requires a valid JWT token.
        The repo history is automatically linked to the authenticated user.
    """
    try:
        # Create repo history linked to authenticated user
        new_history = create_repo_history(db, current_user.id, history_data)

        # Return created history
        return new_history

    except Exception as e:
        # Handle any errors during creation
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create repo history: {str(e)}"
        )


@app.get("/history/repo", response_model=list[RepoHistoryResponse], tags=["History"])
async def get_user_repo_histories_endpoint(
    page: int = Query(1, ge=1, description="Page number (starts from 1)"),
    limit: int = Query(20, ge=1, le=100, description="Number of items per page"),
    search: Optional[str] = Query(None, description="Search term for repo_name or repo_url"),
    date_start: Optional[str] = Query(None, description="Start date filter (YYYY-MM-DD)"),
    date_end: Optional[str] = Query(None, description="End date filter (YYYY-MM-DD)"),
    sort: str = Query("newest", regex="^(newest|oldest)$", description="Sort order: newest or oldest"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> list[RepoHistoryResponse]:
    """
    Get all repo histories for the authenticated user with pagination and filtering.

    Args:
        page: Page number (starts from 1, default: 1)
        limit: Number of items per page (default: 20, max: 100)
        search: Optional search term for repo_name or repo_url (case-insensitive partial match)
        date_start: Optional start date filter (YYYY-MM-DD format)
        date_end: Optional end date filter (YYYY-MM-DD format)
        sort: Sort order - "newest" (default) or "oldest"
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        list[RepoHistoryResponse]: List of repo history records for the user

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 500: If retrieval fails

    Example:
        GET /history/repo?page=1&limit=20&search=auto-claude&sort=newest
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        [
            {
                "id": 2,
                "repo_name": "Andymik90/Auto-Claude",
                "repo_url": "https://github.com/Andymik90/Auto-Claude",
                "interaction_type": "clone",
                "interaction_metadata": {"branch": "develop"},
                "created_at": "2025-01-25T10:00:00Z"
            },
            {
                "id": 1,
                "repo_name": "user/test-repo",
                "repo_url": "https://github.com/user/test-repo",
                "interaction_type": "pr",
                "interaction_metadata": {"pr_number": 123},
                "created_at": "2025-01-24T15:30:00Z"
            }
        ]

    Note:
        - This is a protected route that requires a valid JWT token
        - Only returns repo histories belonging to the authenticated user
        - Pagination: page 1 returns items 1-20, page 2 returns items 21-40, etc.
        - Search performs case-insensitive partial match on repo_name OR repo_url fields
        - Date filters apply to created_at timestamp
        - Sort defaults to newest first (created_at descending)
    """
    try:
        # Calculate skip offset for pagination (page 1 = skip 0, page 2 = skip 20, etc.)
        skip = (page - 1) * limit

        # Determine sort order
        sort_newest = (sort == "newest")

        # Get user's repo histories with filtering and pagination
        histories = get_user_repo_histories(
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
            detail=f"Failed to retrieve repo histories: {str(e)}"
        )


@app.get("/history/repo/{history_id}", response_model=RepoHistoryResponse, tags=["History"])
async def get_repo_history_endpoint(
    history_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> RepoHistoryResponse:
    """
    Get a specific repo history by ID for the authenticated user.

    Args:
        history_id: Repo history record ID
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        RepoHistoryResponse: Repo history record if found and owned by user

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If retrieval fails

    Example:
        GET /history/repo/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        {
            "id": 1,
            "repo_name": "Andymik90/Auto-Claude",
            "repo_url": "https://github.com/Andymik90/Auto-Claude",
            "interaction_type": "clone",
            "interaction_metadata": {"branch": "develop", "commit": "abc123"},
            "created_at": "2025-01-25T10:00:00Z"
        }

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only access their own repo histories
        - Returns 404 if history exists but belongs to different user
    """
    try:
        # Get repo history (service layer enforces user isolation)
        history = get_repo_history(db, history_id, current_user.id)

        if not history:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Repo history with ID {history_id} not found"
            )

        return history

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during retrieval
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve repo history: {str(e)}"
        )


@app.put("/history/repo/{history_id}", response_model=RepoHistoryResponse, tags=["History"])
async def update_repo_history_endpoint(
    history_id: int,
    history_data: RepoHistoryUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
) -> RepoHistoryResponse:
    """
    Update a specific repo history by ID for the authenticated user.

    Args:
        history_id: Repo history record ID
        history_data: Update data (interaction_metadata only - other fields are immutable)
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        RepoHistoryResponse: Updated repo history record

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If update fails

    Example:
        PUT /history/repo/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
        Content-Type: application/json

        {
            "interaction_metadata": {"branch": "main", "commit": "def456", "notes": "Updated metadata"}
        }

        Response:
        {
            "id": 1,
            "repo_name": "Andymik90/Auto-Claude",
            "repo_url": "https://github.com/Andymik90/Auto-Claude",
            "interaction_type": "clone",
            "interaction_metadata": {"branch": "main", "commit": "def456", "notes": "Updated metadata"},
            "created_at": "2025-01-25T10:00:00Z"
        }

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only update their own repo histories
        - Only interaction_metadata can be updated (other fields are immutable for audit trail)
        - Only updates fields that are provided (partial update supported)
    """
    try:
        # Update repo history (service layer enforces user isolation)
        updated_history = update_repo_history(db, history_id, current_user.id, history_data)

        if not updated_history:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Repo history with ID {history_id} not found"
            )

        return updated_history

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during update
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update repo history: {str(e)}"
        )


@app.delete("/history/repo/{history_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["History"])
async def delete_repo_history_endpoint(
    history_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    Delete a specific repo history by ID for the authenticated user.

    Args:
        history_id: Repo history record ID
        current_user: Current authenticated user (injected by dependency)
        db: Database session (injected by FastAPI)

    Returns:
        None: HTTP 204 No Content on success

    Raises:
        HTTPException 401: If no valid token is provided
        HTTPException 404: If history not found or not owned by user
        HTTPException 500: If deletion fails

    Example:
        DELETE /history/repo/1
        Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

        Response:
        HTTP 204 No Content

    Note:
        - This is a protected route that requires a valid JWT token
        - Users can only delete their own repo histories
        - Hard delete - record permanently removed from database
        - Returns 204 No Content on successful deletion
        - Returns 404 if history exists but belongs to different user
    """
    try:
        # Delete repo history (service layer enforces user isolation)
        deleted = delete_repo_history(db, history_id, current_user.id)

        if not deleted:
            # History not found or not owned by user
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Repo history with ID {history_id} not found"
            )

        # Return 204 No Content (FastAPI does this automatically with status_code=204)

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Handle any other errors during deletion
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete repo history: {str(e)}"
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
