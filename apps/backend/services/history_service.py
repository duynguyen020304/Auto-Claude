"""
History Service Business Logic
================================

This module provides business logic for history data persistence:
- Chat history (conversation threads)
- Ideation history (brainstorming sessions)
- Roadmap history (roadmap versions)
- Repo history (repository interactions)

Service layer separates business logic from API routes.
All operations ensure user data isolation - users can only access their own data.
"""

from sqlalchemy.orm import Session
from typing import Optional, List, Dict, Any

from models import ChatHistory, IdeationHistory, RoadmapHistory, RepoHistory
from schemas import (
    ChatHistoryCreate, ChatHistoryUpdate,
    IdeationHistoryCreate, IdeationHistoryUpdate,
    RoadmapHistoryCreate, RoadmapHistoryUpdate,
    RepoHistoryCreate, RepoHistoryUpdate
)


# ============================================================================
# Chat History CRUD Operations
# ============================================================================

def create_chat_history(db: Session, user_id: int, history_data: ChatHistoryCreate) -> ChatHistory:
    """
    Create a new chat history record for a user.

    Args:
        db: Database session
        user_id: User's unique identifier
        history_data: Chat history creation data (title, messages)

    Returns:
        Created ChatHistory object

    Note:
        - Automatically links to user via user_id
        - Messages stored as JSON
        - Timestamps auto-generated
    """
    new_history = ChatHistory(
        user_id=user_id,
        title=history_data.title,
        messages=history_data.messages
    )

    db.add(new_history)
    db.commit()
    db.refresh(new_history)

    return new_history


def get_chat_history(db: Session, history_id: int, user_id: int) -> Optional[ChatHistory]:
    """
    Get a specific chat history by ID (user-isolated).

    Args:
        db: Database session
        history_id: Chat history record ID
        user_id: User's unique identifier (for access control)

    Returns:
        ChatHistory object if found and owned by user, None otherwise

    Note:
        User data isolation enforced - returns None if history
        belongs to different user.
    """
    return db.query(ChatHistory).filter(
        ChatHistory.id == history_id,
        ChatHistory.user_id == user_id
    ).first()


def get_user_chat_histories(
    db: Session,
    user_id: int,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    sort_newest: bool = True
) -> List[ChatHistory]:
    """
    Get all chat histories for a user with filtering and pagination.

    Args:
        db: Database session
        user_id: User's unique identifier
        skip: Number of records to skip (pagination)
        limit: Maximum number of records to return
        search: Optional search term for title/content
        date_start: Optional start date filter (YYYY-MM-DD)
        date_end: Optional end date filter (YYYY-MM-DD)
        sort_newest: Sort by newest first (True) or oldest first (False)

    Returns:
        List of ChatHistory objects

    Note:
        - Always filtered by user_id for data isolation
        - Search uses case-insensitive partial match on title
        - Date filters apply to created_at timestamp
    """
    query = db.query(ChatHistory).filter(ChatHistory.user_id == user_id)

    # Apply search filter
    if search:
        query = query.filter(ChatHistory.title.ilike(f"%{search}%"))

    # Apply date range filters
    if date_start:
        query = query.filter(ChatHistory.created_at >= date_start)
    if date_end:
        query = query.filter(ChatHistory.created_at <= date_end)

    # Apply sorting
    if sort_newest:
        query = query.order_by(ChatHistory.created_at.desc())
    else:
        query = query.order_by(ChatHistory.created_at.asc())

    # Apply pagination
    return query.offset(skip).limit(limit).all()


def update_chat_history(
    db: Session,
    history_id: int,
    user_id: int,
    history_data: ChatHistoryUpdate
) -> Optional[ChatHistory]:
    """
    Update a chat history record (user-isolated).

    Args:
        db: Database session
        history_id: Chat history record ID
        user_id: User's unique identifier (for access control)
        history_data: Update data (title, messages)

    Returns:
        Updated ChatHistory object if found and owned by user, None otherwise

    Note:
        Only updates fields that are provided (partial update supported).
        updated_at timestamp auto-updated by SQLAlchemy.
    """
    history = db.query(ChatHistory).filter(
        ChatHistory.id == history_id,
        ChatHistory.user_id == user_id
    ).first()

    if not history:
        return None

    # Update fields if provided
    if history_data.title is not None:
        history.title = history_data.title
    if history_data.messages is not None:
        history.messages = history_data.messages

    db.commit()
    db.refresh(history)

    return history


