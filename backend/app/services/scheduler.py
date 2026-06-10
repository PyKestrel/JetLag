"""Scheduler service — evaluates Schedule rows and fires their actions.

A single asyncio background loop ticks every ``TICK_SECONDS`` and runs any
schedule that is due. One-shot schedules disable themselves after firing;
recurring schedules fire at most once per matching minute.
"""

import asyncio
import datetime
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import async_session
from app.models.impairment_profile import ImpairmentProfile
from app.models.schedule import Schedule

logger = logging.getLogger("jetlag.scheduler")

TICK_SECONDS = 30

VALID_ACTIONS = {"enable_profile", "disable_profile", "start_replay", "stop_replay"}


def _parse_days(days_of_week: Optional[str]) -> set[int]:
    if not days_of_week:
        return set()
    out: set[int] = set()
    for part in days_of_week.split(","):
        part = part.strip()
        if part.isdigit():
            out.add(int(part))
    return out


def compute_next_run(sched: Schedule, after: Optional[datetime.datetime] = None) -> Optional[datetime.datetime]:
    """Return the next local datetime this schedule should fire, or None."""
    now = after or datetime.datetime.now()
    if not sched.enabled:
        return None
    if sched.trigger_type == "once":
        if sched.run_at and (sched.last_run is None or sched.last_run < sched.run_at):
            return sched.run_at
        return None
    # recurring
    days = _parse_days(sched.days_of_week)
    if not days or not sched.time_of_day:
        return None
    try:
        hh, mm = (int(x) for x in sched.time_of_day.split(":"))
    except (ValueError, AttributeError):
        return None
    for ahead in range(0, 8):
        cand_date = (now + datetime.timedelta(days=ahead)).date()
        if cand_date.weekday() in days:
            cand = datetime.datetime.combine(cand_date, datetime.time(hh, mm))
            if cand >= now.replace(second=0, microsecond=0):
                return cand
    return None


def _is_due(sched: Schedule, now: datetime.datetime) -> bool:
    if not sched.enabled or sched.action not in VALID_ACTIONS:
        return False
    if sched.trigger_type == "once":
        if not sched.run_at:
            return False
        if sched.last_run and sched.last_run >= sched.run_at:
            return False
        return now >= sched.run_at
    # recurring — match weekday + HH:MM within this tick, once per minute
    days = _parse_days(sched.days_of_week)
    if now.weekday() not in days or not sched.time_of_day:
        return False
    try:
        hh, mm = (int(x) for x in sched.time_of_day.split(":"))
    except (ValueError, AttributeError):
        return False
    if not (now.hour == hh and now.minute == mm):
        return False
    # Avoid double-firing within the same minute
    if sched.last_run and sched.last_run.replace(second=0, microsecond=0) == now.replace(second=0, microsecond=0):
        return False
    return True


async def execute_schedule(sched: Schedule, db: AsyncSession) -> None:
    """Run a schedule's configured action. Raises on failure."""
    from app.services.impairment import ImpairmentService

    action = sched.action

    if action in ("enable_profile", "disable_profile"):
        if sched.profile_id is None:
            raise ValueError("profile_id is required")
        result = await db.execute(
            select(ImpairmentProfile)
            .options(selectinload(ImpairmentProfile.match_rules))
            .where(ImpairmentProfile.id == sched.profile_id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            raise ValueError(f"Profile {sched.profile_id} not found")
        if action == "enable_profile":
            profile.enabled = True
            await db.flush()
            await ImpairmentService.apply_profile(profile)
        else:
            profile.enabled = False
            await db.flush()
            await ImpairmentService.remove_profile(profile)

    elif action == "start_replay":
        if sched.profile_id is None or sched.scenario_id is None:
            raise ValueError("profile_id and scenario_id are required for start_replay")
        from app.services.replay import ReplayService
        from app.schemas.replay import ReplaySessionStart
        await ReplayService.start_session(
            db,
            ReplaySessionStart(
                profile_id=sched.profile_id,
                scenario_id=sched.scenario_id,
                loop=sched.loop,
                playback_speed=sched.playback_speed or 1.0,
            ),
        )

    elif action == "stop_replay":
        if sched.profile_id is None:
            raise ValueError("profile_id is required for stop_replay")
        from app.services.replay import ReplayService
        await ReplayService.stop_session(sched.profile_id)

    else:
        raise ValueError(f"Unknown action: {action}")


async def _tick() -> None:
    now = datetime.datetime.now()
    async with async_session() as db:
        result = await db.execute(select(Schedule).where(Schedule.enabled == True))  # noqa: E712
        schedules = result.scalars().all()
        for sched in schedules:
            if not _is_due(sched, now):
                continue
            try:
                await execute_schedule(sched, db)
                sched.last_run = now
                if sched.trigger_type == "once":
                    sched.enabled = False
                logger.info(f"Schedule '{sched.name}' fired action {sched.action}")
                try:
                    from app.services.logging_service import LoggingService
                    await LoggingService.log_system_event(
                        db, f"Schedule '{sched.name}' executed: {sched.action}"
                    )
                except Exception:
                    pass
            except Exception as exc:
                logger.error(f"Schedule '{sched.name}' failed: {exc}")
        await db.commit()


async def scheduler_loop() -> None:
    """Long-running background task; start from the app lifespan."""
    logger.info("Scheduler loop started")
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            logger.info("Scheduler loop stopped")
            raise
        except Exception as exc:
            logger.error(f"Scheduler tick error: {exc}")
        await asyncio.sleep(TICK_SECONDS)
