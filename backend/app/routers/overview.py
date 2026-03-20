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
    # Client counts
    total_clients = (await db.execute(select(func.count(Client.id)))).scalar()
    pending_clients = (
        await db.execute(
            select(func.count(Client.id)).where(
                Client.auth_state == AuthState.PENDING
            )
        )
    ).scalar()
    auth_clients = (
        await db.execute(
            select(func.count(Client.id)).where(
                Client.auth_state == AuthState.AUTHENTICATED
            )
        )
    ).scalar()

    # Profile counts
    total_profiles = (
        await db.execute(select(func.count(ImpairmentProfile.id)))
    ).scalar()
    active_profiles = (
        await db.execute(
            select(func.count(ImpairmentProfile.id)).where(
                ImpairmentProfile.enabled == True
            )
        )
    ).scalar()

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
