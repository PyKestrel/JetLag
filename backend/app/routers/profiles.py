import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.impairment_profile import ImpairmentProfile, MatchRule
from app.schemas.impairment_profile import (
    ImpairmentProfileCreate,
    ImpairmentProfileUpdate,
    ImpairmentProfileResponse,
)
from app.services.impairment import ImpairmentService
from app.services.logging_service import LoggingService
from app.services.replay import ReplayService

logger = logging.getLogger("jetlag.profiles")

router = APIRouter(prefix="/api/profiles", tags=["impairment_profiles"])


@router.get("", response_model=dict)
async def list_profiles(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    total = (
        await db.execute(select(func.count(ImpairmentProfile.id)))
    ).scalar()
    offset = (page - 1) * per_page
    result = await db.execute(
        select(ImpairmentProfile)
        .options(selectinload(ImpairmentProfile.match_rules))
        .order_by(ImpairmentProfile.created_at.desc())
        .offset(offset)
        .limit(per_page)
    )
    profiles = result.scalars().all()

    return {
        "items": [ImpairmentProfileResponse.model_validate(p) for p in profiles],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if total else 0,
    }


@router.post("/reconcile-tc", response_model=dict)
async def reconcile_tc(db: AsyncSession = Depends(get_db)):
    """Clear all tc/netem state on the LAN/IFB devices, then re-apply enabled profiles.

    Use this when impairment rules are left active in the kernel after a crash,
    failed removal, or manual tc edits, so the running config matches the database.
    """
    await ImpairmentService.remove_all()

    result = await db.execute(
        select(ImpairmentProfile)
        .options(selectinload(ImpairmentProfile.match_rules))
        .where(ImpairmentProfile.enabled.is_(True))
        .order_by(ImpairmentProfile.id)
    )
    enabled = result.scalars().all()

    errors: list[dict] = []
    for p in enabled:
        err = await ImpairmentService.apply_profile(p)
        if err:
            errors.append({"profile_id": p.id, "name": p.name, "error": err})
            logger.error(f"reconcile-tc: failed to apply profile {p.id} ({p.name}): {err}")

    await LoggingService.log_impairment_event(
        db,
        f"TC reconcile: cleared kernel rules, re-applied {len(enabled)} enabled profile(s)"
        + (f" ({len(errors)} error(s))" if errors else ""),
    )

    return {
        "message": "tc/netem reset and enabled profiles re-applied",
        "enabled_count": len(enabled),
        "errors": errors,
    }


@router.get("/{profile_id}", response_model=ImpairmentProfileResponse)
async def get_profile(profile_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ImpairmentProfile)
        .options(selectinload(ImpairmentProfile.match_rules))
        .where(ImpairmentProfile.id == profile_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return ImpairmentProfileResponse.model_validate(profile)


@router.post("", response_model=ImpairmentProfileResponse, status_code=201)
async def create_profile(
    data: ImpairmentProfileCreate, db: AsyncSession = Depends(get_db)
):
    profile = ImpairmentProfile(
        name=data.name,
        description=data.description,
        enabled=data.enabled,
        direction=data.direction,
        latency_ms=data.latency_ms,
        jitter_ms=data.jitter_ms,
        latency_correlation=data.latency_correlation,
        latency_distribution=data.latency_distribution,
        packet_loss_percent=data.packet_loss_percent,
        loss_correlation=data.loss_correlation,
        corruption_percent=data.corruption_percent,
        corruption_correlation=data.corruption_correlation,
        reorder_percent=data.reorder_percent,
        reorder_correlation=data.reorder_correlation,
        duplicate_percent=data.duplicate_percent,
        duplicate_correlation=data.duplicate_correlation,
        bandwidth_limit_kbps=data.bandwidth_limit_kbps,
        bandwidth_burst_kbytes=data.bandwidth_burst_kbytes,
        bandwidth_ceil_kbps=data.bandwidth_ceil_kbps,
    )
    db.add(profile)
    await db.flush()

    for rule_data in data.match_rules:
        rule = MatchRule(profile_id=profile.id, **rule_data.model_dump())
        db.add(rule)
    await db.flush()

    # Reload with relationships
    await db.refresh(profile)
    result = await db.execute(
        select(ImpairmentProfile)
        .options(selectinload(ImpairmentProfile.match_rules))
        .where(ImpairmentProfile.id == profile.id)
    )
    profile = result.scalar_one()

    if profile.enabled:
        err = await ImpairmentService.apply_profile(profile)
        if err:
            logger.error(f"Failed to apply profile '{profile.name}' on create: {err}")

    await LoggingService.log_impairment_event(
        db, f"Created impairment profile: {profile.name}"
    )

    return ImpairmentProfileResponse.model_validate(profile)


@router.put("/{profile_id}", response_model=ImpairmentProfileResponse)
async def update_profile(
    profile_id: int,
    data: ImpairmentProfileUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ImpairmentProfile)
        .options(selectinload(ImpairmentProfile.match_rules))
        .where(ImpairmentProfile.id == profile_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    update_data = data.model_dump(exclude_unset=True)
    match_rules_data = update_data.pop("match_rules", None)

    for field, value in update_data.items():
        setattr(profile, field, value)

    if match_rules_data is not None:
        # Replace all match rules
        for rule in profile.match_rules:
            await db.delete(rule)
        await db.flush()

        for rule_data in match_rules_data:
            rule = MatchRule(profile_id=profile.id, **rule_data)
            db.add(rule)

    await db.flush()

    # Reload
    result = await db.execute(
        select(ImpairmentProfile)
        .options(selectinload(ImpairmentProfile.match_rules))
        .where(ImpairmentProfile.id == profile.id)
    )
    profile = result.scalar_one()

    if profile.enabled:
        err = await ImpairmentService.apply_profile(profile)
        if err:
            logger.error(f"Failed to apply profile '{profile.name}' on update: {err}")
    else:
        err = await ImpairmentService.remove_profile(profile)
        if err:
            logger.error(f"Failed to remove profile '{profile.name}' on update: {err}")

    await LoggingService.log_impairment_event(
        db, f"Updated impairment profile: {profile.name}"
    )

    return ImpairmentProfileResponse.model_validate(profile)


@router.delete("/{profile_id}")
async def delete_profile(profile_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ImpairmentProfile)
        .options(selectinload(ImpairmentProfile.match_rules))
        .where(ImpairmentProfile.id == profile_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    # Stop any active replay session on this profile before deletion
    await ReplayService.stop_session(profile_id)
    ReplayService._active_sessions.pop(profile_id, None)

    if profile.enabled:
        await ImpairmentService.remove_profile(profile)

    name = profile.name
    await db.delete(profile)
    await db.flush()

    await LoggingService.log_impairment_event(
        db, f"Deleted impairment profile: {name}"
    )

    return {"message": f"Profile '{name}' deleted"}
