from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.client import Client, AuthState
from app.services.firewall import FirewallService
from app.services.logging_service import LoggingService

router = APIRouter(prefix="/api/portal", tags=["portal"])


@router.post("/accept")
async def accept_tos(request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else None
    if not client_ip:
        raise HTTPException(status_code=400, detail="Cannot determine client IP")

    result = await db.execute(
        select(Client).where(Client.ip_address == client_ip)
    )
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(
            status_code=404,
            detail="Client not found. Ensure DHCP lease is active.",
        )

    if client.auth_state == AuthState.AUTHENTICATED:
        return {"message": "Already authenticated", "redirect": "https://www.google.com"}

    import datetime

    client.auth_state = AuthState.AUTHENTICATED
    client.authenticated_at = datetime.datetime.utcnow()
    await db.flush()

    await FirewallService.allow_client(client.ip_address, client.mac_address)
    await LoggingService.log_auth_event(
        db, client.ip_address, client.mac_address, "authenticated via portal"
    )

    return {"message": "Authenticated successfully", "redirect": "https://www.google.com"}


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

    return {
        "authenticated": client.auth_state == AuthState.AUTHENTICATED,
        "mac_address": client.mac_address,
        "ip_address": client.ip_address,
    }
