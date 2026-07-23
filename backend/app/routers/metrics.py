from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.client import Client, AuthState
from app.services.metrics import MetricsService
from app.services.client_metrics import ClientMetricsService

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/interfaces")
async def interface_metrics(db: AsyncSession = Depends(get_db)):
    """Current per-interface throughput plus a live active-client count."""
    snapshot = MetricsService.sample()
    authenticated = (
        await db.execute(
            select(func.count(Client.id)).where(
                Client.auth_state == AuthState.AUTHENTICATED
            )
        )
    ).scalar() or 0
    total = (await db.execute(select(func.count(Client.id)))).scalar() or 0
    snapshot["clients"] = {"total": total, "authenticated": authenticated}
    return snapshot


@router.get("/history")
async def metrics_history():
    """Recent aggregate throughput samples for sparkline charts."""
    return MetricsService.history()


@router.get("/range")
async def metrics_range(minutes: int = Query(60, ge=1, le=1440)):
    """Persisted aggregate throughput over the last ``minutes`` (max 24h)."""
    return await MetricsService.range(minutes)


@router.get("/clients")
async def client_metrics():
    """Per-client live upload/download rates keyed by client IP."""
    return await ClientMetricsService.sample()
