import datetime
from sqlalchemy import String, Integer, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import enum


class AuthState(str, enum.Enum):
    PENDING = "pending"
    AUTHENTICATED = "authenticated"


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mac_address: Mapped[str] = mapped_column(String(17), unique=True, index=True)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=True)
    hostname: Mapped[str] = mapped_column(String(255), nullable=True)
    vlan_id: Mapped[int] = mapped_column(Integer, nullable=True)
    auth_state: Mapped[str] = mapped_column(
        SAEnum(AuthState), default=AuthState.PENDING
    )
    first_seen: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    last_seen: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )
    authenticated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=True
    )