def delete_chat_history(db: Session, history_id: int, user_id: int) -> bool:
    """
    Delete a chat history record (user-isolated).

    Args:
        db: Database session
        history_id: Chat history record ID
        user_id: User's unique identifier (for access control)

    Returns:
        True if deleted, False if not found or not owned by user

    Note:
        Hard delete - record permanently removed from database.
    """
    history = db.query(ChatHistory).filter(
        ChatHistory.id == history_id,
        ChatHistory.user_id == user_id
    ).first()

    if not history:
        return False

    db.delete(history)
    db.commit()

    return True


# ============================================================================
# Ideation History CRUD Operations
# ============================================================================

def create_ideation_history(db: Session, user_id: int, history_data: IdeationHistoryCreate) -> IdeationHistory:
    """
    Create a new ideation history record for a user.

    Args:
        db: Database session
        user_id: User's unique identifier
        history_data: Ideation history creation data (title, content, tags)

    Returns:
        Created IdeationHistory object

    Note:
        Tags stored as JSON array for flexible querying.
    """
    new_history = IdeationHistory(
        user_id=user_id,
        title=history_data.title,
        content=history_data.content,
        tags=history_data.tags
    )

    db.add(new_history)
    db.commit()
    db.refresh(new_history)

    return new_history


def get_ideation_history(db: Session, history_id: int, user_id: int) -> Optional[IdeationHistory]:
    """
    Get a specific ideation history by ID (user-isolated).

    Args:
        db: Database session
        history_id: Ideation history record ID
        user_id: User's unique identifier (for access control)

    Returns:
        IdeationHistory object if found and owned by user, None otherwise
    """
    return db.query(IdeationHistory).filter(
        IdeationHistory.id == history_id,
        IdeationHistory.user_id == user_id
    ).first()


def get_user_ideation_histories(
    db: Session,
    user_id: int,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    sort_newest: bool = True
) -> List[IdeationHistory]:
    """
    Get all ideation histories for a user with filtering and pagination.

    Args:
        db: Database session
        user_id: User's unique identifier
        skip: Number of records to skip (pagination)
        limit: Maximum number of records to return
        search: Optional search term for title/content
        date_start: Optional start date filter (YYYY-MM-DD)
        date_end: Optional end date filter (YYYY-MM-DD)
        sort_newest: Sort by newest first (True) or oldest first (False)

    Returns:
        List of IdeationHistory objects

    Note:
        Search applies to both title and content fields.
    """
    query = db.query(IdeationHistory).filter(IdeationHistory.user_id == user_id)

    # Apply search filter (title or content)
    if search:
        query = query.filter(
            (IdeationHistory.title.ilike(f"%{search}%")) |
            (IdeationHistory.content.ilike(f"%{search}%"))
        )

    # Apply date range filters
    if date_start:
        query = query.filter(IdeationHistory.created_at >= date_start)
    if date_end:
        query = query.filter(IdeationHistory.created_at <= date_end)

    # Apply sorting
    if sort_newest:
        query = query.order_by(IdeationHistory.created_at.desc())
    else:
        query = query.order_by(IdeationHistory.created_at.asc())

    # Apply pagination
    return query.offset(skip).limit(limit).all()


def update_ideation_history(
    db: Session,
    history_id: int,
    user_id: int,
    history_data: IdeationHistoryUpdate
) -> Optional[IdeationHistory]:
    """
    Update an ideation history record (user-isolated).

    Args:
        db: Database session
        history_id: Ideation history record ID
        user_id: User's unique identifier (for access control)
        history_data: Update data (title, content, tags)

    Returns:
        Updated IdeationHistory object if found and owned by user, None otherwise
    """
    history = db.query(IdeationHistory).filter(
        IdeationHistory.id == history_id,
        IdeationHistory.user_id == user_id
    ).first()

    if not history:
        return None

    # Update fields if provided
    if history_data.title is not None:
        history.title = history_data.title
    if history_data.content is not None:
        history.content = history_data.content
    if history_data.tags is not None:
        history.tags = history_data.tags

    db.commit()
    db.refresh(history)

    return history


