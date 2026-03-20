import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event_log import EventLog, EventCategory

logger = logging.getLogger("jetlag.events")


class LoggingService:
    """Structured event logging to the database."""

    @staticmethod
    async def _log(
        db: AsyncSession,
        category: EventCategory,
        message: str,
        level: str = "INFO",
        source_ip: Optional[str] = None,
        source_mac: Optional[str] = None,
        details: Optional[str] = None,
    ):
        event = EventLog(
            category=category,
            level=level,
            message=message,
            source_ip=source_ip,
            source_mac=source_mac,
            details=details,
        )
        db.add(event)
        await db.flush()
        logger.info(f"[{category.value}] {message}")

    @staticmethod
    async def log_auth_event(
        db: AsyncSession,
        ip: Optional[str],
        mac: Optional[str],
        action: str,
    ):
        await LoggingService._log(
            db,
            EventCategory.AUTH,
            f"Client {ip} ({mac}) {action}",
            source_ip=ip,
            source_mac=mac,
        )

    @staticmethod
    async def log_dhcp_event(
        db: AsyncSession,
        message: str,
        ip: Optional[str] = None,
        mac: Optional[str] = None,
    ):
        await LoggingService._log(
            db,
            EventCategory.DHCP,
            message,
            source_ip=ip,
            source_mac=mac,
        )

    @staticmethod
    async def log_dns_event(
        db: AsyncSession,
        message: str,
        ip: Optional[str] = None,
    ):
        await LoggingService._log(
            db,
            EventCategory.DNS,
            message,
            source_ip=ip,
        )

    @staticmethod
    async def log_firewall_event(
        db: AsyncSession,
        message: str,
        ip: Optional[str] = None,
    ):
        await LoggingService._log(
            db,
            EventCategory.FIREWALL,
            message,
            source_ip=ip,
        )

    @staticmethod
    async def log_impairment_event(
        db: AsyncSession,
        message: str,
    ):
        await LoggingService._log(
            db,
            EventCategory.IMPAIRMENT,
            message,
        )

    @staticmethod
    async def log_capture_event(
        db: AsyncSession,
        message: str,
        ip: Optional[str] = None,
    ):
        await LoggingService._log(
            db,
            EventCategory.CAPTURE,
            message,
            source_ip=ip,
        )

    @staticmethod
    async def log_system_event(
        db: AsyncSession,
        message: str,
        level: str = "INFO",
    ):
        await LoggingService._log(
            db,
            EventCategory.SYSTEM,
            message,
            level=level,
        )
