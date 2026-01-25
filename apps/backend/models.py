"""
SQLAlchemy Models for Authentication and History
================================================

This module defines all database models for:
- User authentication (email/password and GitHub OAuth)
- Four types of history data (Chat, Ideation, Roadmap, Repo)

All models inherit from Base class in database.py.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from database import Base


class User(Base):
    """
    User account model for email/password authentication.

    Attributes:
        id: Primary key
        email: Unique email address for login
        hashed_password: Bcrypt hashed password
        created_at: Account creation timestamp
        github_accounts: Linked GitHub accounts (one-to-many)
        chat_histories: User's chat history (one-to-many)
        ideation_histories: User's ideation history (one-to-many)
        roadmap_histories: User's roadmap history (one-to-many)
        repo_histories: User's repo history (one-to-many)
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    github_accounts: Mapped[list["GitHubAccount"]] = relationship(
        "GitHubAccount", back_populates="user", cascade="all, delete-orphan"
    )
    chat_histories: Mapped[list["ChatHistory"]] = relationship(
        "ChatHistory", back_populates="user", cascade="all, delete-orphan"
    )
    ideation_histories: Mapped[list["IdeationHistory"]] = relationship(
        "IdeationHistory", back_populates="user", cascade="all, delete-orphan"
    )
    roadmap_histories: Mapped[list["RoadmapHistory"]] = relationship(
        "RoadmapHistory", back_populates="user", cascade="all, delete-orphan"
    )
    repo_histories: Mapped[list["RepoHistory"]] = relationship(
        "RepoHistory", back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email})>"


class GitHubAccount(Base):
    """
    GitHub OAuth linked account model.

    Users can link multiple GitHub accounts to their profile.
    Each account stores OAuth token for GitHub API access.

    Attributes:
        id: Primary key
        user_id: Foreign key to users table
        github_id: GitHub user ID (unique across GitHub)
        username: GitHub username
        avatar_url: Profile picture URL
        access_token: OAuth access token
        linked_at: When the account was linked
        user: Parent user account
    """

    __tablename__ = "github_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    github_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    access_token: Mapped[str] = mapped_column(String(512), nullable=False)
    linked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationship
    user: Mapped["User"] = relationship("User", back_populates="github_accounts")

    def __repr__(self) -> str:
        return f"<GitHubAccount(id={self.id}, github_id={self.github_id}, username={self.username})>"


class ChatHistory(Base):
    """
    Chat conversation history model.

    Stores conversation threads with messages in JSON format.

    Attributes:
        id: Primary key
        user_id: Foreign key to users table
        title: Conversation title
        messages: JSON array of message objects
        created_at: Creation timestamp
        updated_at: Last update timestamp
        user: Parent user account
    """

    __tablename__ = "chat_histories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    messages: Mapped[dict] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationship
    user: Mapped["User"] = relationship("User", back_populates="chat_histories")

    def __repr__(self) -> str:
        return f"<ChatHistory(id={self.id}, title={self.title}, user_id={self.user_id})>"


class IdeationHistory(Base):
    """
    Ideation/brainstorming session history model.

    Stores creative sessions with content and tags.

    Attributes:
        id: Primary key
        user_id: Foreign key to users table
        title: Session title
        content: Session content (text, markdown, etc.)
        tags: JSON array of tag strings
        created_at: Creation timestamp
        updated_at: Last update timestamp
        user: Parent user account
    """

    __tablename__ = "ideation_histories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[dict] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationship
    user: Mapped["User"] = relationship("User", back_populates="ideation_histories")

    def __repr__(self) -> str:
        return f"<IdeationHistory(id={self.id}, title={self.title}, user_id={self.user_id})>"


class RoadmapHistory(Base):
    """
    Roadmap version history model.

    Tracks roadmap changes and versions over time.

    Attributes:
        id: Primary key
        user_id: Foreign key to users table
        title: Roadmap title
        version: Version number or identifier
        content: Roadmap content (tasks, milestones, etc.)
        created_at: Creation timestamp
        updated_at: Last update timestamp
        user: Parent user account
    """

    __tablename__ = "roadmap_histories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    version: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationship
    user: Mapped["User"] = relationship("User", back_populates="roadmap_histories")

    def __repr__(self) -> str:
        return f"<RoadmapHistory(id={self.id}, title={self.title}, version={self.version}, user_id={self.user_id})>"


class RepoHistory(Base):
    """
    Repository interaction history model.

    Maintains records of repository interactions (clones, commits, PRs, etc.).

    Attributes:
        id: Primary key
        user_id: Foreign key to users table
        repo_name: Repository name
        repo_url: Repository URL
        interaction_type: Type of interaction (clone, commit, pr, issue, etc.)
        interaction_metadata: JSON metadata about the interaction
        created_at: Timestamp of interaction
        user: Parent user account
    """

    __tablename__ = "repo_histories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    repo_name: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    repo_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    interaction_type: Mapped[str] = mapped_column(String(100), nullable=False)
    interaction_metadata: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationship
    user: Mapped["User"] = relationship("User", back_populates="repo_histories")

    def __repr__(self) -> str:
        return f"<RepoHistory(id={self.id}, repo_name={self.repo_name}, interaction_type={self.interaction_type}, user_id={self.user_id})>"