def delete_ideation_history(db: Session, history_id: int, user_id: int) -> bool:
    """
    Delete an ideation history record (user-isolated).

    Args:
        db: Database session
        history_id: Ideation history record ID
        user_id: User's unique identifier (for access control)

    Returns:
        True if deleted, False if not found or not owned by user
    """
    history = db.query(IdeationHistory).filter(
        IdeationHistory.id == history_id,
        IdeationHistory.user_id == user_id
    ).first()

    if not history:
        return False

    db.delete(history)
    db.commit()

    return True


# ============================================================================
# Roadmap History CRUD Operations
# ============================================================================

def create_roadmap_history(db: Session, user_id: int, history_data: RoadmapHistoryCreate) -> RoadmapHistory:
    """
    Create a new roadmap history record for a user.

    Args:
        db: Database session
        user_id: User's unique identifier
        history_data: Roadmap history creation data (title, version, content)

    Returns:
        Created RoadmapHistory object

    Note:
        Version field allows tracking multiple roadmap versions.
    """
    new_history = RoadmapHistory(
        user_id=user_id,
        title=history_data.title,
        version=history_data.version,
        content=history_data.content
    )

    db.add(new_history)
    db.commit()
    db.refresh(new_history)

    return new_history


def get_roadmap_history(db: Session, history_id: int, user_id: int) -> Optional[RoadmapHistory]:
    """
    Get a specific roadmap history by ID (user-isolated).

    Args:
        db: Database session
        history_id: Roadmap history record ID
        user_id: User's unique identifier (for access control)

    Returns:
        RoadmapHistory object if found and owned by user, None otherwise
    """
    return db.query(RoadmapHistory).filter(
        RoadmapHistory.id == history_id,
        RoadmapHistory.user_id == user_id
    ).first()


def get_user_roadmap_histories(
    db: Session,
    user_id: int,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    sort_newest: bool = True
) -> List[RoadmapHistory]:
    """
    Get all roadmap histories for a user with filtering and pagination.

    Args:
        db: Database session
        user_id: User's unique identifier
        skip: Number of records to skip (pagination)
        limit: Maximum number of records to return
        search: Optional search term for title/content
        date_start: Optional start date filter (YYYY-MM-DD)
        date_end: Optional end date filter (YYYY-MM-DD)
        sort_newest: Sort by newest first (True) or oldest first (False)

    Returns:
        List of RoadmapHistory objects
    """
    query = db.query(RoadmapHistory).filter(RoadmapHistory.user_id == user_id)

    # Apply search filter (title or content)
    if search:
        query = query.filter(
            (RoadmapHistory.title.ilike(f"%{search}%")) |
            (RoadmapHistory.content.ilike(f"%{search}%"))
        )

    # Apply date range filters
    if date_start:
        query = query.filter(RoadmapHistory.created_at >= date_start)
    if date_end:
        query = query.filter(RoadmapHistory.created_at <= date_end)

    # Apply sorting
    if sort_newest:
        query = query.order_by(RoadmapHistory.created_at.desc())
    else:
        query = query.order_by(RoadmapHistory.created_at.asc())

    # Apply pagination
    return query.offset(skip).limit(limit).all()


def update_roadmap_history(
    db: Session,
    history_id: int,
    user_id: int,
    history_data: RoadmapHistoryUpdate
) -> Optional[RoadmapHistory]:
    """
    Update a roadmap history record (user-isolated).

    Args:
        db: Database session
        history_id: Roadmap history record ID
        user_id: User's unique identifier (for access control)
        history_data: Update data (title, version, content)

    Returns:
        Updated RoadmapHistory object if found and owned by user, None otherwise
    """
    history = db.query(RoadmapHistory).filter(
        RoadmapHistory.id == history_id,
        RoadmapHistory.user_id == user_id
    ).first()

    if not history:
        return None

    # Update fields if provided
    if history_data.title is not None:
        history.title = history_data.title
    if history_data.version is not None:
        history.version = history_data.version
    if history_data.content is not None:
        history.content = history_data.content

    db.commit()
    db.refresh(history)

    return history


def delete_roadmap_history(db: Session, history_id: int, user_id: int) -> bool:
    """
    Delete a roadmap history record (user-isolated).

    Args:
        db: Database session
        history_id: Roadmap history record ID
        user_id: User's unique identifier (for access control)

    Returns:
        True if deleted, False if not found or not owned by user
    """
    history = db.query(RoadmapHistory).filter(
        RoadmapHistory.id == history_id,
        RoadmapHistory.user_id == user_id
    ).first()

    if not history:
        return False

    db.delete(history)
    db.commit()

    return True


