"""
Pydantic Schemas for Authentication and History API
====================================================

This module defines request/response schemas for:
- User registration and login
- JWT token responses
- History CRUD operations (Chat, Ideation, Roadmap, Repo)

All schemas provide validation, serialization, and API documentation.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr, Field, validator


# ============================================================================
# User Authentication Schemas
# ============================================================================

class UserCreate(BaseModel):
    """
    Schema for user registration request.

    Attributes:
        email: User's email address (must be valid format)
        password: User's password (minimum 8 characters)

    Validation:
        - Email must be valid format (enforced by EmailStr)
        - Password must be at least 8 characters
    """
    email: EmailStr = Field(..., description="User's email address")
    password: str = Field(
        ...,
        min_length=8,
        description="User's password (minimum 8 characters)"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "email": "user@example.com",
                "password": "securepass123"
            }
        }


class UserResponse(BaseModel):
    """
    Schema for user response (excluding sensitive data).

    Attributes:
        id: User's unique identifier
        email: User's email address
        created_at: Account creation timestamp

    Note:
        Hashed password is never included in API responses.
    """
    id: int = Field(..., description="User's unique identifier")
    email: EmailStr = Field(..., description="User's email address")
    created_at: datetime = Field(..., description="Account creation timestamp")

    class Config:
        from_attributes = True  # Allows ORM mode to convert SQLAlchemy models
        json_schema_extra = {
            "example": {
                "id": 1,
                "email": "user@example.com",
                "created_at": "2025-01-25T10:00:00Z"
            }
        }


class Token(BaseModel):
    """
    Schema for JWT token response.

    Attributes:
        access_token: JWT access token for authentication
        token_type: Type of token (always "bearer")

    Usage:
        Include in Authorization header: "Bearer <access_token>"
    """
    access_token: str = Field(..., description="JWT access token")
    token_type: str = Field(default="bearer", description="Token type (always 'bearer')")

    class Config:
        json_schema_extra = {
            "example": {
                "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "token_type": "bearer"
            }
        }


class TokenData(BaseModel):
    """
    Schema for token payload data.

    Attributes:
        sub: User ID from token subject claim
        exp: Token expiration timestamp (optional)

    Note:
        Used internally by JWT authentication dependency.
    """
    sub: Optional[int] = Field(None, description="User ID from token")
    exp: Optional[int] = Field(None, description="Token expiration timestamp")


# ============================================================================
# GitHub Account Schemas
# ============================================================================

class GitHubLinkRequest(BaseModel):
    """
    Schema for GitHub account link request.

    Attributes:
        code: OAuth authorization code from GitHub

    Validation:
        - Code must be a non-empty string
    """
    code: str = Field(..., min_length=1, description="OAuth authorization code from GitHub")

    class Config:
        json_schema_extra = {
            "example": {
                "code": "c59f9b3d8b0f4e9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4"
            }
        }


class GitHubAccountResponse(BaseModel):
    """
    Schema for GitHub account response.

    Attributes:
        id: GitHub account record ID
        github_id: GitHub user ID
        username: GitHub username
        avatar_url: Profile picture URL (optional)
        linked_at: When the account was linked
    """
    id: int = Field(..., description="GitHub account record ID")
    github_id: int = Field(..., description="GitHub user ID")
    username: str = Field(..., description="GitHub username")
    avatar_url: Optional[str] = Field(None, description="Profile picture URL")
    linked_at: datetime = Field(..., description="When the account was linked")

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "github_id": 12345678,
                "username": "octocat",
                "avatar_url": "https://github.com/images/error/octocat_happy.gif",
                "linked_at": "2025-01-25T10:00:00Z"
            }
        }


# ============================================================================
# Chat History Schemas
# ============================================================================

class ChatHistoryCreate(BaseModel):
    """
    Schema for creating chat history.

    Attributes:
        title: Conversation title
        messages: List of message objects (JSON)
    """
    title: str = Field(..., min_length=1, max_length=512, description="Conversation title")
    messages: List[Dict[str, Any]] = Field(default_factory=list, description="List of message objects")

    class Config:
        json_schema_extra = {
            "example": {
                "title": "Project Planning Discussion",
                "messages": [
                    {"role": "user", "content": "How do I create a spec?"},
                    {"role": "assistant", "content": "Use the spec_runner.py command."}
                ]
            }
        }


class ChatHistoryResponse(BaseModel):
    """
    Schema for chat history response.

    Attributes:
        id: Chat history record ID
        title: Conversation title
        messages: List of message objects (JSON)
        created_at: Creation timestamp
        updated_at: Last update timestamp
    """
    id: int = Field(..., description="Chat history record ID")
    title: str = Field(..., description="Conversation title")
    messages: List[Dict[str, Any]] = Field(default_factory=list, description="List of message objects")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "title": "Project Planning Discussion",
                "messages": [
                    {"role": "user", "content": "How do I create a spec?"},
                    {"role": "assistant", "content": "Use the spec_runner.py command."}
                ],
                "created_at": "2025-01-25T10:00:00Z",
                "updated_at": "2025-01-25T11:00:00Z"
            }
        }


class ChatHistoryUpdate(BaseModel):
    """
    Schema for updating chat history.

    Attributes:
        title: Optional new conversation title
        messages: Optional new list of message objects
    """
    title: Optional[str] = Field(None, min_length=1, max_length=512, description="New conversation title")
    messages: Optional[List[Dict[str, Any]]] = Field(None, description="New list of message objects")

    class Config:
        json_schema_extra = {
            "example": {
                "title": "Updated Project Planning Discussion",
                "messages": [
                    {"role": "user", "content": "How do I create a spec?"},
                    {"role": "assistant", "content": "Use the spec_runner.py command."},
                    {"role": "user", "content": "Thanks!"}
                ]
            }
        }


# ============================================================================
# Ideation History Schemas
# ============================================================================

class IdeationHistoryCreate(BaseModel):
    """
    Schema for creating ideation history.

    Attributes:
        title: Session title
        content: Session content (text, markdown, etc.)
        tags: List of tag strings (JSON)
    """
    title: str = Field(..., min_length=1, max_length=512, description="Session title")
    content: str = Field(..., description="Session content (text, markdown, etc.)")
    tags: List[str] = Field(default_factory=list, description="List of tag strings")

    class Config:
        json_schema_extra = {
            "example": {
                "title": "Product Brainstorm",
                "content": "# Ideas\n- Feature A\n- Feature B\n- Feature C",
                "tags": ["product", "brainstorm", "features"]
            }
        }


class IdeationHistoryResponse(BaseModel):
    """
    Schema for ideation history response.

    Attributes:
        id: Ideation history record ID
        title: Session title
        content: Session content
        tags: List of tag strings
        created_at: Creation timestamp
        updated_at: Last update timestamp
    """
    id: int = Field(..., description="Ideation history record ID")
    title: str = Field(..., description="Session title")
    content: str = Field(..., description="Session content")
    tags: List[str] = Field(default_factory=list, description="List of tag strings")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "title": "Product Brainstorm",
                "content": "# Ideas\n- Feature A\n- Feature B\n- Feature C",
                "tags": ["product", "brainstorm", "features"],
                "created_at": "2025-01-25T10:00:00Z",
                "updated_at": "2025-01-25T11:00:00Z"
            }
        }


class IdeationHistoryUpdate(BaseModel):
    """
    Schema for updating ideation history.

    Attributes:
        title: Optional new session title
        content: Optional new session content
        tags: Optional new list of tags
    """
    title: Optional[str] = Field(None, min_length=1, max_length=512, description="New session title")
    content: Optional[str] = Field(None, description="New session content")
    tags: Optional[List[str]] = Field(None, description="New list of tags")

    class Config:
        json_schema_extra = {
            "example": {
                "title": "Updated Product Brainstorm",
                "content": "# Updated Ideas\n- Feature A\n- Feature B\n- Feature C\n- Feature D",
                "tags": ["product", "brainstorm", "features", "updated"]
            }
        }


# ============================================================================
# Roadmap History Schemas
# ============================================================================

class RoadmapHistoryCreate(BaseModel):
    """
    Schema for creating roadmap history.

    Attributes:
        title: Roadmap title
        version: Version number or identifier
        content: Roadmap content (tasks, milestones, etc.)
    """
    title: str = Field(..., min_length=1, max_length=512, description="Roadmap title")
    version: str = Field(..., min_length=1, max_length=100, description="Version number or identifier")
    content: str = Field(..., description="Roadmap content (tasks, milestones, etc.)")

    class Config:
        json_schema_extra = {
            "example": {
                "title": "Q1 2025 Roadmap",
                "version": "1.0",
                "content": "## Milestones\n- Week 1: Authentication\n- Week 2: History API\n- Week 3: Frontend UI"
            }
        }


class RoadmapHistoryResponse(BaseModel):
    """
    Schema for roadmap history response.

    Attributes:
        id: Roadmap history record ID
        title: Roadmap title
        version: Version number or identifier
        content: Roadmap content
        created_at: Creation timestamp
        updated_at: Last update timestamp
    """
    id: int = Field(..., description="Roadmap history record ID")
    title: str = Field(..., description="Roadmap title")
    version: str = Field(..., description="Version number or identifier")
    content: str = Field(..., description="Roadmap content")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "title": "Q1 2025 Roadmap",
                "version": "1.0",
                "content": "## Milestones\n- Week 1: Authentication\n- Week 2: History API\n- Week 3: Frontend UI",
                "created_at": "2025-01-25T10:00:00Z",
                "updated_at": "2025-01-25T11:00:00Z"
            }
        }


class RoadmapHistoryUpdate(BaseModel):
    """
    Schema for updating roadmap history.

    Attributes:
        title: Optional new roadmap title
        version: Optional new version number
        content: Optional new roadmap content
    """
    title: Optional[str] = Field(None, min_length=1, max_length=512, description="New roadmap title")
    version: Optional[str] = Field(None, min_length=1, max_length=100, description="New version number")
    content: Optional[str] = Field(None, description="New roadmap content")

    class Config:
        json_schema_extra = {
            "example": {
                "title": "Updated Q1 2025 Roadmap",
                "version": "1.1",
                "content": "## Updated Milestones\n- Week 1: Authentication\n- Week 2: History API\n- Week 3: Frontend UI\n- Week 4: Testing"
            }
        }


# ============================================================================
# Repo History Schemas
# ============================================================================

class RepoHistoryCreate(BaseModel):
    """
    Schema for creating repo history.

    Attributes:
        repo_name: Repository name
        repo_url: Repository URL
        interaction_type: Type of interaction (clone, commit, pr, issue, etc.)
        interaction_metadata: JSON metadata about the interaction
    """
    repo_name: str = Field(..., min_length=1, max_length=512, description="Repository name")
    repo_url: str = Field(..., min_length=1, max_length=1024, description="Repository URL")
    interaction_type: str = Field(..., min_length=1, max_length=100, description="Type of interaction")
    interaction_metadata: Dict[str, Any] = Field(default_factory=dict, description="Interaction metadata")

    class Config:
        json_schema_extra = {
            "example": {
                "repo_name": "Andymik90/Auto-Claude",
                "repo_url": "https://github.com/Andymik90/Auto-Claude",
                "interaction_type": "clone",
                "interaction_metadata": {"branch": "develop", "commit": "abc123"}
            }
        }


class RepoHistoryResponse(BaseModel):
    """
    Schema for repo history response.

    Attributes:
        id: Repo history record ID
        repo_name: Repository name
        repo_url: Repository URL
        interaction_type: Type of interaction
        interaction_metadata: JSON metadata about the interaction
        created_at: Timestamp of interaction
    """
    id: int = Field(..., description="Repo history record ID")
    repo_name: str = Field(..., description="Repository name")
    repo_url: str = Field(..., description="Repository URL")
    interaction_type: str = Field(..., description="Type of interaction")
    interaction_metadata: Dict[str, Any] = Field(default_factory=dict, description="Interaction metadata")
    created_at: datetime = Field(..., description="Timestamp of interaction")

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "repo_name": "Andymik90/Auto-Claude",
                "repo_url": "https://github.com/Andymik90/Auto-Claude",
                "interaction_type": "clone",
                "interaction_metadata": {"branch": "develop", "commit": "abc123"},
                "created_at": "2025-01-25T10:00:00Z"
            }
        }


class RepoHistoryUpdate(BaseModel):
    """
    Schema for updating repo history.

    Note:
        Only interaction_metadata can be updated as other fields
        should be immutable for audit trail purposes.
    """
    interaction_metadata: Optional[Dict[str, Any]] = Field(None, description="Updated interaction metadata")

    class Config:
        json_schema_extra = {
            "example": {
                "interaction_metadata": {"branch": "main", "commit": "def456", "notes": "Updated metadata"}
            }
        }
