import datetime
from sqlalchemy import String, Integer, DateTime, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import enum


class EventCategory(str, enum.Enum):
    DHCP = "dhcp"
    DNS = "dns"
    AUTH = "auth"
    FIREWALL = "firewall"
    IMPAIRMENT = "impairment"
    CAPTURE = "capture"
    SYSTEM = "system"


class EventLog(Base):
    __tablename__ = "event_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(SAEnum(EventCategory))
    level: Mapped[str] = mapped_column(String(10), default="INFO")
    message: Mapped[str] = mapped_column(Text)
    source_ip: Mapped[str] = mapped_column(String(45), nullable=True)
    source_mac: Mapped[str] = mapped_column(String(17), nullable=True)
    details: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, index=True
    )
