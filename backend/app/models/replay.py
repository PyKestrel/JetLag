import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ReplayScenario(Base):
    __tablename__ = "replay_scenarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    default_direction: Mapped[str] = mapped_column(String(10), default="outbound")
    total_duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    step_count: Mapped[int] = mapped_column(Integer, default=0)
    source_filename: Mapped[str] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    steps: Mapped[list["ReplayStep"]] = relationship(
        back_populates="scenario", cascade="all, delete-orphan",
        order_by="ReplayStep.step_index",
    )


class ReplayStep(Base):
    __tablename__ = "replay_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scenario_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("replay_scenarios.id", ondelete="CASCADE")
    )
    step_index: Mapped[int] = mapped_column(Integer, default=0)
    offset_ms: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=1000)

    # Four capturable impairment fields
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    jitter_ms: Mapped[int] = mapped_column(Integer, default=0)
    packet_loss_percent: Mapped[float] = mapped_column(Float, default=0.0)
    bandwidth_kbps: Mapped[int] = mapped_column(Integer, default=0)

    scenario: Mapped["ReplayScenario"] = relationship(back_populates="steps")


class ReplayHistory(Base):
    __tablename__ = "replay_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(Integer, index=True)
    profile_name: Mapped[str] = mapped_column(String(255), default="")
    scenario_id: Mapped[int] = mapped_column(Integer)
    scenario_name: Mapped[str] = mapped_column(String(255), default="")
    state: Mapped[str] = mapped_column(String(20), default="completed")
    steps_played: Mapped[int] = mapped_column(Integer, default=0)
    total_steps: Mapped[int] = mapped_column(Integer, default=0)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    total_ms: Mapped[int] = mapped_column(Integer, default=0)
    loop_count: Mapped[int] = mapped_column(Integer, default=0)
    playback_speed: Mapped[float] = mapped_column(Float, default=1.0)

    started_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
    ended_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=True
    )
