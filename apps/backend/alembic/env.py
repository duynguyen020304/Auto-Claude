"""
Alembic Migration Environment
==============================

This file is configured to run with Alembic to manage database migrations.
It connects to the database and imports all SQLAlchemy models so that
'alembic revision --autogenerate' can detect model changes.

Usage:
    alembic revision --autogenerate -m "description"
    alembic upgrade head
    alembic downgrade -1
"""

import os
import sys
from logging.config import fileConfig

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

# Import database and models
# This path needs to be added to sys.path for imports to work
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database import Base
from models import (
    User,
    GitHubAccount,
    ChatHistory,
    IdeationHistory,
    RoadmapHistory,
    RepoHistory,
)

# Load environment variables from .env file
# This allows DATABASE_URL to be configured via environment
load_dotenv()

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# The target_metadata is used by Autogenerate to know what models exist
target_metadata = Base.metadata

# Override sqlalchemy.url from environment variable if set
# This allows using DATABASE_URL from .env instead of hardcoded in alembic.ini
database_url = os.getenv("DATABASE_URL")
if database_url:
    config.set_main_option("sqlalchemy.url", database_url)


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # Compare type for JSON columns (useful for PostgreSQL jsonb)
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.
    """
    # Use async engine for asyncpg if using PostgreSQL async driver
    # For now, use synchronous engine which works with both SQLite and PostgreSQL
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # Compare server defaults (like default timestamps)
            compare_server_default=True,
            # Compare type for JSON columns
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


# Run migrations in offline or online mode
# Offline mode is useful for generating SQL scripts without database connection
# Online mode requires an active database connection
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
