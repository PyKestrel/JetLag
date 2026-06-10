"""add session_minutes column to clients

Revision ID: 007_client_session_minutes
Revises: 006_dns_entries
Create Date: 2026-06-10

Stores the per-session duration (minutes) chosen at authentication time so
tiered captive-portal plans honor their own duration instead of the global
default. 0 / NULL = unlimited.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa


revision: str = "007_client_session_minutes"
down_revision: Union[str, None] = "006_dns_entries"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    conn = op.get_bind()
    cols = [c["name"] for c in inspect(conn).get_columns(table)]
    return column in cols


def upgrade() -> None:
    if not _has_column("clients", "session_minutes"):
        op.add_column(
            "clients",
            sa.Column("session_minutes", sa.Integer, nullable=True),
        )


def downgrade() -> None:
    if _has_column("clients", "session_minutes"):
        with op.batch_alter_table("clients") as batch:
            batch.drop_column("session_minutes")
