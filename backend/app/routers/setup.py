import os
import platform
import subprocess
import logging
from pathlib import Path
from typing import Optional

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings, NetworkConfig, DHCPConfig, DNSConfig

logger = logging.getLogger("jetlag.setup")

router = APIRouter(prefix="/api/setup", tags=["setup"])


def _config_path() -> Path:
    return Path(
        os.environ.get(
            "JETLAG_CONFIG",
            str(Path(__file__).parent.parent.parent.parent / "config" / "jetlag.yaml"),
        )
    )


def _detect_interfaces() -> list[dict]:
    """Detect available network interfaces with their addresses and status."""
    interfaces = []
    system = platform.system()

    if system == "Linux":
        try:
            import json as _json
            result = subprocess.run(
                ["ip", "-j", "addr", "show"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                data = _json.loads(result.stdout)
                for iface in data:
                    name = iface.get("ifname", "")
                    if name == "lo":
                        continue
                    state = iface.get("operstate", "UNKNOWN")
                    mac = iface.get("address", "")
                    ipv4_addrs = []
                    for addr_info in iface.get("addr_info", []):
                        if addr_info.get("family") == "inet":
                            ipv4_addrs.append(
                                f"{addr_info['local']}/{addr_info.get('prefixlen', 24)}"
                            )
                    interfaces.append({
                        "name": name,
                        "mac": mac,
                        "state": state.upper(),
                        "ipv4_addresses": ipv4_addrs,
                        "has_link": state.upper() in ("UP",),
                    })
                return interfaces
        except Exception as e:
            logger.warning(f"Failed to detect interfaces via ip command: {e}")

    # Fallback: use psutil-style or cross-platform detection
    try:
        import socket
        import struct
        # Simple fallback — just list what we can find
        # On Windows/macOS, enumerate via socket
        import netifaces  # type: ignore
        for iface_name in netifaces.interfaces():
            if iface_name == "lo" or iface_name.startswith("lo"):
                continue
            addrs = netifaces.ifaddresses(iface_name)
            ipv4 = addrs.get(netifaces.AF_INET, [])
            mac_list = addrs.get(netifaces.AF_LINK, [])
            interfaces.append({
                "name": iface_name,
                "mac": mac_list[0].get("addr", "") if mac_list else "",
                "state": "UP" if ipv4 else "DOWN",
                "ipv4_addresses": [f"{a['addr']}/{a.get('netmask', '255.255.255.0')}" for a in ipv4],
                "has_link": bool(ipv4),
            })
        return interfaces
    except ImportError:
        pass

    # Last resort: return mock/placeholder interfaces for dev environments
    logger.warning("Could not detect real interfaces, returning placeholder data")
    return [
        {
            "name": "eth0",
            "mac": "00:00:00:00:00:01",
            "state": "UP",
            "ipv4_addresses": ["192.168.1.100/24"],
            "has_link": True,
        },
        {
            "name": "eth1",
            "mac": "00:00:00:00:00:02",
            "state": "UP",
            "ipv4_addresses": [],
            "has_link": True,
        },
    ]


@router.get("/status")
async def get_setup_status():
    """Check if initial setup has been completed."""
    return {
        "setup_completed": settings.setup_completed,
        "wan_interface": settings.network.wan_interface if settings.setup_completed else None,
        "lan_interface": settings.network.lan_interface if settings.setup_completed else None,
        "lan_ip": settings.network.lan_ip if settings.setup_completed else None,
    }


@router.get("/interfaces")
async def get_interfaces():
    """List available network interfaces for WAN/LAN selection."""
    interfaces = _detect_interfaces()
    return {"interfaces": interfaces}


class SetupRequest(BaseModel):
    wan_interface: str
    lan_interface: str
    lan_ip: str = "10.0.1.1"
    lan_subnet: str = "10.0.1.0/24"
    dhcp_enabled: bool = True
    dhcp_range_start: str = "10.0.1.100"
    dhcp_range_end: str = "10.0.1.250"
    dhcp_lease_time: str = "1h"
    dns_upstream: list[str] = ["1.1.1.1", "8.8.8.8"]


@router.post("/complete")
async def complete_setup(payload: SetupRequest):
    """
    Finalize initial setup:
    1. Save WAN/LAN interface selections and network config to jetlag.yaml
    2. Mark setup as completed
    3. On a real appliance, this would start DHCP/DNS/firewall on the LAN interface
       and restrict admin access to LAN only
    """
    if payload.wan_interface == payload.lan_interface:
        raise HTTPException(
            status_code=400,
            detail="WAN and LAN interfaces must be different.",
        )

    # Update in-memory config
    settings.network = NetworkConfig(
        wan_interface=payload.wan_interface,
        lan_interface=payload.lan_interface,
        lan_ip=payload.lan_ip,
        lan_subnet=payload.lan_subnet,
    )
    settings.dhcp.enabled = payload.dhcp_enabled
    settings.dhcp.range_start = payload.dhcp_range_start
    settings.dhcp.range_end = payload.dhcp_range_end
    settings.dhcp.lease_time = payload.dhcp_lease_time
    settings.dhcp.gateway = payload.lan_ip
    settings.dhcp.dns_server = payload.lan_ip
    settings.dns.spoof_target = payload.lan_ip
    settings.dns.upstream_servers = payload.dns_upstream
    settings.setup_completed = True

    # Persist to YAML
    config_data = {
        "setup_completed": True,
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

    logger.info(
        f"Setup complete: WAN={payload.wan_interface}, LAN={payload.lan_interface}, "
        f"LAN IP={payload.lan_ip}"
    )

    # On a real Linux appliance, we would now:
    # 1. Configure the LAN interface IP
    #    await _run(f"ip addr flush dev {payload.lan_interface}")
    #    await _run(f"ip addr add {payload.lan_ip}/{subnet_bits} dev {payload.lan_interface}")
    #    await _run(f"ip link set {payload.lan_interface} up")
    #
    # 2. Generate and start dnsmasq (DHCP + DNS) on LAN
    #    await DnsmasqService.generate_config()
    #    await DnsmasqService.restart()
    #
    # 3. Initialize nftables firewall rules
    #    await FirewallService.initialize()
    #
    # 4. Rebind uvicorn to LAN IP only (requires process restart or reverse proxy)

    return {
        "message": "Setup completed successfully",
        "setup_completed": True,
        "network": settings.network.model_dump(),
        "dhcp": settings.dhcp.model_dump(),
        "dns": settings.dns.model_dump(),
        "services_note": (
            "On a production Linux appliance, DHCP, DNS, and firewall services "
            "would now be running on the LAN interface, and admin access would be "
            "restricted to the LAN."
        ),
    }


@router.post("/reset")
async def reset_setup():
    """Reset setup status (for development/testing)."""
    settings.setup_completed = False

    path = _config_path()
    if path.exists():
        raw = yaml.safe_load(path.read_text()) or {}
        raw["setup_completed"] = False
        with open(path, "w") as f:
            yaml.dump(raw, f, default_flow_style=False, sort_keys=False)

    logger.info("Setup has been reset")
    return {"message": "Setup reset", "setup_completed": False}
