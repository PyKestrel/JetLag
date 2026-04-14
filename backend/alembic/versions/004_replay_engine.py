"""add replay engine tables

Revision ID: 004_replay_engine
Revises: 003_router_mgmt
Create Date: 2026-04-14

Adds replay_scenarios and replay_steps tables for the Replay Engine feature.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa


revision: str = "004_replay_engine"
down_revision: Union[str, None] = "003_router_mgmt"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(name: str) -> bool:
    conn = op.get_bind()
    return name in inspect(conn).get_table_names()


def upgrade() -> None:
    if not _table_exists("replay_scenarios"):
        op.create_table(
            "replay_scenarios",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(255), unique=True),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("default_direction", sa.String(10), default="outbound"),
            sa.Column("total_duration_ms", sa.Integer, default=0),
            sa.Column("step_count", sa.Integer, default=0),
            sa.Column("source_filename", sa.String(255), nullable=True),
            sa.Column("created_at", sa.DateTime),
            sa.Column("updated_at", sa.DateTime),
        )

    if not _table_exists("replay_steps"):
        op.create_table(
            "replay_steps",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column(
                "scenario_id",
                sa.Integer,
                sa.ForeignKey("replay_scenarios.id", ondelete="CASCADE"),
            ),
            sa.Column("step_index", sa.Integer, default=0),
            sa.Column("offset_ms", sa.Integer, default=0),
            sa.Column("duration_ms", sa.Integer, default=1000),
            sa.Column("latency_ms", sa.Integer, default=0),
            sa.Column("jitter_ms", sa.Integer, default=0),
            sa.Column("packet_loss_percent", sa.Float, default=0.0),
            sa.Column("bandwidth_kbps", sa.Integer, default=0),
        )


def downgrade() -> None:
    op.drop_table("replay_steps")
    op.drop_table("replay_scenarios")
