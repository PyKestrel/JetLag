"""
Alembic migration environment for JetLag.

Runs migrations synchronously against the SQLite database.
The database URL is derived from JETLAG_DB_DIR (same logic as database.py).
"""

import os
import sys
from pathlib import Path
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# Ensure the backend package is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import Base
from app.models import Client, ImpairmentProfile, MatchRule, Capture, EventLog  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Build the sync SQLite URL from the same env var database.py uses
DB_DIR = Path(os.environ.get("JETLAG_DB_DIR", Path(__file__).parent.parent / "data"))
DB_DIR.mkdir(parents=True, exist_ok=True)
SYNC_URL = f"sqlite:///{DB_DIR / 'jetlag.db'}"


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emit SQL to stdout."""
    context.configure(
        url=SYNC_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode — connect to the database."""
    cfg = config.get_section(config.config_ini_section, {})
    cfg["sqlalchemy.url"] = SYNC_URL

    connectable = engine_from_config(
        cfg,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # Required for SQLite ALTER TABLE support
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
