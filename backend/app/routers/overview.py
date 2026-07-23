from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.client import Client, AuthState
from app.models.impairment_profile import ImpairmentProfile
from app.models.capture import Capture, CaptureState
from app.services.dnsmasq import DnsmasqService

router = APIRouter(prefix="/api/overview", tags=["overview"])


@router.get("")
async def get_overview(db: AsyncSession = Depends(get_db)):
    # Client counts — one grouped query instead of three round-trips.
    client_rows = (
        await db.execute(
            select(Client.auth_state, func.count(Client.id)).group_by(
                Client.auth_state
            )
        )
    ).all()
    client_counts = {state: count for state, count in client_rows}
    total_clients = sum(client_counts.values())
    pending_clients = client_counts.get(AuthState.PENDING, 0)
    auth_clients = client_counts.get(AuthState.AUTHENTICATED, 0)

    # Profile counts — one grouped query instead of two round-trips.
    profile_rows = (
        await db.execute(
            select(ImpairmentProfile.enabled, func.count(ImpairmentProfile.id)).group_by(
                ImpairmentProfile.enabled
            )
        )
    ).all()
    total_profiles = sum(count for _, count in profile_rows)
    active_profiles = sum(count for enabled, count in profile_rows if enabled)

    # Active captures
    active_captures = (
        await db.execute(
            select(func.count(Capture.id)).where(
                Capture.state == CaptureState.RUNNING
            )
        )
    ).scalar()

    # dnsmasq status
    dnsmasq_status = await DnsmasqService.status()

    return {
        "clients": {
            "total": total_clients,
            "pending": pending_clients,
            "authenticated": auth_clients,
        },
        "profiles": {
            "total": total_profiles,
            "active": active_profiles,
        },
        "captures": {
            "active": active_captures,
        },
        "services": {
            "dnsmasq": dnsmasq_status,
        },
    }
