"""
GitHub Account Service Business Logic
======================================

This module provides business logic for GitHub account linking:
- Link GitHub accounts to existing users
- Unlink GitHub accounts from users
- Query user's linked GitHub accounts

Service layer separates business logic from API routes.
"""

from sqlalchemy.orm import Session
from typing import Optional, List

from models import User, GitHubAccount


def link_github_account(
    db: Session,
    user: User,
    github_id: int,
    username: str,
    avatar_url: Optional[str],
    access_token: str
) -> GitHubAccount:
    """
    Link a GitHub account to a user.

    Args:
        db: Database session
        user: User object to link GitHub account to
        github_id: GitHub user ID (unique across GitHub)
        username: GitHub username
        avatar_url: Profile picture URL (optional)
        access_token: OAuth access token from GitHub

    Returns:
        Created GitHubAccount object

    Raises:
        ValueError: If this GitHub account is already linked to the user

    Note:
        - Users can link multiple GitHub accounts
        - Prevents duplicate github_id per user (idempotent operation)
        - github_id must be unique globally (enforced by database)
        - Access token stored for GitHub API calls
        - Automatically sets linked_at timestamp
    """
    # Check if this GitHub account is already linked to this user
    existing_account = db.query(GitHubAccount).filter(
        GitHubAccount.user_id == user.id,
        GitHubAccount.github_id == github_id
    ).first()

    if existing_account:
        # Idempotent operation - return existing account
        return existing_account

    # Create new GitHub account link
    new_account = GitHubAccount(
        user_id=user.id,
        github_id=github_id,
        username=username,
        avatar_url=avatar_url,
        access_token=access_token
    )

    # Add to database and commit
    db.add(new_account)
    db.commit()
    db.refresh(new_account)

    return new_account


def unlink_github_account(db: Session, user: User, account_id: int) -> Optional[GitHubAccount]:
    """
    Unlink a GitHub account from a user.

    Args:
        db: Database session
        user: User object who owns the GitHub account
        account_id: ID of the GitHub account to unlink

    Returns:
        The unlinked GitHubAccount object, or None if not found

    Raises:
        ValueError: If the account does not belong to the user

    Note:
        - Verifies account ownership before unlinking
        - Does NOT delete the user account, only the GitHub link
        - Returns the unlinked account for confirmation
        - Safe to call (idempotent if account already unlinked)
    """
    # Query the GitHub account
    account = db.query(GitHubAccount).filter(
        GitHubAccount.id == account_id
    ).first()

    # If account doesn't exist, return None
    if not account:
        return None

    # Verify account belongs to the user
    if account.user_id != user.id:
        raise ValueError(
            f"GitHub account {account_id} does not belong to user {user.id}"
        )

    # Store account info before deletion
    account_info = account

    # Delete the account
    db.delete(account)
    db.commit()

    return account_info


def get_user_github_accounts(db: Session, user: User) -> List[GitHubAccount]:
    """
    Get all GitHub accounts linked to a user.

    Args:
        db: Database session
        user: User object to query GitHub accounts for

    Returns:
        List of GitHubAccount objects linked to the user

    Note:
        - Returns empty list if no accounts linked
        - Ordered by linked_at timestamp (newest first)
        - Useful for displaying linked accounts in settings page
    """
    return db.query(GitHubAccount).filter(
        GitHubAccount.user_id == user.id
    ).order_by(GitHubAccount.linked_at.desc()).all()


def get_github_account_by_id(db: Session, account_id: int) -> Optional[GitHubAccount]:
    """
    Get a GitHub account by ID.

    Args:
        db: Database session
        account_id: GitHub account unique identifier

    Returns:
        GitHubAccount object if found, None otherwise

    Note:
        - Used by unlink endpoint to verify account exists
        - Does NOT check ownership - caller must verify user_id
    """
    return db.query(GitHubAccount).filter(
        GitHubAccount.id == account_id
    ).first()


def get_github_account_by_github_id(db: Session, github_id: int) -> Optional[GitHubAccount]:
    """
    Get a GitHub account by GitHub user ID.

    Args:
        db: Database session
        github_id: GitHub user ID (from GitHub API)

    Returns:
        GitHubAccount object if found, None otherwise

    Note:
        - Useful for checking if GitHub account already exists
        - Used during OAuth callback to find existing links
        - github_id is globally unique (enforced by database constraint)
    """
    return db.query(GitHubAccount).filter(
        GitHubAccount.github_id == github_id
    ).first()
