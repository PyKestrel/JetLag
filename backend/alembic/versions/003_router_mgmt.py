"""add router management tables

Revision ID: 003_router_mgmt
Revises: 002_firewall_rules
Create Date: 2026-04-02

Adds dhcp_reservations, static_routes, and nat_rules tables for ISR management.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa


revision: str = "003_router_mgmt"
down_revision: Union[str, None] = "002_firewall_rules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(name: str) -> bool:
    conn = op.get_bind()
    return name in inspect(conn).get_table_names()


def upgrade() -> None:
    if not _table_exists("dhcp_reservations"):
        op.create_table(
            "dhcp_reservations",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("mac_address", sa.String(17), unique=True),
            sa.Column("ip_address", sa.String(45)),
            sa.Column("hostname", sa.String(255), nullable=True),
            sa.Column("comment", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime),
        )

    if not _table_exists("static_routes"):
        op.create_table(
            "static_routes",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("destination", sa.String(49)),
            sa.Column("gateway", sa.String(45), nullable=True),
            sa.Column("interface", sa.String(20), nullable=True),
            sa.Column("metric", sa.Integer, default=100),
            sa.Column("enabled", sa.Boolean, default=True),
            sa.Column("comment", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime),
        )

    if not _table_exists("nat_rules"):
        op.create_table(
            "nat_rules",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(255)),
            sa.Column("type", sa.String(12), default="masquerade"),
            sa.Column("protocol", sa.String(10), default="any"),
            sa.Column("src_ip", sa.String(49), nullable=True),
            sa.Column("dst_ip", sa.String(49), nullable=True),
            sa.Column("src_port", sa.String(100), nullable=True),
            sa.Column("dst_port", sa.String(100), nullable=True),
            sa.Column("to_address", sa.String(49), nullable=True),
            sa.Column("to_port", sa.String(100), nullable=True),
            sa.Column("interface", sa.String(20), nullable=True),
            sa.Column("enabled", sa.Boolean, default=True),
            sa.Column("comment", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime),
        )


def downgrade() -> None:
    op.drop_table("nat_rules")
    op.drop_table("static_routes")
    op.drop_table("dhcp_reservations")
