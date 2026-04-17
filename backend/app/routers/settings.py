import logging
import os
import platform
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import (
    settings,
    AppConfig,
    NetworkConfig,
    DHCPConfig,
    VLANConfig,
    DNSConfig,
    PortalConfig,
    AdminConfig,
    CapturesConfig,
    LoggingConfig,
    WANPort,
    LANPort,
    PortDHCPConfig,
    load_config,
)

logger = logging.getLogger("jetlag.settings")

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _config_path() -> Path:
    return Path(
        os.environ.get(
            "JETLAG_CONFIG",
            str(Path(__file__).parent.parent.parent.parent / "config" / "jetlag.yaml"),
        )
    )


@router.get("", response_model=dict)
async def get_settings():
    return {
        "setup_completed": settings.setup_completed,
        "wan_ports": [p.model_dump() for p in settings.wan_ports],
        "lan_ports": [p.model_dump() for p in settings.lan_ports],
        "network": settings.network.model_dump(),
        "dhcp": settings.dhcp.model_dump(),
        "vlans": [v.model_dump() for v in settings.vlans],
        "dns": settings.dns.model_dump(),
        "portal": settings.portal.model_dump(),
        "admin": settings.admin.model_dump(),
        "captures": settings.captures.model_dump(),
        "logging": settings.logging.model_dump(),
    }


class SettingsUpdate(BaseModel):
    wan_ports: list[WANPort] | None = None
    lan_ports: list[LANPort] | None = None
    network: NetworkConfig | None = None
    dhcp: DHCPConfig | None = None
    vlans: list[VLANConfig] | None = None
    dns: DNSConfig | None = None
    portal: PortalConfig | None = None
    admin: AdminConfig | None = None
    captures: CapturesConfig | None = None
    logging: LoggingConfig | None = None


@router.put("", response_model=dict)
async def update_settings(payload: SettingsUpdate):
    """Update appliance settings and persist to jetlag.yaml."""
    global settings

    # Merge: only update sections that were provided
    if payload.wan_ports is not None:
        settings.wan_ports = payload.wan_ports
    if payload.lan_ports is not None:
        settings.lan_ports = payload.lan_ports
    if payload.network is not None:
        settings.network = payload.network
    if payload.dhcp is not None:
        settings.dhcp = payload.dhcp
    if payload.vlans is not None:
        settings.vlans = payload.vlans
    if payload.dns is not None:
        settings.dns = payload.dns
    if payload.portal is not None:
        settings.portal = payload.portal
    if payload.admin is not None:
        settings.admin = payload.admin
    if payload.captures is not None:
        settings.captures = payload.captures
    if payload.logging is not None:
        settings.logging = payload.logging

    # Serialize back to YAML
    config_data = {
        "setup_completed": settings.setup_completed,
        "wan_ports": [p.model_dump() for p in settings.wan_ports],
        "lan_ports": [p.model_dump() for p in settings.lan_ports],
        "network": settings.network.model_dump(),
        "dhcp": settings.dhcp.model_dump(),
        "vlans": [v.model_dump() for v in settings.vlans],
        "dns": settings.dns.model_dump(),
        "portal": settings.portal.model_dump(),
        "admin": settings.admin.model_dump(),
        "captures": settings.captures.model_dump(),
        "logging": settings.logging.model_dump(),
    }

    path = _config_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            yaml.dump(config_data, f, default_flow_style=False, sort_keys=False)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write config: {e}")

    # Apply LAN interface changes on Linux when lan_ports were updated
    services_reloaded: list[str] = []
    if payload.lan_ports is not None and settings.setup_completed and platform.system() == "Linux":
        from app.routers.setup import _configure_lan_port
        from app.services.dnsmasq import DnsmasqService
        from app.services.firewall import FirewallService

        for lp in settings.lan_ports:
            try:
                await _configure_lan_port(lp)
                services_reloaded.append(f"lan:{lp.effective_interface}")
            except Exception as e:
                logger.error(f"Failed to configure LAN port {lp.effective_interface}: {e}")

        try:
            await DnsmasqService.generate_config()
            await DnsmasqService.restart()
            services_reloaded.append("dnsmasq")
        except Exception as e:
            logger.error(f"Failed to reload dnsmasq after settings update: {e}")

        try:
            await FirewallService.initialize()
            services_reloaded.append("nftables")
        except Exception as e:
            logger.error(f"Failed to reload firewall after settings update: {e}")

    return {
        "message": "Settings updated successfully",
        "services_reloaded": services_reloaded,
        **config_data,
    }
