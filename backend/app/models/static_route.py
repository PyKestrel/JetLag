import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class StaticRoute(Base):
    __tablename__ = "static_routes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    destination: Mapped[str] = mapped_column(String(49))        # e.g. 10.0.0.0/24
    gateway: Mapped[str] = mapped_column(String(45), nullable=True)
    interface: Mapped[str] = mapped_column(String(20), nullable=True)
    metric: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    comment: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
