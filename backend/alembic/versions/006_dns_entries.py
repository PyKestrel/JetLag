"""add dns_entries table

Revision ID: 006_dns_entries
Revises: 005_replay_history
Create Date: 2026-05-06

Adds dns_entries table for custom DNS records managed via dnsmasq.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa


revision: str = "006_dns_entries"
down_revision: Union[str, None] = "005_replay_history"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(name: str) -> bool:
    conn = op.get_bind()
    return name in inspect(conn).get_table_names()


def upgrade() -> None:
    if not _table_exists("dns_entries"):
        op.create_table(
            "dns_entries",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("hostname", sa.String(255)),
            sa.Column("ip_address", sa.String(45)),
            sa.Column("enabled", sa.Boolean, default=True),
            sa.Column("comment", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime),
        )


def downgrade() -> None:
    op.drop_table("dns_entries")
