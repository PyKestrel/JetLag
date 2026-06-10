"""add schedules table

Revision ID: 009_schedules
Revises: 008_users
Create Date: 2026-06-10

Scheduled automations for impairment profiles and replay scenarios.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa


revision: str = "009_schedules"
down_revision: Union[str, None] = "008_users"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(name: str) -> bool:
    conn = op.get_bind()
    return name in inspect(conn).get_table_names()


def upgrade() -> None:
    if not _table_exists("schedules"):
        op.create_table(
            "schedules",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("enabled", sa.Boolean, default=True),
            sa.Column("action", sa.String(20), nullable=False),
            sa.Column("profile_id", sa.Integer, nullable=True),
            sa.Column("scenario_id", sa.Integer, nullable=True),
            sa.Column("loop", sa.Boolean, default=False),
            sa.Column("playback_speed", sa.Float, default=1.0),
            sa.Column("trigger_type", sa.String(10), default="once"),
            sa.Column("run_at", sa.DateTime, nullable=True),
            sa.Column("days_of_week", sa.String(20), nullable=True),
            sa.Column("time_of_day", sa.String(5), nullable=True),
            sa.Column("last_run", sa.DateTime, nullable=True),
            sa.Column("created_at", sa.DateTime),
        )


def downgrade() -> None:
    op.drop_table("schedules")