# ============================================================================
# Repo History CRUD Operations
# ============================================================================

def create_repo_history(db: Session, user_id: int, history_data: RepoHistoryCreate) -> RepoHistory:
    """
    Create a new repo history record for a user.

    Args:
        db: Database session
        user_id: User's unique identifier
        history_data: Repo history creation data (repo_name, repo_url, interaction_type, metadata)

    Returns:
        Created RepoHistory object

    Note:
        Used for tracking repository interactions (clones, commits, PRs, etc.).
    """
    new_history = RepoHistory(
        user_id=user_id,
        repo_name=history_data.repo_name,
        repo_url=history_data.repo_url,
        interaction_type=history_data.interaction_type,
        interaction_metadata=history_data.interaction_metadata
    )

    db.add(new_history)
    db.commit()
    db.refresh(new_history)

    return new_history


def get_repo_history(db: Session, history_id: int, user_id: int) -> Optional[RepoHistory]:
    """
    Get a specific repo history by ID (user-isolated).

    Args:
        db: Database session
        history_id: Repo history record ID
        user_id: User's unique identifier (for access control)

    Returns:
        RepoHistory object if found and owned by user, None otherwise
    """
    return db.query(RepoHistory).filter(
        RepoHistory.id == history_id,
        RepoHistory.user_id == user_id
    ).first()


def get_user_repo_histories(
    db: Session,
    user_id: int,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    sort_newest: bool = True
) -> List[RepoHistory]:
    """
    Get all repo histories for a user with filtering and pagination.

    Args:
        db: Database session
        user_id: User's unique identifier
        skip: Number of records to skip (pagination)
        limit: Maximum number of records to return
        search: Optional search term for repo name
        date_start: Optional start date filter (YYYY-MM-DD)
        date_end: Optional end date filter (YYYY-MM-DD)
        sort_newest: Sort by newest first (True) or oldest first (False)

    Returns:
        List of RepoHistory objects

    Note:
        Search filters by repo_name for finding specific repository interactions.
    """
    query = db.query(RepoHistory).filter(RepoHistory.user_id == user_id)

    # Apply search filter (repo_name)
    if search:
        query = query.filter(RepoHistory.repo_name.ilike(f"%{search}%"))

    # Apply date range filters
    if date_start:
        query = query.filter(RepoHistory.created_at >= date_start)
    if date_end:
        query = query.filter(RepoHistory.created_at <= date_end)

    # Apply sorting
    if sort_newest:
        query = query.order_by(RepoHistory.created_at.desc())
    else:
        query = query.order_by(RepoHistory.created_at.asc())

    # Apply pagination
    return query.offset(skip).limit(limit).all()


def update_repo_history(
    db: Session,
    history_id: int,
    user_id: int,
    history_data: RepoHistoryUpdate
) -> Optional[RepoHistory]:
    """
    Update a repo history record (user-isolated).

    Args:
        db: Database session
        history_id: Repo history record ID
        user_id: User's unique identifier (for access control)
        history_data: Update data (interaction_metadata only)

    Returns:
        Updated RepoHistory object if found and owned by user, None otherwise

    Note:
        Only interaction_metadata can be updated. Other fields (repo_name,
        repo_url, interaction_type) are immutable for audit trail purposes.
    """
    history = db.query(RepoHistory).filter(
        RepoHistory.id == history_id,
        RepoHistory.user_id == user_id
    ).first()

    if not history:
        return None

    # Update metadata if provided
    if history_data.interaction_metadata is not None:
        history.interaction_metadata = history_data.interaction_metadata

    db.commit()
    db.refresh(history)

    return history


def delete_repo_history(db: Session, history_id: int, user_id: int) -> bool:
    """
    Delete a repo history record (user-isolated).

    Args:
        db: Database session
        history_id: Repo history record ID
        user_id: User's unique identifier (for access control)

    Returns:
        True if deleted, False if not found or not owned by user
    """
    history = db.query(RepoHistory).filter(
        RepoHistory.id == history_id,
        RepoHistory.user_id == user_id
    ).first()

    if not history:
        return False

    db.delete(history)
    db.commit()

    return True
