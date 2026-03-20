import datetime
from sqlalchemy import String, Integer, DateTime, Enum as SAEnum, BigInteger
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import enum


class CaptureState(str, enum.Enum):
    RUNNING = "running"
    STOPPED = "stopped"
    ERROR = "error"


class Capture(Base):
    __tablename__ = "captures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    state: Mapped[str] = mapped_column(
        SAEnum(CaptureState), default=CaptureState.RUNNING
    )
    file_path: Mapped[str] = mapped_column(String(512))
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)

    # Filter criteria
    filter_ip: Mapped[str] = mapped_column(String(45), nullable=True)
    filter_mac: Mapped[str] = mapped_column(String(17), nullable=True)
    filter_vlan: Mapped[int] = mapped_column(Integer, nullable=True)
    filter_expression: Mapped[str] = mapped_column(String(512), nullable=True)

    pid: Mapped[int] = mapped_column(Integer, nullable=True)

    started_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    stopped_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=True)
