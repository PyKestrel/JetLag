import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.client import Client, AuthState
from app.services.firewall import FirewallService
from app.services.logging_service import LoggingService
from app.services.network import NetworkService

router = APIRouter(prefix="/api/portal", tags=["portal"])


@router.post("/accept")
async def accept_tos(request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else None
    if not client_ip:
        raise HTTPException(status_code=400, detail="Cannot determine client IP")

    # Try to resolve the real MAC address from the ARP table
    real_mac = await NetworkService.arp_lookup(client_ip)

    # Look up by IP first, then try by MAC if we found one
    result = await db.execute(
        select(Client).where(Client.ip_address == client_ip)
    )
    client = result.scalar_one_or_none()

    # If not found by IP but we have a MAC, try by MAC (IP may have changed)
    if not client and real_mac:
        result = await db.execute(
            select(Client).where(Client.mac_address == real_mac)
        )
        client = result.scalar_one_or_none()
        if client:
            client.ip_address = client_ip  # update to current IP

    if not client:
        # Auto-create client record (static IP or DHCP lease not yet synced)
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
        # We previously created with a placeholder MAC — update to real one
        client.mac_address = real_mac

    if client.auth_state == AuthState.AUTHENTICATED:
        return {"message": "Already authenticated", "redirect": "https://www.google.com"}

    client.auth_state = AuthState.AUTHENTICATED
    client.authenticated_at = datetime.datetime.utcnow()
    client.last_seen = datetime.datetime.utcnow()
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
