import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.capture import Capture, CaptureState
from app.schemas.capture import CaptureCreate, CaptureResponse
from app.services.capture import CaptureService
from app.services.logging_service import LoggingService

router = APIRouter(prefix="/api/captures", tags=["captures"])


@router.get("", response_model=dict)
async def list_captures(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    state: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Capture)
    count_query = select(func.count(Capture.id))

    if state:
        query = query.where(Capture.state == state)
        count_query = count_query.where(Capture.state == state)

    total = (await db.execute(count_query)).scalar()
    offset = (page - 1) * per_page
    result = await db.execute(
        query.order_by(Capture.started_at.desc()).offset(offset).limit(per_page)
    )
    captures = result.scalars().all()

    return {
        "items": [CaptureResponse.model_validate(c) for c in captures],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if total else 0,
    }


@router.post("", response_model=CaptureResponse, status_code=201)
async def start_capture(data: CaptureCreate, db: AsyncSession = Depends(get_db)):
    capture_record, error = await CaptureService.start(data)
    if error:
        raise HTTPException(status_code=500, detail=error)

    db.add(capture_record)
    await db.flush()
    await db.refresh(capture_record)

    await LoggingService.log_capture_event(
        db, f"Started capture: {capture_record.name}", ip=data.filter_ip
    )

    return CaptureResponse.model_validate(capture_record)


@router.post("/{capture_id}/stop", response_model=CaptureResponse)
async def stop_capture(capture_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Capture).where(Capture.id == capture_id))
    capture = result.scalar_one_or_none()
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")

    if capture.state != CaptureState.RUNNING:
        raise HTTPException(status_code=400, detail="Capture is not running")

    error = await CaptureService.stop(capture)
    if error:
        raise HTTPException(status_code=500, detail=error)

    capture.state = CaptureState.STOPPED
    capture.stopped_at = datetime.datetime.utcnow()

    # Update file size
    path = Path(capture.file_path)
    if path.exists():
        capture.file_size_bytes = path.stat().st_size

    await db.flush()

    await LoggingService.log_capture_event(
        db, f"Stopped capture: {capture.name}"
    )

    return CaptureResponse.model_validate(capture)


@router.get("/{capture_id}/download")
async def download_capture(capture_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Capture).where(Capture.id == capture_id))
    capture = result.scalar_one_or_none()
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")

    path = Path(capture.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Capture file not found on disk")

    return FileResponse(
        path=str(path),
        media_type="application/vnd.tcpdump.pcap",
        filename=f"{capture.name}.pcap",
    )


@router.delete("/{capture_id}")
async def delete_capture(capture_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Capture).where(Capture.id == capture_id))
    capture = result.scalar_one_or_none()
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")

    if capture.state == CaptureState.RUNNING:
        await CaptureService.stop(capture)

    # Remove file from disk
    path = Path(capture.file_path)
    if path.exists():
        path.unlink()

    name = capture.name
    await db.delete(capture)
    await db.flush()

    await LoggingService.log_capture_event(db, f"Deleted capture: {name}")

    return {"message": f"Capture '{name}' deleted"}
