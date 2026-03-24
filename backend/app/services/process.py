"""
Process management helpers for the JetLag appliance.

Provides functions to restart the backend service (systemd) and check
whether we're running under systemd vs. a bare terminal.
"""

import asyncio
import logging
import platform
import subprocess

logger = logging.getLogger("jetlag.process")


def is_systemd_managed() -> bool:
    """Return True if the current process is managed by systemd."""
    if platform.system() != "Linux":
        return False
    try:
        result = subprocess.run(
            ["systemctl", "is-active", "jetlag.service"],
            capture_output=True, text=True, timeout=5,
        )
        return result.stdout.strip() == "active"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


async def restart_service(delay_seconds: float = 1.5) -> bool:
    """
    Restart the jetlag systemd service after a short delay.

    The delay allows the calling HTTP response to be sent before the
    process is killed by systemd.

    Returns True if the restart command was dispatched, False if not
    running under systemd.
    """
    if not is_systemd_managed():
        logger.warning("Not running under systemd — cannot auto-restart")
        return False

    logger.info(f"Scheduling service restart in {delay_seconds}s...")

    async def _do_restart():
        await asyncio.sleep(delay_seconds)
        logger.info("Executing: systemctl restart jetlag.service")
        proc = await asyncio.create_subprocess_exec(
            "systemctl", "restart", "jetlag.service",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()

    asyncio.create_task(_do_restart())
    return True


async def stop_service() -> bool:
    """Stop the jetlag systemd service."""
    if not is_systemd_managed():
        return False

    logger.info("Stopping jetlag.service...")
    proc = await asyncio.create_subprocess_exec(
        "systemctl", "stop", "jetlag.service",
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.wait()
    return proc.returncode == 0


def get_service_status() -> dict:
    """Return basic systemd service status info."""
    if platform.system() != "Linux":
        return {"managed": False, "status": "non-linux"}

    try:
        result = subprocess.run(
            ["systemctl", "show", "jetlag.service",
             "--property=ActiveState,SubState,MainPID,ExecMainStartTimestamp"],
            capture_output=True, text=True, timeout=5,
        )
        props = {}
        for line in result.stdout.strip().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                props[k] = v

        return {
            "managed": True,
            "active_state": props.get("ActiveState", "unknown"),
            "sub_state": props.get("SubState", "unknown"),
            "main_pid": int(props.get("MainPID", 0)),
            "start_time": props.get("ExecMainStartTimestamp", ""),
        }
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"managed": False, "status": "systemctl-unavailable"}
