import datetime
import os
from pathlib import Path
from typing import Optional

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.client import Client, AuthState
from app.services.firewall import FirewallService
from app.services.logging_service import LoggingService
from app.services.network import NetworkService
from app.config import settings

router = APIRouter(prefix="/api/portal", tags=["portal"])


def _jetlag_yaml_path() -> Path:
    return Path(
        os.environ.get(
            "JETLAG_CONFIG",
            str(Path(__file__).resolve().parent.parent.parent.parent / "config" / "jetlag.yaml"),
        )
    )


def _persist_portal_to_yaml() -> None:
    """Merge `settings.portal` into jetlag.yaml so portal type survives restarts."""
    path = _jetlag_yaml_path()
    if path.exists():
        with open(path, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    else:
        raw = {}
    raw["portal"] = settings.portal.model_dump()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(raw, f, default_flow_style=False, sort_keys=False)


# ── Helpers ──────────────────────────────────────────────────────

async def _resolve_client(client_ip: str, db: AsyncSession) -> tuple[Client, str | None]:
    """Look up or create a Client record for the given IP. Returns (client, real_mac)."""
    real_mac = await NetworkService.arp_lookup(client_ip)
    result = await db.execute(select(Client).where(Client.ip_address == client_ip))
    client = result.scalar_one_or_none()
    if not client and real_mac:
        result = await db.execute(select(Client).where(Client.mac_address == real_mac))
        client = result.scalar_one_or_none()
        if client:
            client.ip_address = client_ip
    if not client:
        client = Client(
            mac_address=real_mac or f"unknown-{client_ip}",
            ip_address=client_ip,
            hostname=None,
            auth_state=AuthState.PENDING,
            first_seen=datetime.datetime.utcnow(),
            last_seen=datetime.datetime.utcnow(),
        )
        db.add(client)
        await db.flush()
    elif client.mac_address.startswith("unknown-") and real_mac:
        client.mac_address = real_mac
    return client, real_mac


async def _authenticate_client(client: Client, db: AsyncSession, method: str, session_minutes: int = 0):
    """Mark client as authenticated, allow through firewall."""
    redirect = settings.portal.redirect_url
    if client.auth_state == AuthState.AUTHENTICATED:
        # Check if time-limited session has expired
        if session_minutes > 0 and client.authenticated_at:
            expires = client.authenticated_at + datetime.timedelta(minutes=session_minutes)
            if datetime.datetime.utcnow() > expires:
                client.auth_state = AuthState.PENDING
                client.authenticated_at = None
                await FirewallService.intercept_client(client.ip_address, client.mac_address)
                return {"message": "Session expired", "expired": True}
        return {"message": "Already authenticated", "redirect": redirect}

    client.auth_state = AuthState.AUTHENTICATED
    client.authenticated_at = datetime.datetime.utcnow()
    client.last_seen = datetime.datetime.utcnow()
    await db.flush()
    await FirewallService.allow_client(client.ip_address, client.mac_address)
    await LoggingService.log_auth_event(db, client.ip_address, client.mac_address, method)
    return {"message": "Authenticated successfully", "redirect": redirect}


# ── Portal Config Endpoint ───────────────────────────────────────

@router.get("/config")
async def get_portal_config():
    """Return portal configuration to the captive portal frontend."""
    p = settings.portal
    return {
        "portal_type": p.portal_type,
        "welcome_message": p.welcome_message,
        "redirect_url": p.redirect_url,
        "session_duration_minutes": p.session_duration_minutes,
        "tiered_plans": p.tiered_plans,
        "walled_garden_domains": p.walled_garden_domains,
        "requires_login": p.portal_type == "web_login",
    }


class PortalConfigUpdate(BaseModel):
    portal_type: Optional[str] = None
    login_username: Optional[str] = None
    login_password: Optional[str] = None
    session_duration_minutes: Optional[int] = None
    tiered_plans: Optional[list[dict]] = None
    walled_garden_domains: Optional[list[str]] = None
    redirect_url: Optional[str] = None
    welcome_message: Optional[str] = None


@router.put("/config")
async def update_portal_config(payload: PortalConfigUpdate):
    """Update portal configuration at runtime."""
    p = settings.portal
    if payload.portal_type is not None:
        valid_types = {"click_through", "web_login", "tiered", "time_limited", "walled_garden"}
        if payload.portal_type not in valid_types:
            raise HTTPException(422, f"Invalid portal_type. Must be one of: {valid_types}")
        p.portal_type = payload.portal_type
    if payload.login_username is not None:
        p.login_username = payload.login_username
    if payload.login_password is not None:
        p.login_password = payload.login_password
    if payload.session_duration_minutes is not None:
        p.session_duration_minutes = payload.session_duration_minutes
    if payload.tiered_plans is not None:
        p.tiered_plans = payload.tiered_plans
    if payload.walled_garden_domains is not None:
        p.walled_garden_domains = payload.walled_garden_domains
    if payload.redirect_url is not None:
        p.redirect_url = payload.redirect_url
    if payload.welcome_message is not None:
        p.welcome_message = payload.welcome_message
    try:
        _persist_portal_to_yaml()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to save portal config: {e}") from e
    return {"message": "Portal config updated", "portal_type": p.portal_type}


# ── Click-Through Accept ─────────────────────────────────────────

@router.post("/accept")
async def accept_tos(request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else None
    if not client_ip:
        raise HTTPException(status_code=400, detail="Cannot determine client IP")
    client, _ = await _resolve_client(client_ip, db)
    portal_type = settings.portal.portal_type
    session_min = settings.portal.session_duration_minutes if portal_type == "time_limited" else 0
    return await _authenticate_client(client, db, f"click-through ({portal_type})", session_min)


# ── Web-Login ────────────────────────────────────────────────────

class LoginPayload(BaseModel):
    username: str
    password: str


@router.post("/login")
async def web_login(payload: LoginPayload, request: Request, db: AsyncSession = Depends(get_db)):
    """Authenticate via username/password (portal_type == web_login)."""
    if settings.portal.portal_type != "web_login":
        raise HTTPException(400, "Web login is not enabled on this portal")
    if payload.username != settings.portal.login_username or payload.password != settings.portal.login_password:
        raise HTTPException(401, "Invalid credentials")
    client_ip = request.client.host if request.client else None
    if not client_ip:
        raise HTTPException(400, "Cannot determine client IP")
    client, _ = await _resolve_client(client_ip, db)
    return await _authenticate_client(client, db, "web-login")


# ── Tiered Plan Selection ────────────────────────────────────────

class TieredPayload(BaseModel):
    plan_index: int


@router.post("/tiered")
async def tiered_select(payload: TieredPayload, request: Request, db: AsyncSession = Depends(get_db)):
    """Select a tiered plan (portal_type == tiered)."""
    if settings.portal.portal_type != "tiered":
        raise HTTPException(400, "Tiered portal is not enabled")
    plans = settings.portal.tiered_plans
    if payload.plan_index < 0 or payload.plan_index >= len(plans):
        raise HTTPException(422, "Invalid plan index")
    plan = plans[payload.plan_index]
    duration = plan.get("duration_minutes", 0)
    client_ip = request.client.host if request.client else None
    if not client_ip:
        raise HTTPException(400, "Cannot determine client IP")
    client, _ = await _resolve_client(client_ip, db)
    result = await _authenticate_client(client, db, f"tiered: {plan.get('name', 'unknown')}", duration)
    result["plan"] = plan
    return result


# ── Status ───────────────────────────────────────────────────────

@router.get("/status")
async def portal_status(request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else None
    if not client_ip:
        return {"authenticated": False}

    result = await db.execute(
        select(Client).where(Client.ip_address == client_ip)
    )
    client = result.scalar_one_or_none()
    if not client:
        return {"authenticated": False}

    is_auth = client.auth_state == AuthState.AUTHENTICATED
    session_remaining = None
    portal_type = settings.portal.portal_type

    # Check time-limited session expiry
    if is_auth and portal_type in ("time_limited", "tiered") and client.authenticated_at:
        duration = settings.portal.session_duration_minutes
        if duration > 0:
            expires = client.authenticated_at + datetime.timedelta(minutes=duration)
            now = datetime.datetime.utcnow()
            if now > expires:
                client.auth_state = AuthState.PENDING
                client.authenticated_at = None
                await db.flush()
                await FirewallService.intercept_client(client.ip_address, client.mac_address)
                is_auth = False
            else:
                session_remaining = int((expires - now).total_seconds())

    return {
        "authenticated": is_auth,
        "mac_address": client.mac_address,
        "ip_address": client.ip_address,
        "portal_type": portal_type,
        "session_remaining_seconds": session_remaining,
    }
