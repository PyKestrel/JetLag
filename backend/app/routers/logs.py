from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.event_log import EventLog
from app.schemas.event_log import EventLogResponse

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("", response_model=dict)
async def list_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    category: str | None = None,
    level: str | None = None,
    source_ip: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(EventLog)
    count_query = select(func.count(EventLog.id))

    if category:
        query = query.where(EventLog.category == category)
        count_query = count_query.where(EventLog.category == category)
    if level:
        query = query.where(EventLog.level == level)
        count_query = count_query.where(EventLog.level == level)
    if source_ip:
        query = query.where(EventLog.source_ip == source_ip)
        count_query = count_query.where(EventLog.source_ip == source_ip)

    total = (await db.execute(count_query)).scalar()
    offset = (page - 1) * per_page
    result = await db.execute(
        query.order_by(EventLog.created_at.desc()).offset(offset).limit(per_page)
    )
    logs = result.scalars().all()

    return {
        "items": [EventLogResponse.model_validate(log) for log in logs],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if total else 0,
    }


@router.delete("")
async def clear_logs(
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import delete as sql_delete

    stmt = sql_delete(EventLog)
    if category:
        stmt = stmt.where(EventLog.category == category)

    result = await db.execute(stmt)
    await db.flush()

    return {"message": f"Deleted {result.rowcount} log entries"}
