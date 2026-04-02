"""add firewall_rules table

Revision ID: 002_firewall_rules
Revises: 001_baseline
Create Date: 2026-04-02

Adds user-defined firewall rules that are injected into nftables custom chains.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa


revision: str = "002_firewall_rules"
down_revision: Union[str, None] = "001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(name: str) -> bool:
    conn = op.get_bind()
    return name in inspect(conn).get_table_names()


def upgrade() -> None:
    if not _table_exists("firewall_rules"):
        op.create_table(
            "firewall_rules",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(255)),
            sa.Column("enabled", sa.Boolean, default=True),
            sa.Column("priority", sa.Integer, default=100),
            sa.Column("direction", sa.String(10), default="forward"),
            sa.Column("action", sa.String(10), default="drop"),
            sa.Column("protocol", sa.String(10), default="any"),
            sa.Column("src_ip", sa.String(49), nullable=True),
            sa.Column("dst_ip", sa.String(49), nullable=True),
            sa.Column("src_port", sa.String(100), nullable=True),
            sa.Column("dst_port", sa.String(100), nullable=True),
            sa.Column("comment", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime),
            sa.Column("updated_at", sa.DateTime),
        )


def downgrade() -> None:
    op.drop_table("firewall_rules")
