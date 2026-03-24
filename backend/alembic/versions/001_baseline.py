"""baseline schema

Revision ID: 001_baseline
Revises: 
Create Date: 2026-03-24

Captures the existing JetLag database schema as the starting point for
all future migrations.  Running this on an already-populated database
is safe — each table creation is guarded by IF NOT EXISTS.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── clients ───────────────────────────────────────────────────
    op.create_table(
        "clients",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("mac_address", sa.String(17), unique=True, index=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("hostname", sa.String(255), nullable=True),
        sa.Column("vlan_id", sa.Integer, nullable=True),
        sa.Column("auth_state", sa.String(15), default="pending"),
        sa.Column("first_seen", sa.DateTime),
        sa.Column("last_seen", sa.DateTime),
        sa.Column("authenticated_at", sa.DateTime, nullable=True),
        if_not_exists=True,
    )

    # ── impairment_profiles ───────────────────────────────────────
    op.create_table(
        "impairment_profiles",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255), unique=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("enabled", sa.Boolean, default=False),
        sa.Column("direction", sa.String(10), default="outbound"),
        sa.Column("latency_ms", sa.Integer, default=0),
        sa.Column("jitter_ms", sa.Integer, default=0),
        sa.Column("latency_correlation", sa.Float, default=0.0),
        sa.Column("latency_distribution", sa.String(20), default=""),
        sa.Column("packet_loss_percent", sa.Float, default=0.0),
        sa.Column("loss_correlation", sa.Float, default=0.0),
        sa.Column("corruption_percent", sa.Float, default=0.0),
        sa.Column("corruption_correlation", sa.Float, default=0.0),
        sa.Column("reorder_percent", sa.Float, default=0.0),
        sa.Column("reorder_correlation", sa.Float, default=0.0),
        sa.Column("duplicate_percent", sa.Float, default=0.0),
        sa.Column("duplicate_correlation", sa.Float, default=0.0),
        sa.Column("bandwidth_limit_kbps", sa.Integer, default=0),
        sa.Column("bandwidth_burst_kbytes", sa.Integer, default=0),
        sa.Column("bandwidth_ceil_kbps", sa.Integer, default=0),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
        if_not_exists=True,
    )

    # ── match_rules ───────────────────────────────────────────────
    op.create_table(
        "match_rules",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.Integer,
            sa.ForeignKey("impairment_profiles.id", ondelete="CASCADE"),
        ),
        sa.Column("src_ip", sa.String(45), nullable=True),
        sa.Column("dst_ip", sa.String(45), nullable=True),
        sa.Column("src_subnet", sa.String(49), nullable=True),
        sa.Column("dst_subnet", sa.String(49), nullable=True),
        sa.Column("mac_address", sa.String(17), nullable=True),
        sa.Column("vlan_id", sa.Integer, nullable=True),
        sa.Column("protocol", sa.String(10), nullable=True),
        sa.Column("port", sa.Integer, nullable=True),
        if_not_exists=True,
    )

    # ── captures ──────────────────────────────────────────────────
    op.create_table(
        "captures",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255)),
        sa.Column("state", sa.String(10), default="running"),
        sa.Column("file_path", sa.String(512)),
        sa.Column("file_size_bytes", sa.BigInteger, default=0),
        sa.Column("filter_ip", sa.String(45), nullable=True),
        sa.Column("filter_mac", sa.String(17), nullable=True),
        sa.Column("filter_vlan", sa.Integer, nullable=True),
        sa.Column("filter_expression", sa.String(512), nullable=True),
        sa.Column("pid", sa.Integer, nullable=True),
        sa.Column("started_at", sa.DateTime),
        sa.Column("stopped_at", sa.DateTime, nullable=True),
        if_not_exists=True,
    )

    # ── event_logs ────────────────────────────────────────────────
    op.create_table(
        "event_logs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("category", sa.String(15)),
        sa.Column("level", sa.String(10), default="INFO"),
        sa.Column("message", sa.Text),
        sa.Column("source_ip", sa.String(45), nullable=True),
        sa.Column("source_mac", sa.String(17), nullable=True),
        sa.Column("details", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, index=True),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_table("event_logs")
    op.drop_table("captures")
    op.drop_table("match_rules")
    op.drop_table("impairment_profiles")
    op.drop_table("clients")
