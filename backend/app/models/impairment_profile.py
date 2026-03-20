import datetime
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ImpairmentProfile(Base):
    __tablename__ = "impairment_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)

    # ── Latency / Jitter ──
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    jitter_ms: Mapped[int] = mapped_column(Integer, default=0)
    latency_correlation: Mapped[float] = mapped_column(Float, default=0.0)
    latency_distribution: Mapped[str] = mapped_column(String(20), default="")

    # ── Packet Loss ──
    packet_loss_percent: Mapped[float] = mapped_column(Float, default=0.0)
    loss_correlation: Mapped[float] = mapped_column(Float, default=0.0)

    # ── Packet Corruption ──
    corruption_percent: Mapped[float] = mapped_column(Float, default=0.0)
    corruption_correlation: Mapped[float] = mapped_column(Float, default=0.0)

    # ── Packet Reordering ──
    reorder_percent: Mapped[float] = mapped_column(Float, default=0.0)
    reorder_correlation: Mapped[float] = mapped_column(Float, default=0.0)

    # ── Packet Duplication ──
    duplicate_percent: Mapped[float] = mapped_column(Float, default=0.0)
    duplicate_correlation: Mapped[float] = mapped_column(Float, default=0.0)

    # ── Rate Control ──
    bandwidth_limit_kbps: Mapped[int] = mapped_column(Integer, default=0)
    bandwidth_burst_kbytes: Mapped[int] = mapped_column(Integer, default=0)
    bandwidth_ceil_kbps: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    match_rules: Mapped[list["MatchRule"]] = relationship(
        back_populates="profile", cascade="all, delete-orphan"
    )


class MatchRule(Base):
    __tablename__ = "match_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("impairment_profiles.id", ondelete="CASCADE")
    )

    # Match criteria
    src_ip: Mapped[str] = mapped_column(String(45), nullable=True)
    dst_ip: Mapped[str] = mapped_column(String(45), nullable=True)
    src_subnet: Mapped[str] = mapped_column(String(49), nullable=True)
    dst_subnet: Mapped[str] = mapped_column(String(49), nullable=True)
    mac_address: Mapped[str] = mapped_column(String(17), nullable=True)
    vlan_id: Mapped[int] = mapped_column(Integer, nullable=True)
    protocol: Mapped[str] = mapped_column(String(10), nullable=True)  # tcp, udp, icmp
    port: Mapped[int] = mapped_column(Integer, nullable=True)

    profile: Mapped["ImpairmentProfile"] = relationship(back_populates="match_rules")
