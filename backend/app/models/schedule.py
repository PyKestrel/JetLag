import datetime

from sqlalchemy import String, Integer, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Schedule(Base):
    """A scheduled automation that enables/disables a profile or starts/stops a replay.

    Triggers are either one-shot (``trigger_type='once'`` + ``run_at``) or
    recurring (``trigger_type='recurring'`` + ``days_of_week`` + ``time_of_day``).
    Times are interpreted in the appliance's local timezone.
    """

    __tablename__ = "schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # enable_profile | disable_profile | start_replay | stop_replay
    action: Mapped[str] = mapped_column(String(20))

    # Targets (profile_id always required; scenario_id required for start_replay)
    profile_id: Mapped[int] = mapped_column(Integer, nullable=True)
    scenario_id: Mapped[int] = mapped_column(Integer, nullable=True)

    # Replay options (only used by start_replay)
    loop: Mapped[bool] = mapped_column(Boolean, default=False)
    playback_speed: Mapped[float] = mapped_column(default=1.0)

    # Trigger
    trigger_type: Mapped[str] = mapped_column(String(10), default="once")  # once | recurring
    run_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=True)
    # Comma-separated weekday ints (0=Mon .. 6=Sun) for recurring schedules
    days_of_week: Mapped[str] = mapped_column(String(20), nullable=True)
    time_of_day: Mapped[str] = mapped_column(String(5), nullable=True)  # "HH:MM"

    last_run: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )
