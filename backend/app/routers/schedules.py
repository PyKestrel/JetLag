"""Schedule CRUD + manual trigger endpoints."""

import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.schedule import Schedule
from app.services.scheduler import VALID_ACTIONS, compute_next_run, execute_schedule

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


# ── Schemas ──────────────────────────────────────────────────────

class ScheduleBase(BaseModel):
    name: str
    enabled: bool = True
    action: str
    profile_id: Optional[int] = None
    scenario_id: Optional[int] = None
    loop: bool = False
    playback_speed: float = 1.0
    trigger_type: str = "once"  # once | recurring
    run_at: Optional[datetime.datetime] = None
    days_of_week: Optional[str] = None  # "0,1,2"
    time_of_day: Optional[str] = None   # "HH:MM"


class ScheduleCreate(ScheduleBase):
    pass


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    action: Optional[str] = None
    profile_id: Optional[int] = None
    scenario_id: Optional[int] = None
    loop: Optional[bool] = None
    playback_speed: Optional[float] = None
    trigger_type: Optional[str] = None
    run_at: Optional[datetime.datetime] = None
    days_of_week: Optional[str] = None
    time_of_day: Optional[str] = None


def _validate(payload: ScheduleBase) -> None:
    if payload.action not in VALID_ACTIONS:
        raise HTTPException(422, f"Invalid action. Must be one of: {sorted(VALID_ACTIONS)}")
    if payload.action == "start_replay" and payload.scenario_id is None:
        raise HTTPException(422, "scenario_id is required for start_replay")
    if payload.profile_id is None:
        raise HTTPException(422, "profile_id is required")
    if payload.trigger_type == "once":
        if payload.run_at is None:
            raise HTTPException(422, "run_at is required for a one-shot schedule")
    elif payload.trigger_type == "recurring":
        if not payload.days_of_week or not payload.time_of_day:
            raise HTTPException(422, "days_of_week and time_of_day are required for recurring schedules")
    else:
        raise HTTPException(422, "trigger_type must be 'once' or 'recurring'")


def _serialize(s: Schedule) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "enabled": s.enabled,
        "action": s.action,
        "profile_id": s.profile_id,
        "scenario_id": s.scenario_id,
        "loop": s.loop,
        "playback_speed": s.playback_speed,
        "trigger_type": s.trigger_type,
        "run_at": s.run_at,
        "days_of_week": s.days_of_week,
        "time_of_day": s.time_of_day,
        "last_run": s.last_run,
        "next_run": compute_next_run(s),
        "created_at": s.created_at,
    }


# ── Endpoints ────────────────────────────────────────────────────

@router.get("")
async def list_schedules(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Schedule).order_by(Schedule.id.desc()))
    return {"items": [_serialize(s) for s in result.scalars().all()]}


@router.post("")
async def create_schedule(payload: ScheduleCreate, db: AsyncSession = Depends(get_db)):
    _validate(payload)
    sched = Schedule(**payload.model_dump())
    db.add(sched)
    await db.flush()
    return _serialize(sched)


@router.put("/{schedule_id}")
async def update_schedule(schedule_id: int, payload: ScheduleUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Schedule).where(Schedule.id == schedule_id))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(404, "Schedule not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(sched, field, value)
    # Re-validate the merged result
    _validate(ScheduleBase.model_validate(_serialize(sched)))
    await db.flush()
    return _serialize(sched)


@router.delete("/{schedule_id}")
async def delete_schedule(schedule_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Schedule).where(Schedule.id == schedule_id))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(404, "Schedule not found")
    await db.delete(sched)
    return {"message": "Schedule deleted"}


@router.post("/{schedule_id}/run")
async def run_schedule_now(schedule_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Schedule).where(Schedule.id == schedule_id))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(404, "Schedule not found")
    try:
        await execute_schedule(sched, db)
        sched.last_run = datetime.datetime.now()
        await db.flush()
    except Exception as exc:
        raise HTTPException(400, f"Failed to run schedule: {exc}") from exc
    return {"message": f"Schedule '{sched.name}' executed", "action": sched.action}
