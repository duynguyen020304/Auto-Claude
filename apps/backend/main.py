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

from fastapi import FastAPI, Depends, HTTPException, status, Request
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
from schemas import UserCreate, UserResponse, Token
from services.auth_service import create_user, authenticate_user, get_user_by_id
from auth import create_access_token, get_current_user
from typing import Dict, Any


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
        authorizing on GitHub. The callback will be implemented in subtask-3-3.
    """
    try:
        # Generate the redirect URL to GitHub OAuth authorization page
        # The redirect_uri points to our callback endpoint (to be implemented)
        redirect_uri = f"{FRONTEND_URL}/auth/github/callback"

        # Use authlib to create the authorization redirect
        return await oauth.github.authorize_redirect(request, redirect_uri)

    except Exception as e:
        # Handle any errors during redirect generation
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to initiate GitHub OAuth: {str(e)}"
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
