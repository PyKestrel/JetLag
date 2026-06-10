"""add users table

Revision ID: 008_users
Revises: 007_client_session_minutes
Create Date: 2026-06-10

Admin users for the authentication system.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa


revision: str = "008_users"
down_revision: Union[str, None] = "007_client_session_minutes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(name: str) -> bool:
    conn = op.get_bind()
    return name in inspect(conn).get_table_names()


def upgrade() -> None:
    if not _table_exists("users"):
        op.create_table(
            "users",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("username", sa.String(64), nullable=False, unique=True),
            sa.Column("password_hash", sa.String(255), nullable=False),
            sa.Column("role", sa.String(20), default="admin"),
            sa.Column("must_change_password", sa.Boolean, default=False),
            sa.Column("created_at", sa.DateTime),
            sa.Column("last_login", sa.DateTime, nullable=True),
        )
        op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
