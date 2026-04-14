"""add replay_history table

Revision ID: 005_replay_history
Revises: 004_replay_engine
Create Date: 2026-04-14

Adds replay_history table for tracking past replay sessions.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa


revision: str = "005_replay_history"
down_revision: Union[str, None] = "004_replay_engine"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, name: str) -> bool:
    insp = inspect(bind)
    return name in insp.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "replay_history"):
        op.create_table(
            "replay_history",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("profile_id", sa.Integer, nullable=False, index=True),
            sa.Column("profile_name", sa.String(255), server_default=""),
            sa.Column("scenario_id", sa.Integer, nullable=False),
            sa.Column("scenario_name", sa.String(255), server_default=""),
            sa.Column("state", sa.String(20), server_default="completed"),
            sa.Column("steps_played", sa.Integer, server_default="0"),
            sa.Column("total_steps", sa.Integer, server_default="0"),
            sa.Column("elapsed_ms", sa.Integer, server_default="0"),
            sa.Column("total_ms", sa.Integer, server_default="0"),
            sa.Column("loop_count", sa.Integer, server_default="0"),
            sa.Column("playback_speed", sa.Float, server_default="1.0"),
            sa.Column("started_at", sa.DateTime, server_default=sa.func.now()),
            sa.Column("ended_at", sa.DateTime, nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "replay_history"):
        op.drop_table("replay_history")
