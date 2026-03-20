import asyncio
import datetime
import logging
import os
import signal
from pathlib import Path
from typing import Optional

from app.config import settings
from app.models.capture import Capture, CaptureState
from app.schemas.capture import CaptureCreate

logger = logging.getLogger("jetlag.capture")


class CaptureService:
    """Wrapper around tcpdump for on-demand packet capture."""

    @staticmethod
    async def start(data: CaptureCreate) -> tuple[Optional[Capture], Optional[str]]:
        """Start a tcpdump capture and return the Capture record."""
        output_dir = Path(settings.captures.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        safe_name = data.name.replace(" ", "_").replace("/", "_")
        filename = f"{safe_name}_{timestamp}.pcap"
        filepath = output_dir / filename

        # Build tcpdump filter expression
        filters = []
        if data.filter_expression:
            filters.append(data.filter_expression)
        else:
            if data.filter_ip:
                filters.append(f"host {data.filter_ip}")
            if data.filter_vlan:
                filters.append(f"vlan {data.filter_vlan}")

        filter_str = " and ".join(filters) if filters else ""

        iface = settings.network.lan_interface
        cmd_parts = [
            "tcpdump",
            "-i", iface,
            "-w", str(filepath),
            "-U",  # packet-buffered output
        ]

        if data.filter_mac:
            cmd_parts.extend(["-e", f"ether host {data.filter_mac}"])

        max_size = settings.captures.max_file_size_mb
        cmd_parts.extend(["-C", str(max_size)])

        if filter_str:
            cmd_parts.append(filter_str)

        cmd = " ".join(cmd_parts)
        logger.info(f"Starting capture: {cmd}")

        try:
            proc = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )

            capture = Capture(
                name=data.name,
                state=CaptureState.RUNNING,
                file_path=str(filepath),
                file_size_bytes=0,
                filter_ip=data.filter_ip,
                filter_mac=data.filter_mac,
                filter_vlan=data.filter_vlan,
                filter_expression=data.filter_expression,
                pid=proc.pid,
                started_at=datetime.datetime.utcnow(),
            )

            return capture, None

        except Exception as e:
            logger.error(f"Failed to start capture: {e}")
            return None, str(e)

    @staticmethod
    async def stop(capture: Capture) -> Optional[str]:
        """Stop a running tcpdump capture by PID."""
        if not capture.pid:
            return "No PID associated with capture"

        try:
            os.kill(capture.pid, signal.SIGTERM)
            logger.info(f"Stopped capture PID {capture.pid}: {capture.name}")
            return None
        except ProcessLookupError:
            logger.warning(f"Capture PID {capture.pid} not found (already stopped)")
            return None
        except Exception as e:
            logger.error(f"Failed to stop capture PID {capture.pid}: {e}")
            return str(e)
