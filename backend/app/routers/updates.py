"""
Update management API router.

Provides endpoints for checking, applying, and rolling back OTA updates,
as well as viewing update history and configuring auto-check settings.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import updater

logger = logging.getLogger("jetlag.api.updates")

router = APIRouter(prefix="/api/updates", tags=["updates"])


# ── Request/Response schemas ──────────────────────────────────────

class ApplyUpdateRequest(BaseModel):
    version: str


class UpdateConfigRequest(BaseModel):
    auto_check: Optional[bool] = None
    check_interval_hours: Optional[int] = None
    github_repo: Optional[str] = None
    channel: Optional[str] = None
    auto_download: Optional[bool] = None


# ── Endpoints ─────────────────────────────────────────────────────

@router.get("/check")
async def check_for_update(force: bool = False):
    """
    Check GitHub Releases for a newer version.
    Pass ?force=true to bypass the cache.
    """
    result = await updater.check_for_update(force=force)
    return result


@router.post("/apply")
async def apply_update(payload: ApplyUpdateRequest):
    """
    Start the update pipeline for a specific version.
    The update runs in the background; poll /status for progress.
    """
    if not payload.version:
        raise HTTPException(status_code=400, detail="version is required")

    result = await updater.start_update(payload.version)
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])

    return result


@router.get("/status")
async def get_update_status():
    """Get the current or most recent update job status."""
    return updater.get_status()


@router.post("/rollback")
async def rollback():
    """Manually trigger a rollback to the previous version."""
    result = await updater.trigger_rollback()
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@router.get("/history")
async def get_update_history():
    """List past update attempts with timestamps and outcomes."""
    return {"history": updater.get_history()}


@router.get("/config")
async def get_update_config():
    """Get update system configuration."""
    from app.config import settings as cfg
    return cfg.updates.model_dump()


@router.put("/config")
async def update_config(payload: UpdateConfigRequest):
    """Update the update system configuration."""
    import yaml
    from pathlib import Path
    from app.config import settings as cfg

    if payload.auto_check is not None:
        cfg.updates.auto_check = payload.auto_check
    if payload.check_interval_hours is not None:
        if payload.check_interval_hours < 1:
            raise HTTPException(status_code=400, detail="check_interval_hours must be >= 1")
        cfg.updates.check_interval_hours = payload.check_interval_hours
    if payload.github_repo is not None:
        cfg.updates.github_repo = payload.github_repo
    if payload.channel is not None:
        if payload.channel not in ("stable", "beta"):
            raise HTTPException(status_code=400, detail="channel must be 'stable' or 'beta'")
        cfg.updates.channel = payload.channel
    if payload.auto_download is not None:
        cfg.updates.auto_download = payload.auto_download

    # Persist to YAML
    config_path = Path(
        __import__("os").environ.get(
            "JETLAG_CONFIG",
            str(Path(__file__).parent.parent.parent.parent / "config" / "jetlag.yaml"),
        )
    )
    if config_path.exists():
        with open(config_path, "r") as f:
            raw = yaml.safe_load(f) or {}
    else:
        raw = {}

    raw["updates"] = cfg.updates.model_dump()

    with open(config_path, "w") as f:
        yaml.dump(raw, f, default_flow_style=False, sort_keys=False)

    logger.info(f"Update config saved: {cfg.updates.model_dump()}")
    return cfg.updates.model_dump()
