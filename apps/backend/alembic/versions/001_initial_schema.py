"""Initial schema for authentication and history

Revision ID: 001
Revises:
Create Date: 2025-01-25 09:50

This migration creates the initial database schema for:
- User authentication (email/password)
- GitHub OAuth accounts
- Four types of history data (Chat, Ideation, Roadmap, Repo)

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create all tables for authentication and history."""

    # Create users table
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_id"), "users", ["id"])
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    # Create github_accounts table
    op.create_table(
        "github_accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("github_id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("avatar_url", sa.String(length=512), nullable=True),
        sa.Column("access_token", sa.String(length=512), nullable=False),
        sa.Column("linked_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_github_accounts_id"), "github_accounts", ["id"])
    op.create_index(op.f("ix_github_accounts_user_id"), "github_accounts", ["user_id"])
    op.create_index(op.f("ix_github_accounts_github_id"), "github_accounts", ["github_id"], unique=True)

    # Create chat_histories table
    op.create_table(
        "chat_histories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("messages", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chat_histories_id"), "chat_histories", ["id"])
    op.create_index(op.f("ix_chat_histories_user_id"), "chat_histories", ["user_id"])

    # Create ideation_histories table
    op.create_table(
        "ideation_histories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ideation_histories_id"), "ideation_histories", ["id"])
    op.create_index(op.f("ix_ideation_histories_user_id"), "ideation_histories", ["user_id"])

    # Create roadmap_histories table
    op.create_table(
        "roadmap_histories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("version", sa.String(length=100), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_roadmap_histories_id"), "roadmap_histories", ["id"])
    op.create_index(op.f("ix_roadmap_histories_user_id"), "roadmap_histories", ["user_id"])

    # Create repo_histories table
    op.create_table(
        "repo_histories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("repo_name", sa.String(length=512), nullable=False),
        sa.Column("repo_url", sa.String(length=1024), nullable=False),
        sa.Column("interaction_type", sa.String(length=100), nullable=False),
        sa.Column("interaction_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_repo_histories_id"), "repo_histories", ["id"])
    op.create_index(op.f("ix_repo_histories_user_id"), "repo_histories", ["user_id"])
    op.create_index(op.f("ix_repo_histories_repo_name"), "repo_histories", ["repo_name"])


def downgrade() -> None:
    """Drop all tables in reverse order of creation."""

    # Drop repo_histories table
    op.drop_index(op.f("ix_repo_histories_repo_name"), table_name="repo_histories")
    op.drop_index(op.f("ix_repo_histories_user_id"), table_name="repo_histories")
    op.drop_index(op.f("ix_repo_histories_id"), table_name="repo_histories")
    op.drop_table("repo_histories")

    # Drop roadmap_histories table
    op.drop_index(op.f("ix_roadmap_histories_user_id"), table_name="roadmap_histories")
    op.drop_index(op.f("ix_roadmap_histories_id"), table_name="roadmap_histories")
    op.drop_table("roadmap_histories")

    # Drop ideation_histories table
    op.drop_index(op.f("ix_ideation_histories_user_id"), table_name="ideation_histories")
    op.drop_index(op.f("ix_ideation_histories_id"), table_name="ideation_histories")
    op.drop_table("ideation_histories")

    # Drop chat_histories table
    op.drop_index(op.f("ix_chat_histories_user_id"), table_name="chat_histories")
    op.drop_index(op.f("ix_chat_histories_id"), table_name="chat_histories")
    op.drop_table("chat_histories")

    # Drop github_accounts table
    op.drop_index(op.f("ix_github_accounts_github_id"), table_name="github_accounts")
    op.drop_index(op.f("ix_github_accounts_user_id"), table_name="github_accounts")
    op.drop_index(op.f("ix_github_accounts_id"), table_name="github_accounts")
    op.drop_table("github_accounts")

    # Drop users table
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_table("users")
