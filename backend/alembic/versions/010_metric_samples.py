"""add metric_samples table

Revision ID: 010_metric_samples
Revises: 009_schedules
Create Date: 2026-06-10

Persisted aggregate-throughput samples for historical metrics charts.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa


revision: str = "010_metric_samples"
down_revision: Union[str, None] = "009_schedules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(name: str) -> bool:
    conn = op.get_bind()
    return name in inspect(conn).get_table_names()


def upgrade() -> None:
    if not _table_exists("metric_samples"):
        op.create_table(
            "metric_samples",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("ts", sa.DateTime, nullable=False),
            sa.Column("rx_bps", sa.Integer, default=0),
            sa.Column("tx_bps", sa.Integer, default=0),
        )
        op.create_index("ix_metric_samples_ts", "metric_samples", ["ts"])


def downgrade() -> None:
    op.drop_index("ix_metric_samples_ts", table_name="metric_samples")
    op.drop_table("metric_samples")
