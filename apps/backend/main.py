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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


# Environment variables
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
API_TITLE = "Auto Claude Authentication API"
API_VERSION = "1.0.0"


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
