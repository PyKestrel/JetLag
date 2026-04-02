import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class NatRule(Base):
    __tablename__ = "nat_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    # Type: snat, dnat, masquerade
    type: Mapped[str] = mapped_column(String(12), default="masquerade")
    protocol: Mapped[str] = mapped_column(String(10), default="any")  # tcp, udp, any
    src_ip: Mapped[str] = mapped_column(String(49), nullable=True)
    dst_ip: Mapped[str] = mapped_column(String(49), nullable=True)
    src_port: Mapped[str] = mapped_column(String(100), nullable=True)
    dst_port: Mapped[str] = mapped_column(String(100), nullable=True)
    to_address: Mapped[str] = mapped_column(String(49), nullable=True)   # translated address
    to_port: Mapped[str] = mapped_column(String(100), nullable=True)     # translated port
    interface: Mapped[str] = mapped_column(String(20), nullable=True)    # outbound interface
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    comment: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
