"""Wireless AP management API.

Provides endpoints for:
  - Detecting WLAN-capable interfaces
  - Configuring the access point (SSID, channel, security, etc.)
  - Starting / stopping / restarting hostapd
  - Querying AP status and connected stations
  - Radio capability scanning
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.services.hostapd import HostapdService

logger = logging.getLogger("jetlag.wireless_router")
router = APIRouter(prefix="/api/wireless", tags=["wireless"])


# ── Schemas ──────────────────────────────────────────────────────

class WirelessConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    interface: Optional[str] = None
    ssid: Optional[str] = None
    channel: Optional[int] = None
    hw_mode: Optional[str] = None
    ieee80211n: Optional[bool] = None
    ieee80211ac: Optional[bool] = None
    wpa: Optional[int] = None
    wpa_passphrase: Optional[str] = None
    wpa_key_mgmt: Optional[str] = None
    rsn_pairwise: Optional[str] = None
    country_code: Optional[str] = None
    ip: Optional[str] = None
    subnet: Optional[str] = None
    dhcp_range_start: Optional[str] = None
    dhcp_range_end: Optional[str] = None
    dhcp_lease_time: Optional[str] = None
    bridge_to_lan: Optional[bool] = None
    max_clients: Optional[int] = None
    hidden: Optional[bool] = None


class WirelessConfigResponse(BaseModel):
    enabled: bool
    interface: str
    ssid: str
    channel: int
    hw_mode: str
    ieee80211n: bool
    ieee80211ac: bool
    wpa: int
    wpa_passphrase: str
    wpa_key_mgmt: str
    rsn_pairwise: str
    country_code: str
    ip: str
    subnet: str
    dhcp_range_start: str
    dhcp_range_end: str
    dhcp_lease_time: str
    bridge_to_lan: bool
    max_clients: int
    hidden: bool


# ── Endpoints ────────────────────────────────────────────────────

@router.get("/detect")
async def detect_interfaces():
    """Detect WLAN-capable interfaces on this system."""
    interfaces = await HostapdService.detect_wlan_interfaces()
    return {"interfaces": interfaces, "count": len(interfaces)}


@router.get("/capabilities/{interface}")
async def get_capabilities(interface: str):
    """Return radio capabilities (bands, channels, HT/VHT) for a WLAN interface."""
    caps = await HostapdService.get_phy_capabilities(interface)
    if "error" in caps:
        raise HTTPException(400, caps["error"])
    return caps


@router.get("/config", response_model=WirelessConfigResponse)
async def get_config():
    """Return the current wireless AP configuration."""
    cfg = settings.wireless
    return WirelessConfigResponse(
        enabled=cfg.enabled,
        interface=cfg.interface,
        ssid=cfg.ssid,
        channel=cfg.channel,
        hw_mode=cfg.hw_mode,
        ieee80211n=cfg.ieee80211n,
        ieee80211ac=cfg.ieee80211ac,
        wpa=cfg.wpa,
        wpa_passphrase=cfg.wpa_passphrase,
        wpa_key_mgmt=cfg.wpa_key_mgmt,
        rsn_pairwise=cfg.rsn_pairwise,
        country_code=cfg.country_code,
        ip=cfg.ip,
        subnet=cfg.subnet,
        dhcp_range_start=cfg.dhcp_range_start,
        dhcp_range_end=cfg.dhcp_range_end,
        dhcp_lease_time=cfg.dhcp_lease_time,
        bridge_to_lan=cfg.bridge_to_lan,
        max_clients=cfg.max_clients,
        hidden=cfg.hidden,
    )


@router.put("/config", response_model=WirelessConfigResponse)
async def update_config(payload: WirelessConfigUpdate):
    """Update wireless AP configuration.

    Changes are written to jetlag.yaml. A restart of the AP is needed to apply.
    """
    import yaml
    from pathlib import Path
    import os

    cfg = settings.wireless
    updates = payload.model_dump(exclude_unset=True)

    if not updates:
        raise HTTPException(422, "No fields to update")

    # Validate hw_mode
    if "hw_mode" in updates and updates["hw_mode"] not in ("a", "b", "g"):
        raise HTTPException(422, f"Invalid hw_mode: {updates['hw_mode']}. Must be a, b, or g")

    # Validate wpa
    if "wpa" in updates and updates["wpa"] not in (0, 1, 2, 3):
        raise HTTPException(422, f"Invalid wpa value: {updates['wpa']}. Must be 0, 1, 2, or 3")

    # Validate channel
    if "channel" in updates:
        ch = updates["channel"]
        if not (1 <= ch <= 196):
            raise HTTPException(422, f"Invalid channel: {ch}")

    # Apply updates to in-memory config
    for key, value in updates.items():
        setattr(cfg, key, value)

    # Persist to YAML
    config_path = os.environ.get(
        "JETLAG_CONFIG",
        str(Path(__file__).parent.parent.parent.parent / "config" / "jetlag.yaml"),
    )
    try:
        with open(config_path, "r") as f:
            raw = yaml.safe_load(f) or {}
        if "wireless" not in raw:
            raw["wireless"] = {}
        raw["wireless"].update(updates)
        with open(config_path, "w") as f:
            yaml.dump(raw, f, default_flow_style=False, sort_keys=False)
        logger.info(f"Wireless config updated: {list(updates.keys())}")
    except Exception as e:
        logger.error(f"Failed to persist wireless config: {e}")
        raise HTTPException(500, f"Failed to save config: {e}")

    return await get_config()


@router.post("/start")
async def start_ap():
    """Start the wireless access point (hostapd)."""
    result = await HostapdService.start()
    if not result["success"]:
        raise HTTPException(500, result.get("error", "Failed to start AP"))
    return result


@router.post("/stop")
async def stop_ap():
    """Stop the wireless access point."""
    result = await HostapdService.stop()
    if not result["success"]:
        raise HTTPException(500, result.get("error", "Failed to stop AP"))
    return result


@router.post("/restart")
async def restart_ap():
    """Restart the wireless access point (applies config changes)."""
    result = await HostapdService.restart()
    if not result["success"]:
        raise HTTPException(500, result.get("error", "Failed to restart AP"))
    return result


@router.get("/status")
async def ap_status():
    """Return the current AP status, including connected clients."""
    return await HostapdService.status()


@router.get("/stations")
async def connected_stations():
    """Return the list of connected WiFi client stations."""
    stations = await HostapdService.get_connected_stations()
    return {"stations": stations, "count": len(stations)}
