import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class DnsEntry(Base):
    __tablename__ = "dns_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hostname: Mapped[str] = mapped_column(String(255))          # e.g. myserver.local
    ip_address: Mapped[str] = mapped_column(String(45))         # IPv4 or IPv6
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    comment: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
