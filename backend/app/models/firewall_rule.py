import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class FirewallRule(Base):
    __tablename__ = "firewall_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=100)

    # Direction: inbound, outbound, forward
    direction: Mapped[str] = mapped_column(String(10), default="forward")

    # Action: accept, drop, reject
    action: Mapped[str] = mapped_column(String(10), default="drop")

    # Protocol: tcp, udp, icmp, any
    protocol: Mapped[str] = mapped_column(String(10), default="any")

    # Match criteria
    src_ip: Mapped[str] = mapped_column(String(49), nullable=True)
    dst_ip: Mapped[str] = mapped_column(String(49), nullable=True)
    src_port: Mapped[str] = mapped_column(String(100), nullable=True)   # single port or range "1000-2000"
    dst_port: Mapped[str] = mapped_column(String(100), nullable=True)   # single port or range "1000-2000"

    comment: Mapped[str] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )
