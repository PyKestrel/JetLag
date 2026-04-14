"""Replay Engine — scenario CRUD, import/export, and session control."""

import json
import logging
from io import BytesIO
from typing import Optional

import yaml
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.responses import StreamingResponse

from app.database import get_db
from app.models.replay import ReplayHistory, ReplayScenario, ReplayStep
from app.schemas.replay import (
    ReplayScenarioCreate,
    ReplayScenarioListItem,
    ReplayScenarioResponse,
    ReplayScenarioUpdate,
    ReplaySessionStart,
    ReplaySessionStatus,
)
from app.services.logging_service import LoggingService

logger = logging.getLogger("jetlag.replay")

router = APIRouter(prefix="/api/replay", tags=["replay"])


# ── helpers ─────────────────────────────────────────────────────

def _compute_totals(steps: list[dict]) -> tuple[int, int]:
    """Return (total_duration_ms, step_count) from raw step dicts."""
    if not steps:
        return 0, 0
    last = steps[-1]
    total = last.get("offset_ms", 0) + last.get("duration_ms", 1000)
    return total, len(steps)


def _validate_steps(steps: list[dict]) -> list[dict]:
    """Validate and normalise imported step data."""
    if not steps:
        raise HTTPException(status_code=400, detail="Scenario must have at least one step")

    prev_offset = -1
    cleaned = []
    for i, raw in enumerate(steps):
        offset = int(raw.get("offset_ms", 0))
        duration = int(raw.get("duration_ms", 1000))
        if duration < 1000:
            raise HTTPException(
                status_code=400,
                detail=f"Step {i}: duration_ms must be >= 1000 (got {duration})",
            )
        if offset <= prev_offset and i > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Step {i}: offset_ms must be monotonically increasing (got {offset}, prev was {prev_offset})",
            )
        prev_offset = offset
        cleaned.append({
            "step_index": i,
            "offset_ms": offset,
            "duration_ms": duration,
            "latency_ms": int(raw.get("latency_ms", 0)),
            "jitter_ms": int(raw.get("jitter_ms", 0)),
            "packet_loss_percent": float(raw.get("packet_loss_percent", 0.0)),
            "bandwidth_kbps": int(raw.get("bandwidth_kbps", 0)),
        })
    return cleaned


def _parse_file_content(content: bytes, filename: str) -> dict:
    """Parse JSON or YAML content into a dict."""
    lower = filename.lower()
    try:
        if lower.endswith((".yaml", ".yml")):
            data = yaml.safe_load(content)
        else:
            data = json.loads(content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {exc}")

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="File must contain a JSON/YAML object")
    if "steps" not in data or not isinstance(data["steps"], list):
        raise HTTPException(status_code=400, detail="File must contain a 'steps' array")
    return data


def _scenario_to_export(scenario: ReplayScenario) -> dict:
    """Convert a DB scenario + steps to the export dict format."""
    return {
        "name": scenario.name,
        "description": scenario.description or "",
        "version": 1,
        "default_direction": scenario.default_direction,
        "steps": [
            {
                "offset_ms": s.offset_ms,
                "duration_ms": s.duration_ms,
                "latency_ms": s.latency_ms,
                "jitter_ms": s.jitter_ms,
                "packet_loss_percent": s.packet_loss_percent,
                "bandwidth_kbps": s.bandwidth_kbps,
            }
            for s in sorted(scenario.steps, key=lambda s: s.step_index)
        ],
    }


# ── Scenario CRUD ───────────────────────────────────────────────

