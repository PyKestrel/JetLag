import os
import platform
import subprocess
import logging
from pathlib import Path
from typing import Optional

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings, NetworkConfig, DHCPConfig, DNSConfig, WANPort, LANPort, PortDHCPConfig, WirelessConfig
from app.services.dnsmasq import DnsmasqService
from app.services.firewall import FirewallService
from app.services.impairment import ImpairmentService
from app.services.hostapd import HostapdService

logger = logging.getLogger("jetlag.setup")

router = APIRouter(prefix="/api/setup", tags=["setup"])


def _config_path() -> Path:
    return Path(
        os.environ.get(
            "JETLAG_CONFIG",
            str(Path(__file__).parent.parent.parent.parent / "config" / "jetlag.yaml"),
        )
    )


def _is_wlan_interface(name: str) -> bool:
    """Check whether an interface is wireless (has /sys/class/net/<name>/wireless)."""
    if platform.system() != "Linux":
        return False
    return Path(f"/sys/class/net/{name}/wireless").exists()


def _wlan_supports_ap(name: str) -> bool:
    """Return True if the WLAN interface's phy supports AP mode.

    Parses ``iw phy <phy> info`` looking for ``* AP`` in the
    "Supported interface modes" section.
    """
    if platform.system() != "Linux":
        return False
    try:
        # Resolve phy name from interface
        result = subprocess.run(
            ["iw", "dev", name, "info"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return False
        phy = None
        for line in result.stdout.splitlines():
            if "wiphy" in line:
                try:
                    phy = f"phy{line.split()[-1]}"
                except (IndexError, ValueError):
                    pass
        if not phy:
            return False

        # Query phy capabilities
        result2 = subprocess.run(
            ["iw", "phy", phy, "info"],
            capture_output=True, text=True, timeout=5,
        )
        if result2.returncode != 0:
            return False

        in_modes_section = False
        for line in result2.stdout.splitlines():
            stripped = line.strip()
            if "Supported interface modes" in stripped:
                in_modes_section = True
                continue
            if in_modes_section:
                if stripped.startswith("*"):
                    mode = stripped.lstrip("* ").strip()
                    if mode == "AP":
                        return True
                else:
                    # Left the supported modes section
                    break
    except Exception as e:
        logger.warning(f"Failed to check AP support for {name}: {e}")
    return False


def _detect_interfaces() -> list[dict]:
    """Detect available network interfaces with their addresses and status.

    VLAN sub-interfaces (e.g. ``ens20.100``) are excluded because JetLag
    creates them automatically when a VLAN ID is specified on a LAN port.
    Interfaces already assigned as WAN or LAN ports are also excluded.

    Each entry includes ``is_wlan`` and ``supports_ap`` booleans so the
    frontend can offer hotspot mode when only a single WLAN card is present.
    """
    interfaces = []
    system = platform.system()

    # Build a set of interface names already in use
    used_ifaces: set[str] = set()
    for wp in settings.wan_ports:
        used_ifaces.add(wp.interface)
    for lp in settings.lan_ports:
        used_ifaces.add(lp.effective_interface)

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
                    # Skip VLAN sub-interfaces (e.g. ens20.100)
                    if "." in name:
                        continue
                    # Skip interfaces already assigned as WAN/LAN ports
                    if name in used_ifaces:
                        continue
                    state = iface.get("operstate", "UNKNOWN")
                    mac = iface.get("address", "")
                    ipv4_addrs = []
                    for addr_info in iface.get("addr_info", []):
                        if addr_info.get("family") == "inet":
                            ipv4_addrs.append(
                                f"{addr_info['local']}/{addr_info.get('prefixlen', 24)}"
                            )
                    is_wlan = _is_wlan_interface(name)
                    interfaces.append({
                        "name": name,
                        "mac": mac,
                        "state": state.upper(),
                        "ipv4_addresses": ipv4_addrs,
                        "has_link": state.upper() in ("UP",),
                        "is_wlan": is_wlan,
                        "supports_ap": _wlan_supports_ap(name) if is_wlan else False,
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
                "is_wlan": False,
                "supports_ap": False,
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
            "is_wlan": False,
            "supports_ap": False,
        },
        {
            "name": "eth1",
            "mac": "00:00:00:00:00:02",
            "state": "UP",
            "ipv4_addresses": [],
            "has_link": True,
            "is_wlan": False,
            "supports_ap": False,
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
        "wan_ports": [p.model_dump() for p in settings.wan_ports],
        "lan_ports": [p.model_dump() for p in settings.lan_ports],
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
    # Hotspot mode — single-WLAN-card AP
    hotspot_mode: bool = False
    hotspot_ssid: str = "JetLag-WiFi"
    hotspot_password: str = "JetLag1234"
    hotspot_channel: int = 6
    hotspot_hidden: bool = False


def _cleanup_orphaned_vlans():
    """Remove VLAN sub-interfaces from Linux that are not in the current config.

    This handles stale sub-interfaces left over from previous sessions
    (e.g. ens20.2222) that were created but never properly cleaned up.
    """
    if platform.system() != "Linux":
        return

    # Collect the set of VLAN sub-interfaces we *should* have
    expected_vlans: set[str] = set()
    for lp in settings.lan_ports:
        if lp.vlan_id is not None:
            expected_vlans.add(lp.effective_interface)

    try:
        import json as _json
        result = subprocess.run(
            ["ip", "-j", "link", "show", "type", "vlan"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return
        vlan_ifaces = _json.loads(result.stdout)
        for iface in vlan_ifaces:
            name = iface.get("ifname", "")
            if name and name not in expected_vlans:
                logger.info(f"Removing orphaned VLAN sub-interface: {name}")
                subprocess.run(
                    ["ip", "link", "delete", name],
                    capture_output=True, timeout=5,
                )
    except Exception as e:
        logger.warning(f"Failed to clean up orphaned VLAN interfaces: {e}")


def _persist_config():
    """Serialize the current in-memory settings to jetlag.yaml."""
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
        "wireless": settings.wireless.model_dump(),
        "captures": settings.captures.model_dump(),
        "logging": settings.logging.model_dump(),
    }
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        yaml.dump(config_data, f, default_flow_style=False, sort_keys=False)


def _configure_lan_port(lp: LANPort):
    """Configure a single LAN port (or VLAN sub-interface) on Linux."""
    import ipaddress as _ip
    iif = lp.effective_interface
    net = _ip.IPv4Network(lp.subnet, strict=False)
    prefix_len = net.prefixlen

    # Create VLAN sub-interface if needed
    if lp.vlan_id is not None:
        subprocess.run(
            ["ip", "link", "add", "link", lp.interface, "name", iif,
             "type", "vlan", "id", str(lp.vlan_id)],
            capture_output=True, timeout=5,
        )

    subprocess.run(
        ["ip", "addr", "flush", "dev", iif],
        capture_output=True, timeout=5,
    )
    subprocess.run(
        ["ip", "addr", "add", f"{lp.ip}/{prefix_len}", "dev", iif],
        capture_output=True, timeout=5,
    )
    subprocess.run(
        ["ip", "link", "set", iif, "up"],
        capture_output=True, timeout=5,
    )
    logger.info(f"LAN port {iif} configured with {lp.ip}/{prefix_len}")


async def _create_virtual_ap(wan_iface: str, ap_iface: str = "ap0") -> bool:
    """Create a virtual AP interface on the same phy as *wan_iface*.

    Uses ``iw dev <wan_iface> interface add <ap_iface> type managed``.
    hostapd will switch the interface to AP mode via nl80211.
    Returns True on success.
    """
    if platform.system() != "Linux":
        return False

    # Remove stale virtual interface if it already exists
    subprocess.run(
        ["iw", "dev", ap_iface, "del"],
        capture_output=True, timeout=5,
    )

    # Use 'type managed' — hostapd will switch to AP mode via nl80211.
    # Many drivers don't support 'type __ap' for virtual interfaces.
    result = subprocess.run(
        ["iw", "dev", wan_iface, "interface", "add", ap_iface, "type", "managed"],
        capture_output=True, text=True, timeout=5,
    )
    if result.returncode != 0:
        logger.error(f"Failed to create virtual AP {ap_iface}: {result.stderr}")
        return False

    # Bring the interface UP — 'managed' type interfaces can be brought up
    # manually, and hostapd will switch to AP mode when it starts.
    subprocess.run(
        ["ip", "link", "set", ap_iface, "up"],
        capture_output=True, timeout=5,
    )

    # Verify the interface was created
    check = subprocess.run(
        ["ip", "link", "show", ap_iface],
        capture_output=True, text=True, timeout=5,
    )
    logger.info(
        f"Virtual AP interface {ap_iface} created on {wan_iface} "
        f"(verify: rc={check.returncode}, out={check.stdout.strip()[:200]})"
    )
    return check.returncode == 0


@router.post("/complete")
async def complete_setup(payload: SetupRequest):
    """
    Finalize initial setup:
    1. Save WAN/LAN interface selections and network config to jetlag.yaml
    2. Mark setup as completed
    3. On a real appliance, start DHCP/DNS/firewall on all LAN interfaces
    4. If hotspot_mode, create virtual AP on the WAN WLAN card and start hostapd
    """
    # ── Hotspot mode: WAN == LAN is OK because we create a virtual AP iface
    if payload.hotspot_mode:
        if not _is_wlan_interface(payload.wan_interface):
            raise HTTPException(
                status_code=400,
                detail=f"{payload.wan_interface} is not a wireless interface.",
            )
        if not _wlan_supports_ap(payload.wan_interface):
            raise HTTPException(
                status_code=400,
                detail=f"{payload.wan_interface} does not support AP mode.",
            )
        # The virtual AP will be the LAN interface
        ap_iface = "ap0"
        payload.lan_interface = ap_iface
    elif payload.wan_interface == payload.lan_interface:
        raise HTTPException(
            status_code=400,
            detail="WAN and LAN interfaces must be different.",
        )

    # Build port lists from the initial setup payload
    settings.wan_ports = [WANPort(interface=payload.wan_interface)]
    settings.lan_ports = [LANPort(
        interface=payload.lan_interface,
        ip=payload.lan_ip,
        subnet=payload.lan_subnet,
        dhcp=PortDHCPConfig(
            enabled=payload.dhcp_enabled,
            range_start=payload.dhcp_range_start,
            range_end=payload.dhcp_range_end,
            lease_time=payload.dhcp_lease_time,
            gateway=payload.lan_ip,
            dns_server=payload.lan_ip,
        ),
    )]

    # Update legacy fields
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

    # Configure wireless / hotspot settings
    if payload.hotspot_mode:
        settings.wireless = WirelessConfig(
            enabled=True,
            hotspot_mode=True,
            wan_interface=payload.wan_interface,
            virtual_interface="ap0",
            interface="ap0",
            ssid=payload.hotspot_ssid,
            channel=payload.hotspot_channel,
            wpa=2,
            wpa_passphrase=payload.hotspot_password,
            hidden=payload.hotspot_hidden,
            ip=payload.lan_ip,
            subnet=payload.lan_subnet,
            dhcp_range_start=payload.dhcp_range_start,
            dhcp_range_end=payload.dhcp_range_end,
            dhcp_lease_time=payload.dhcp_lease_time,
        )

    settings.setup_completed = True

    # Persist to YAML
    try:
        _persist_config()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write config: {e}")

    logger.info(
        f"Setup complete: WAN={payload.wan_interface}, LAN={payload.lan_interface}, "
        f"LAN IP={payload.lan_ip}, hotspot_mode={payload.hotspot_mode}"
    )

    # Start services on Linux
    services_started = []
    services_failed = []

    if platform.system() == "Linux":
        # 0. Hotspot mode: create virtual AP interface + start hostapd
        if payload.hotspot_mode:
            try:
                ok = await _create_virtual_ap(payload.wan_interface, "ap0")
                if ok:
                    services_started.append("virtual_ap:ap0")
                else:
                    services_failed.append("virtual_ap: failed to create ap0")
            except Exception as e:
                logger.error(f"Failed to create virtual AP: {e}")
                services_failed.append(f"virtual_ap: {e}")

        # 1. Configure all LAN interfaces
        for lp in settings.lan_ports:
            try:
                _configure_lan_port(lp)
                services_started.append(f"lan:{lp.effective_interface}")
            except Exception as e:
                logger.error(f"Failed to configure LAN port {lp.effective_interface}: {e}")
                services_failed.append(f"lan:{lp.effective_interface}: {e}")

        # 1b. Start hostapd on the virtual AP interface (hotspot mode)
        if payload.hotspot_mode:
            try:
                result = await HostapdService.start()
                if result.get("success"):
                    services_started.append(f"hostapd:{settings.wireless.ssid}")
                else:
                    services_failed.append(f"hostapd: {result.get('error')}")
            except Exception as e:
                logger.error(f"Failed to start hostapd: {e}")
                services_failed.append(f"hostapd: {e}")

        # 2. Generate dnsmasq config and start the service
        try:
            await DnsmasqService.generate_config()
            await DnsmasqService.restart()
            services_started.append("dnsmasq")
        except Exception as e:
            logger.error(f"Failed to start dnsmasq: {e}")
            services_failed.append(f"dnsmasq: {e}")

        # 3. Initialize nftables firewall rules
        try:
            await FirewallService.initialize()
            services_started.append("nftables")
        except Exception as e:
            logger.error(f"Failed to initialize firewall: {e}")
            services_failed.append(f"nftables: {e}")

        # 4. Initialize tc/netem root qdisc for impairment shaping
        try:
            await ImpairmentService.initialize()
            services_started.append("tc_netem")
        except Exception as e:
            logger.error(f"Failed to initialize tc/netem: {e}")
            services_failed.append(f"tc_netem: {e}")

        # 5. Enable IP forwarding
        try:
            subprocess.run(
                ["sysctl", "-w", "net.ipv4.ip_forward=1"],
                capture_output=True, timeout=5,
            )
            services_started.append("ip_forwarding")
            logger.info("IP forwarding enabled")
        except Exception as e:
            logger.error(f"Failed to enable IP forwarding: {e}")
            services_failed.append(f"ip_forwarding: {e}")

    return {
        "message": "Setup completed successfully",
        "setup_completed": True,
        "wan_ports": [p.model_dump() for p in settings.wan_ports],
        "lan_ports": [p.model_dump() for p in settings.lan_ports],
        "network": settings.network.model_dump(),
        "dhcp": settings.dhcp.model_dump(),
        "dns": settings.dns.model_dump(),
        "services_started": services_started,
        "services_failed": services_failed,
        "hotspot_mode": payload.hotspot_mode,
    }


# ── Port management endpoints ─────────────────────────────────────


class AddWANPortRequest(BaseModel):
    interface: str
    enabled: bool = True


class AddLANPortRequest(BaseModel):
    interface: str
    ip: str
    subnet: str
    vlan_id: int | None = None
    vlan_name: str = ""
    enabled: bool = True
    dhcp_enabled: bool = True
    dhcp_range_start: str = ""
    dhcp_range_end: str = ""
    dhcp_lease_time: str = "1h"


@router.post("/ports/wan")
async def add_wan_port(payload: AddWANPortRequest):
    """Add a new WAN port to the appliance configuration."""
    # Prevent duplicates
    for p in settings.wan_ports:
        if p.interface == payload.interface:
            raise HTTPException(status_code=400, detail=f"WAN port {payload.interface} already exists")

    port = WANPort(interface=payload.interface, enabled=payload.enabled)
    settings.wan_ports.append(port)

    try:
        _persist_config()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write config: {e}")

    # Reload firewall to include new WAN port
    if settings.setup_completed and platform.system() == "Linux":
        try:
            await FirewallService.initialize()
        except Exception as e:
            logger.error(f"Failed to reload firewall after adding WAN port: {e}")

    logger.info(f"WAN port added: {payload.interface}")
    return {"message": f"WAN port {payload.interface} added", "wan_ports": [p.model_dump() for p in settings.wan_ports]}


@router.delete("/ports/wan/{interface}")
async def remove_wan_port(interface: str):
    """Remove a WAN port from the configuration."""
    original_len = len(settings.wan_ports)
    settings.wan_ports = [p for p in settings.wan_ports if p.interface != interface]
    if len(settings.wan_ports) == original_len:
        raise HTTPException(status_code=404, detail=f"WAN port {interface} not found")

    try:
        _persist_config()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write config: {e}")

    if settings.setup_completed and platform.system() == "Linux":
        try:
            await FirewallService.initialize()
        except Exception as e:
            logger.error(f"Failed to reload firewall after removing WAN port: {e}")

    logger.info(f"WAN port removed: {interface}")
    return {"message": f"WAN port {interface} removed", "wan_ports": [p.model_dump() for p in settings.wan_ports]}


@router.post("/ports/lan")
async def add_lan_port(payload: AddLANPortRequest):
    """Add a new LAN port (optionally with a VLAN tag) to the configuration."""
    effective = f"{payload.interface}.{payload.vlan_id}" if payload.vlan_id else payload.interface
    for p in settings.lan_ports:
        if p.effective_interface == effective:
            raise HTTPException(status_code=400, detail=f"LAN port {effective} already exists")

    dhcp = PortDHCPConfig(
        enabled=payload.dhcp_enabled,
        range_start=payload.dhcp_range_start or payload.ip.rsplit(".", 1)[0] + ".100",
        range_end=payload.dhcp_range_end or payload.ip.rsplit(".", 1)[0] + ".250",
        lease_time=payload.dhcp_lease_time,
        gateway=payload.ip,
        dns_server=payload.ip,
    )

    port = LANPort(
        interface=payload.interface,
        ip=payload.ip,
        subnet=payload.subnet,
        vlan_id=payload.vlan_id,
        vlan_name=payload.vlan_name,
        enabled=payload.enabled,
        dhcp=dhcp,
    )
    settings.lan_ports.append(port)

    try:
        _persist_config()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write config: {e}")

    # Configure the new interface and reload services
    if settings.setup_completed and platform.system() == "Linux":
        try:
            _configure_lan_port(port)
        except Exception as e:
            logger.error(f"Failed to configure new LAN port {effective}: {e}")

        try:
            await DnsmasqService.generate_config()
            await DnsmasqService.restart()
        except Exception as e:
            logger.error(f"Failed to reload dnsmasq after adding LAN port: {e}")

        try:
            await FirewallService.initialize()
        except Exception as e:
            logger.error(f"Failed to reload firewall after adding LAN port: {e}")

    logger.info(f"LAN port added: {effective} (ip={payload.ip}, vlan={payload.vlan_id})")
    return {"message": f"LAN port {effective} added", "lan_ports": [p.model_dump() for p in settings.lan_ports]}


@router.delete("/ports/lan/{interface}")
async def remove_lan_port(interface: str):
    """Remove a LAN port from the configuration. Use 'eth1.100' format for VLAN sub-interfaces."""
    original_len = len(settings.lan_ports)
    removed = [p for p in settings.lan_ports if p.effective_interface == interface]
    settings.lan_ports = [p for p in settings.lan_ports if p.effective_interface != interface]
    if len(settings.lan_ports) == original_len:
        raise HTTPException(status_code=404, detail=f"LAN port {interface} not found")

    try:
        _persist_config()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write config: {e}")

    if settings.setup_completed and platform.system() == "Linux":
        # Tear down the VLAN sub-interface if this was a VLAN port
        for p in removed:
            if p.vlan_id is not None:
                try:
                    subprocess.run(
                        ["ip", "link", "delete", p.effective_interface],
                        capture_output=True, timeout=5,
                    )
                    logger.info(f"VLAN sub-interface {p.effective_interface} removed")
                except Exception as e:
                    logger.error(f"Failed to remove VLAN sub-interface {p.effective_interface}: {e}")

        try:
            await DnsmasqService.generate_config()
            await DnsmasqService.restart()
        except Exception as e:
            logger.error(f"Failed to reload dnsmasq after removing LAN port: {e}")
        try:
            await FirewallService.initialize()
        except Exception as e:
            logger.error(f"Failed to reload firewall after removing LAN port: {e}")

    logger.info(f"LAN port removed: {interface}")
    return {"message": f"LAN port {interface} removed", "lan_ports": [p.model_dump() for p in settings.lan_ports]}


@router.get("/ports")
async def list_ports():
    """Return current WAN and LAN port configuration."""
    return {
        "wan_ports": [p.model_dump() for p in settings.wan_ports],
        "lan_ports": [p.model_dump() for p in settings.lan_ports],
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
