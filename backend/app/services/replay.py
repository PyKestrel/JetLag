"""Replay Engine — manages replay sessions that apply time-varying impairments."""

import asyncio
import datetime
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.impairment_profile import ImpairmentProfile
from app.models.replay import ReplayHistory, ReplayScenario, ReplayStep
from app.schemas.replay import ReplaySessionStart, ReplaySessionStatus
from app.services.impairment import ImpairmentService

logger = logging.getLogger("jetlag.replay")

# Impairment fields the replay engine controls
_REPLAY_FIELDS = ("latency_ms", "jitter_ms", "packet_loss_percent", "bandwidth_limit_kbps")
# Mapping from step field names → profile field names
_STEP_TO_PROFILE = {
    "latency_ms": "latency_ms",
    "jitter_ms": "jitter_ms",
    "packet_loss_percent": "packet_loss_percent",
    "bandwidth_kbps": "bandwidth_limit_kbps",
}


@dataclass
class ReplaySession:
    """In-memory state for a running replay."""
    profile_id: int
    scenario_id: int
    loop: bool = False
    playback_speed: float = 1.0
    state: str = "idle"  # idle, running, paused, completed, stopped
    current_step_index: int = 0
    total_steps: int = 0
    total_ms: int = 0
    elapsed_ms: int = 0
    loop_count: int = 0
    start_time: float = 0.0
    snapshot: Optional[dict] = None
    task: Optional[asyncio.Task] = None
    pause_event: asyncio.Event = field(default_factory=asyncio.Event)
    current_values: Optional[dict] = None

    def __post_init__(self):
        self.pause_event.set()  # not paused by default


