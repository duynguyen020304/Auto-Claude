"""
Database Connection and Session Management
==========================================Provides SQLAlchemy engine, session factory, and base class for models.
Supports both SQLite (development) and PostgreSQL (production).
"""

import os
from typing import Generator

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# Load environment variables from .env file
load_dotenv()


# Database URL configuration
# Falls back to SQLite for development if DATABASE_URL not set
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./autoclaude.db",
)

# Create SQLAlchemy engine
# echo=True for SQL logging in development (set via SQL_ECHO env var)
engine = create_engine(
    DATABASE_URL,
    echo=os.getenv("SQL_ECHO", "false").lower() == "true",
    # SQLite-specific configuration
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)

# Create SessionLocal class for database sessions
# autocommit=False and autoflush=False are standard FastAPI patterns
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# Base class for all SQLAlchemy models
# All models should inherit from this class
class Base(DeclarativeBase):
    """Base class for SQLAlchemy models."""
    pass


def get_db() -> Generator[Session, None, None]:
    """
    Dependency function to get database session.

    Usage in FastAPI routes:
        @app.get("/users/{user_id}")
        def get_user(user_id: int, db: Session = Depends(get_db)):
            return db.query(User).filter(User.id == user_id).first()

    Yields:
        Session: SQLAlchemy database session

    Example:
        >>> for db in get_db():
        ...     users = db.query(User).all()
        ...     break
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """
    Initialize database by creating all tables.

    This function creates all tables that don't exist yet.
    Use this for development only. For production, use Alembic migrations.

    Example:
        >>> init_db()
    """
    Base.metadata.create_all(bind=engine)
