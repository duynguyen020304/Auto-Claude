"""
Authentication Service Business Logic
======================================

This module provides business logic for user authentication:
- User registration with email/password
- User authentication with email/password
- Password hashing and verification

Service layer separates business logic from API routes.
"""

from sqlalchemy.orm import Session
from typing import Optional

from models import User
from auth import hash_password, verify_password
from schemas import UserCreate


def create_user(db: Session, user_data: UserCreate) -> User:
    """
    Create a new user with email and password.

    Args:
        db: Database session
        user_data: User registration data (email, password)

    Returns:
        Created User object

    Raises:
        ValueError: If email already exists in database

    Note:
        - Password is hashed with bcrypt before storage
        - Email must be unique (enforced by database constraint)
        - Returns the created User with ID assigned
    """
    # Check if user with this email already exists
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise ValueError(f"User with email '{user_data.email}' already exists")

    # Hash the password with bcrypt
    hashed_password = hash_password(user_data.password)

    # Create new user instance
    new_user = User(
        email=user_data.email,
        hashed_password=hashed_password
    )

    # Add to database and commit
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user


def authenticate_user(db: Session, email: str, password: str) -> Optional[User]:
    """
    Authenticate a user with email and password.

    Args:
        db: Database session
        email: User's email address
        password: Plain text password to verify

    Returns:
        User object if authentication successful, None if failed

    Note:
        - Queries user by email
        - Verifies password against stored bcrypt hash
        - Returns None if user not found or password incorrect
        - Uses constant-time comparison to prevent timing attacks
    """
    # Query user by email
    user = db.query(User).filter(User.email == email).first()

    # If no user found, return None
    if not user:
        return None

    # Verify password against stored hash
    if not verify_password(password, user.hashed_password):
        return None

    # Authentication successful
    return user


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    """
    Get a user by ID.

    Args:
        db: Database session
        user_id: User's unique identifier

    Returns:
        User object if found, None otherwise

    Note:
        Used by JWT authentication dependency to retrieve
        current user from token payload.
    """
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """
    Get a user by email address.

    Args:
        db: Database session
        email: User's email address

    Returns:
        User object if found, None otherwise

    Note:
        Useful for checking if user exists before registration
        or for login by email.
    """
    return db.query(User).filter(User.email == email).first()