class ReplayService:
    """Manages replay sessions — one per profile at a time."""

    _active_sessions: dict[int, ReplaySession] = {}

    @classmethod
    async def start_session(
        cls,
        db: AsyncSession,
        data: ReplaySessionStart,
    ) -> ReplaySessionStatus:
        """Start a replay session on a profile."""
        profile_id = data.profile_id
        scenario_id = data.scenario_id

        # Check for existing session
        if profile_id in cls._active_sessions:
            existing = cls._active_sessions[profile_id]
            if existing.state in ("running", "paused"):
                raise ValueError(f"Profile {profile_id} already has an active replay session")

        # Load the profile
        result = await db.execute(
            select(ImpairmentProfile)
            .options(selectinload(ImpairmentProfile.match_rules))
            .where(ImpairmentProfile.id == profile_id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            raise ValueError(f"Profile {profile_id} not found")

        # Load the scenario with steps
        result = await db.execute(
            select(ReplayScenario)
            .options(selectinload(ReplayScenario.steps))
            .where(ReplayScenario.id == scenario_id)
        )
        scenario = result.scalar_one_or_none()
        if not scenario:
            raise ValueError(f"Scenario {scenario_id} not found")

        if not scenario.steps:
            raise ValueError("Scenario has no steps")

        # Filter steps by offset range if specified
        steps = sorted(scenario.steps, key=lambda s: s.step_index)
        if data.start_offset_ms is not None:
            steps = [s for s in steps if s.offset_ms >= data.start_offset_ms]
        if data.end_offset_ms is not None:
            steps = [s for s in steps if s.offset_ms < data.end_offset_ms]
        if not steps:
            raise ValueError("No steps within the specified offset range")

        # Take a snapshot of the profile's current impairment values
        snapshot = {
            "latency_ms": profile.latency_ms,
            "jitter_ms": profile.jitter_ms,
            "packet_loss_percent": profile.packet_loss_percent,
            "bandwidth_limit_kbps": profile.bandwidth_limit_kbps,
        }

        # Enable the profile if not already enabled
        if not profile.enabled:
            profile.enabled = True
            await db.flush()

        # Compute total duration for the selected steps
        total_ms = 0
        if steps:
            first = steps[0]
            last = steps[-1]
            total_ms = (last.offset_ms + last.duration_ms) - first.offset_ms

        # Create session
        session = ReplaySession(
            profile_id=profile_id,
            scenario_id=scenario_id,
            loop=data.loop,
            playback_speed=data.playback_speed,
            state="running",
            current_step_index=0,
            total_steps=len(steps),
            total_ms=total_ms,
            elapsed_ms=0,
            loop_count=0,
            start_time=time.monotonic(),
            snapshot=snapshot,
        )
        cls._active_sessions[profile_id] = session

        # Serialise steps for the background task (avoid lazy-load issues)
        steps_data = [
            {
                "step_index": s.step_index,
                "offset_ms": s.offset_ms,
                "duration_ms": s.duration_ms,
                "latency_ms": s.latency_ms,
                "jitter_ms": s.jitter_ms,
                "packet_loss_percent": s.packet_loss_percent,
                "bandwidth_kbps": s.bandwidth_kbps,
            }
            for s in steps
        ]

        # Spawn the background task
        session.task = asyncio.create_task(
            cls._replay_loop(profile_id, steps_data, session)
        )

        logger.info(
            f"Replay started on profile {profile_id} with scenario {scenario_id} "
            f"({len(steps)} steps, {total_ms}ms, speed={data.playback_speed}x, loop={data.loop})"
        )

        return cls.get_status(profile_id)

    @classmethod
    async def _replay_loop(
        cls,
        profile_id: int,
        steps: list[dict],
        session: ReplaySession,
    ):
        """Background task that iterates through replay steps."""
        from app.database import async_session

        try:
            while True:
                session.start_time = time.monotonic()
                session.elapsed_ms = 0

                for i, step in enumerate(steps):
                    # Check for cancellation
                    if session.state == "stopped":
                        return

                    # Wait if paused
                    await session.pause_event.wait()

                    if session.state == "stopped":
                        return

                    session.current_step_index = i
                    session.current_values = {
                        "latency_ms": step["latency_ms"],
                        "jitter_ms": step["jitter_ms"],
                        "packet_loss_percent": step["packet_loss_percent"],
                        "bandwidth_kbps": step["bandwidth_kbps"],
                    }

                    # Apply this step's values to the profile
                    async with async_session() as db:
                        result = await db.execute(
                            select(ImpairmentProfile)
                            .options(selectinload(ImpairmentProfile.match_rules))
                            .where(ImpairmentProfile.id == profile_id)
                        )
                        profile = result.scalar_one_or_none()
                        if not profile:
                            logger.error(f"Profile {profile_id} disappeared during replay")
                            session.state = "stopped"
                            return

                        # Update the 4 replay fields
                        profile.latency_ms = step["latency_ms"]
                        profile.jitter_ms = step["jitter_ms"]
                        profile.packet_loss_percent = step["packet_loss_percent"]
                        profile.bandwidth_limit_kbps = step["bandwidth_kbps"]

                        await db.flush()
                        await db.commit()

                        # Apply tc/netem rules
                        await ImpairmentService.apply_profile(profile)

                    logger.debug(
                        f"Replay step {i}/{len(steps)} on profile {profile_id}: "
                        f"latency={step['latency_ms']}ms jitter={step['jitter_ms']}ms "
                        f"loss={step['packet_loss_percent']}% bw={step['bandwidth_kbps']}kbps"
                    )

                    # Sleep for the step duration (scaled by playback speed)
                    sleep_s = (step["duration_ms"] / 1000.0) / session.playback_speed
                    await asyncio.sleep(sleep_s)

                    # Update elapsed time
                    session.elapsed_ms = int((time.monotonic() - session.start_time) * 1000)

                # End of steps
                if session.loop:
                    session.loop_count += 1
                    logger.info(f"Replay loop {session.loop_count} completed on profile {profile_id}")
                    continue
                else:
                    session.state = "completed"
                    await cls._record_history(session)
                    logger.info(f"Replay completed on profile {profile_id}")
                    return

        except asyncio.CancelledError:
            session.state = "stopped"
            await cls._record_history(session)
            logger.info(f"Replay cancelled on profile {profile_id}")
        except Exception as exc:
            session.state = "stopped"
            await cls._record_history(session)
            logger.error(f"Replay error on profile {profile_id}: {exc}")

    @classmethod
    async def _record_history(cls, session: ReplaySession):
        """Persist a finished/stopped session to the replay_history table."""
        from app.database import async_session
        try:
            async with async_session() as db:
                # Resolve names
                profile_name, scenario_name = "", ""
                p_res = await db.execute(
                    select(ImpairmentProfile).where(ImpairmentProfile.id == session.profile_id)
                )
                p = p_res.scalar_one_or_none()
                if p:
                    profile_name = p.name
                s_res = await db.execute(
                    select(ReplayScenario).where(ReplayScenario.id == session.scenario_id)
                )
                s = s_res.scalar_one_or_none()
                if s:
                    scenario_name = s.name

                entry = ReplayHistory(
                    profile_id=session.profile_id,
                    profile_name=profile_name,
                    scenario_id=session.scenario_id,
                    scenario_name=scenario_name,
                    state=session.state,
                    steps_played=session.current_step_index + 1,
                    total_steps=session.total_steps,
                    elapsed_ms=session.elapsed_ms,
                    total_ms=session.total_ms,
                    loop_count=session.loop_count,
                    playback_speed=session.playback_speed,
                    ended_at=datetime.datetime.utcnow(),
                )
                db.add(entry)
                await db.commit()
        except Exception as exc:
            logger.warning(f"Failed to record replay history: {exc}")

    @classmethod
    async def stop_session(cls, profile_id: int) -> ReplaySessionStatus:
        """Stop an active replay session."""
        session = cls._active_sessions.get(profile_id)
        if not session or session.state not in ("running", "paused"):
            return cls.get_status(profile_id)

        session.state = "stopped"
        session.pause_event.set()  # unblock if paused
        if session.task and not session.task.done():
            session.task.cancel()
            try:
                await session.task
            except (asyncio.CancelledError, Exception):
                pass

        logger.info(f"Replay stopped on profile {profile_id}")
        return cls.get_status(profile_id)

    @classmethod
    async def pause_session(cls, profile_id: int) -> ReplaySessionStatus:
        """Pause an active replay session."""
        session = cls._active_sessions.get(profile_id)
        if not session or session.state != "running":
            return cls.get_status(profile_id)

        session.state = "paused"
        session.pause_event.clear()
        logger.info(f"Replay paused on profile {profile_id}")
        return cls.get_status(profile_id)

    @classmethod
    async def resume_session(cls, profile_id: int) -> ReplaySessionStatus:
        """Resume a paused replay session."""
        session = cls._active_sessions.get(profile_id)
        if not session or session.state != "paused":
            return cls.get_status(profile_id)

        session.state = "running"
        session.pause_event.set()
        logger.info(f"Replay resumed on profile {profile_id}")
        return cls.get_status(profile_id)

    @classmethod
    def get_status(cls, profile_id: int) -> ReplaySessionStatus:
        """Get the current status of a replay session."""
        session = cls._active_sessions.get(profile_id)
        if not session:
            return ReplaySessionStatus(profile_id=profile_id, state="idle")

        # Update elapsed if running
        if session.state == "running":
            session.elapsed_ms = int((time.monotonic() - session.start_time) * 1000)

        return ReplaySessionStatus(
            profile_id=profile_id,
            scenario_id=session.scenario_id,
            state=session.state,
            current_step_index=session.current_step_index,
            total_steps=session.total_steps,
            elapsed_ms=session.elapsed_ms,
            total_ms=session.total_ms,
            loop=session.loop,
            loop_count=session.loop_count,
            playback_speed=session.playback_speed,
            current_values=session.current_values,
            has_snapshot=session.snapshot is not None,
        )

    @classmethod
    async def revert_profile(cls, db: AsyncSession, profile_id: int) -> dict:
        """Revert a profile to its pre-replay snapshot values."""
        session = cls._active_sessions.get(profile_id)
        if not session or not session.snapshot:
            raise ValueError("No replay snapshot found for this profile")

        # Stop the session first if still active
        if session.state in ("running", "paused"):
            await cls.stop_session(profile_id)

        # Restore snapshot values
        result = await db.execute(
            select(ImpairmentProfile)
            .options(selectinload(ImpairmentProfile.match_rules))
            .where(ImpairmentProfile.id == profile_id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            raise ValueError(f"Profile {profile_id} not found")

        snapshot = session.snapshot
        profile.latency_ms = snapshot["latency_ms"]
        profile.jitter_ms = snapshot["jitter_ms"]
        profile.packet_loss_percent = snapshot["packet_loss_percent"]
        profile.bandwidth_limit_kbps = snapshot["bandwidth_limit_kbps"]

        await db.flush()
        await db.commit()

        # Re-apply the reverted profile
        if profile.enabled:
            await ImpairmentService.apply_profile(profile)

        # Clean up session
        del cls._active_sessions[profile_id]

        logger.info(f"Profile {profile_id} reverted to pre-replay values")
        return {"message": f"Profile reverted to static values", "profile_id": profile_id}