@router.post("/scenarios/import", response_model=ReplayScenarioResponse, status_code=201)
async def import_scenario(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a JSON or YAML file and import it as a replay scenario."""
    content = await file.read()
    filename = file.filename or "upload.json"
    data = _parse_file_content(content, filename)

    name = data.get("name", filename.rsplit(".", 1)[0])
    steps_raw = _validate_steps(data["steps"])
    total_duration, step_count = _compute_totals(steps_raw)

    # Check for duplicate name
    existing = await db.execute(
        select(ReplayScenario).where(ReplayScenario.name == name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Scenario with name '{name}' already exists")

    scenario = ReplayScenario(
        name=name,
        description=data.get("description"),
        default_direction=data.get("default_direction", "outbound"),
        total_duration_ms=total_duration,
        step_count=step_count,
        source_filename=filename,
    )
    db.add(scenario)
    await db.flush()

    for step_data in steps_raw:
        step = ReplayStep(scenario_id=scenario.id, **step_data)
        db.add(step)
    await db.flush()

    # Reload with relationships
    result = await db.execute(
        select(ReplayScenario)
        .options(selectinload(ReplayScenario.steps))
        .where(ReplayScenario.id == scenario.id)
    )
    scenario = result.scalar_one()

    await LoggingService.log_impairment_event(
        db, f"Imported replay scenario: {scenario.name} ({step_count} steps, {total_duration}ms)"
    )

    return _serialize_scenario(scenario)


@router.get("/scenarios")
async def list_scenarios(
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List all replay scenarios (paginated)."""
    total_result = await db.execute(select(func.count(ReplayScenario.id)))
    total = total_result.scalar() or 0

    result = await db.execute(
        select(ReplayScenario)
        .order_by(ReplayScenario.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    scenarios = result.scalars().all()

    return {
        "items": [_serialize_scenario_list(s) for s in scenarios],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }


@router.get("/scenarios/{scenario_id}", response_model=ReplayScenarioResponse)
async def get_scenario(scenario_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single scenario with all steps."""
    result = await db.execute(
        select(ReplayScenario)
        .options(selectinload(ReplayScenario.steps))
        .where(ReplayScenario.id == scenario_id)
    )
    scenario = result.scalar_one_or_none()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return _serialize_scenario(scenario)


@router.put("/scenarios/{scenario_id}", response_model=ReplayScenarioResponse)
async def update_scenario(
    scenario_id: int,
    data: ReplayScenarioUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a scenario's metadata and/or steps."""
    result = await db.execute(
        select(ReplayScenario)
        .options(selectinload(ReplayScenario.steps))
        .where(ReplayScenario.id == scenario_id)
    )
    scenario = result.scalar_one_or_none()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    update_data = data.model_dump(exclude_unset=True)
    steps_data = update_data.pop("steps", None)

    for field, value in update_data.items():
        setattr(scenario, field, value)

    if steps_data is not None:
        # Replace all steps
        for step in scenario.steps:
            await db.delete(step)
        await db.flush()

        cleaned = _validate_steps([s.model_dump() if hasattr(s, 'model_dump') else s for s in steps_data])
        total_duration, step_count = _compute_totals(cleaned)
        scenario.total_duration_ms = total_duration
        scenario.step_count = step_count

        for step_data in cleaned:
            step = ReplayStep(scenario_id=scenario.id, **step_data)
            db.add(step)

    await db.flush()

    # Reload
    result = await db.execute(
        select(ReplayScenario)
        .options(selectinload(ReplayScenario.steps))
        .where(ReplayScenario.id == scenario.id)
    )
    scenario = result.scalar_one()

    await LoggingService.log_impairment_event(
        db, f"Updated replay scenario: {scenario.name}"
    )

    return _serialize_scenario(scenario)


@router.delete("/scenarios/{scenario_id}")
async def delete_scenario(scenario_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a scenario and all its steps."""
    result = await db.execute(
        select(ReplayScenario).where(ReplayScenario.id == scenario_id)
    )
    scenario = result.scalar_one_or_none()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    name = scenario.name
    await db.delete(scenario)
    await db.flush()

    await LoggingService.log_impairment_event(db, f"Deleted replay scenario: {name}")

    return {"message": f"Scenario '{name}' deleted"}


@router.get("/scenarios/{scenario_id}/export")
async def export_scenario(
    scenario_id: int,
    format: str = Query("json", regex="^(json|yaml)$"),
    db: AsyncSession = Depends(get_db),
):
    """Export a scenario as a downloadable JSON or YAML file."""
    result = await db.execute(
        select(ReplayScenario)
        .options(selectinload(ReplayScenario.steps))
        .where(ReplayScenario.id == scenario_id)
    )
    scenario = result.scalar_one_or_none()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    export_data = _scenario_to_export(scenario)
    safe_name = scenario.name.replace(" ", "_").lower()

    if format == "yaml":
        content = yaml.dump(export_data, default_flow_style=False, sort_keys=False)
        media_type = "application/x-yaml"
        ext = "yaml"
    else:
        content = json.dumps(export_data, indent=2)
        media_type = "application/json"
        ext = "json"

    return StreamingResponse(
        BytesIO(content.encode()),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.{ext}"'},
    )


# ── Session control endpoints ───────────────────────────────────

@router.post("/sessions/start", response_model=ReplaySessionStatus)
async def start_session(
    data: ReplaySessionStart,
    db: AsyncSession = Depends(get_db),
):
    """Start a replay session on a profile."""
    from app.services.replay import ReplayService
    status = await ReplayService.start_session(db, data)
    return status


@router.post("/sessions/{profile_id}/stop", response_model=ReplaySessionStatus)
async def stop_session(profile_id: int, db: AsyncSession = Depends(get_db)):
    """Stop an active replay session."""
    from app.services.replay import ReplayService
    status = await ReplayService.stop_session(profile_id)
    return status


@router.post("/sessions/{profile_id}/pause", response_model=ReplaySessionStatus)
async def pause_session(profile_id: int, db: AsyncSession = Depends(get_db)):
    """Pause an active replay session."""
    from app.services.replay import ReplayService
    status = await ReplayService.pause_session(profile_id)
    return status


@router.post("/sessions/{profile_id}/resume", response_model=ReplaySessionStatus)
async def resume_session(profile_id: int, db: AsyncSession = Depends(get_db)):
    """Resume a paused replay session."""
    from app.services.replay import ReplayService
    status = await ReplayService.resume_session(profile_id)
    return status


@router.get("/sessions/{profile_id}/status", response_model=ReplaySessionStatus)
async def get_session_status(profile_id: int):
    """Get current replay session status for a profile."""
    from app.services.replay import ReplayService
    return ReplayService.get_status(profile_id)


@router.post("/sessions/{profile_id}/revert")
async def revert_profile(profile_id: int, db: AsyncSession = Depends(get_db)):
    """Revert a profile to its pre-replay snapshot values."""
    from app.services.replay import ReplayService
    result = await ReplayService.revert_profile(db, profile_id)
    return result


# ── History endpoints ──────────────────────────────────────────

@router.get("/history")
async def list_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List past replay sessions (paginated, newest first)."""
    total_result = await db.execute(select(func.count(ReplayHistory.id)))
    total = total_result.scalar() or 0

    result = await db.execute(
        select(ReplayHistory)
        .order_by(ReplayHistory.started_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = result.scalars().all()

    return {
        "items": [
            {
                "id": r.id,
                "profile_id": r.profile_id,
                "profile_name": r.profile_name,
                "scenario_id": r.scenario_id,
                "scenario_name": r.scenario_name,
                "state": r.state,
                "steps_played": r.steps_played,
                "total_steps": r.total_steps,
                "elapsed_ms": r.elapsed_ms,
                "total_ms": r.total_ms,
                "loop_count": r.loop_count,
                "playback_speed": r.playback_speed,
                "started_at": r.started_at.isoformat() if r.started_at else "",
                "ended_at": r.ended_at.isoformat() if r.ended_at else "",
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }


# ── serialisation helpers ───────────────────────────────────────

def _serialize_scenario(s: ReplayScenario) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "default_direction": s.default_direction,
        "total_duration_ms": s.total_duration_ms,
        "step_count": s.step_count,
        "source_filename": s.source_filename,
        "created_at": s.created_at.isoformat() if s.created_at else "",
        "updated_at": s.updated_at.isoformat() if s.updated_at else "",
        "steps": [
            {
                "id": st.id,
                "scenario_id": st.scenario_id,
                "step_index": st.step_index,
                "offset_ms": st.offset_ms,
                "duration_ms": st.duration_ms,
                "latency_ms": st.latency_ms,
                "jitter_ms": st.jitter_ms,
                "packet_loss_percent": st.packet_loss_percent,
                "bandwidth_kbps": st.bandwidth_kbps,
            }
            for st in sorted(s.steps, key=lambda x: x.step_index)
        ],
    }


def _serialize_scenario_list(s: ReplayScenario) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "default_direction": s.default_direction,
        "total_duration_ms": s.total_duration_ms,
        "step_count": s.step_count,
        "source_filename": s.source_filename,
        "created_at": s.created_at.isoformat() if s.created_at else "",
        "updated_at": s.updated_at.isoformat() if s.updated_at else "",
    }
