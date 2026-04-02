import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.firewall_rule import FirewallRule
from app.schemas.firewall_rule import (
    FirewallRuleCreate,
    FirewallRuleUpdate,
    FirewallRuleResponse,
)
from app.services.firewall import FirewallService

logger = logging.getLogger("jetlag.firewall_router")
router = APIRouter(prefix="/api/firewall", tags=["firewall"])


@router.get("/rules", response_model=dict)
async def list_rules(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    total = (await db.execute(select(func.count(FirewallRule.id)))).scalar() or 0
    rows = (
        await db.execute(
            select(FirewallRule)
            .order_by(FirewallRule.priority, FirewallRule.id)
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).scalars().all()
    return {
        "items": [FirewallRuleResponse.model_validate(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, -(-total // per_page)),
    }


@router.post("/rules", response_model=FirewallRuleResponse, status_code=201)
async def create_rule(payload: FirewallRuleCreate, db: AsyncSession = Depends(get_db)):
    _validate_rule(payload)
    rule = FirewallRule(**payload.model_dump())
    db.add(rule)
    await db.flush()
    await db.refresh(rule)
    logger.info(f"Created firewall rule {rule.id}: {rule.name}")
    return FirewallRuleResponse.model_validate(rule)


@router.get("/rules/{rule_id}", response_model=FirewallRuleResponse)
async def get_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    rule = await db.get(FirewallRule, rule_id)
    if not rule:
        raise HTTPException(404, "Firewall rule not found")
    return FirewallRuleResponse.model_validate(rule)


@router.put("/rules/{rule_id}", response_model=FirewallRuleResponse)
async def update_rule(
    rule_id: int, payload: FirewallRuleUpdate, db: AsyncSession = Depends(get_db)
):
    rule = await db.get(FirewallRule, rule_id)
    if not rule:
        raise HTTPException(404, "Firewall rule not found")
    updates = payload.model_dump(exclude_unset=True)
    if updates:
        _validate_rule(payload)
    for k, v in updates.items():
        setattr(rule, k, v)
    await db.flush()
    await db.refresh(rule)
    logger.info(f"Updated firewall rule {rule.id}: {rule.name}")
    return FirewallRuleResponse.model_validate(rule)


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    rule = await db.get(FirewallRule, rule_id)
    if not rule:
        raise HTTPException(404, "Firewall rule not found")
    await db.delete(rule)
    logger.info(f"Deleted firewall rule {rule_id}")
    return {"message": f"Firewall rule {rule_id} deleted"}


@router.post("/rules/apply")
async def apply_rules(db: AsyncSession = Depends(get_db)):
    """Re-apply all enabled firewall rules to nftables."""
    rows = (
        await db.execute(
            select(FirewallRule)
            .where(FirewallRule.enabled == True)
            .order_by(FirewallRule.priority, FirewallRule.id)
        )
    ).scalars().all()
    try:
        await FirewallService.apply_custom_rules(rows)
        return {"message": f"Applied {len(rows)} firewall rules to nftables"}
    except Exception as e:
        raise HTTPException(500, f"Failed to apply rules: {e}")


@router.get("/status")
async def firewall_status():
    """Return current nftables ruleset summary."""
    try:
        summary = await FirewallService.get_ruleset_summary()
        return summary
    except Exception as e:
        raise HTTPException(500, f"Failed to get firewall status: {e}")


# ── Validation helpers ──────────────────────────────────────────

_VALID_DIRECTIONS = {"inbound", "outbound", "forward"}
_VALID_ACTIONS = {"accept", "drop", "reject"}
_VALID_PROTOCOLS = {"tcp", "udp", "icmp", "any"}


def _validate_rule(payload):
    if hasattr(payload, "direction") and payload.direction is not None:
        if payload.direction not in _VALID_DIRECTIONS:
            raise HTTPException(422, f"Invalid direction: {payload.direction}")
    if hasattr(payload, "action") and payload.action is not None:
        if payload.action not in _VALID_ACTIONS:
            raise HTTPException(422, f"Invalid action: {payload.action}")
    if hasattr(payload, "protocol") and payload.protocol is not None:
        if payload.protocol not in _VALID_PROTOCOLS:
            raise HTTPException(422, f"Invalid protocol: {payload.protocol}")
