import asyncio
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel, Field, model_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger("jetlag.config")

# Serializes all mutate+persist sequences on the global ``settings`` singleton
# so two concurrent requests can't interleave writes and corrupt jetlag.yaml.
config_lock = asyncio.Lock()


# ── MTU bounds ───────────────────────────────────────────────────
# Minimum is the IPv4 minimum reassembly buffer; maximum covers common
# jumbo-frame configs (9216) without allowing absurd values.
MTU_MIN = 576
MTU_MAX = 9216


def validate_mtu(value: Optional[int]) -> Optional[int]:
    """Return the MTU unchanged if valid, else raise ValueError.

    ``None`` is allowed and means "leave the interface default untouched".
    """
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("MTU must be an integer")
    if not (MTU_MIN <= value <= MTU_MAX):
        raise ValueError(f"MTU must be between {MTU_MIN} and {MTU_MAX}")
    return value


# ── Port-level models ────────────────────────────────────────────

class PortDHCPConfig(BaseModel):
    """DHCP settings scoped to a single LAN port / VLAN."""
    enabled: bool = True
    range_start: str = "10.0.1.100"
    range_end: str = "10.0.1.250"
    lease_time: str = "1h"
    gateway: str = "10.0.1.1"
    dns_server: str = "10.0.1.1"


class WANPort(BaseModel):
    """A single WAN (upstream) interface."""
    interface: str
    enabled: bool = True
    # Optional link MTU. None = leave the driver/OS default untouched.
    mtu: int | None = None


class LANPort(BaseModel):
    """A single LAN (client-facing) interface, optionally VLAN-tagged."""
    interface: str            # physical interface, e.g. "eth1"
    ip: str = "10.0.1.1"
    subnet: str = "10.0.1.0/24"
    vlan_id: int | None = None  # if set, creates e.g. eth1.100
    vlan_name: str = ""        # human-readable label
    enabled: bool = True
    # Optional link MTU. None = leave the driver/OS default untouched.
    mtu: int | None = None
    dhcp: PortDHCPConfig = Field(default_factory=PortDHCPConfig)

    @property
    def effective_interface(self) -> str:
        """Return the VLAN sub-interface name if a VLAN tag is configured."""
        if self.vlan_id is not None:
            return f"{self.interface}.{self.vlan_id}"
        return self.interface


# ── Legacy compat wrappers (used by code that still references single-port) ──

class NetworkConfig(BaseModel):
    """Legacy single-interface view. Kept for backward-compatible YAML parsing."""
    wan_interface: str = "eth0"
    lan_interface: str = "eth1"
    lan_ip: str = "10.0.1.1"
    lan_subnet: str = "10.0.1.0/24"


class DHCPConfig(BaseModel):
    """Legacy single-DHCP view."""
    enabled: bool = True
    range_start: str = "10.0.1.100"
    range_end: str = "10.0.1.250"
    lease_time: str = "1h"
    gateway: str = "10.0.1.1"
    dns_server: str = "10.0.1.1"


class VLANConfig(BaseModel):
    """Legacy VLAN entry (kept for backward compat YAML loading)."""
    id: int
    name: str
    interface: str
    ip: str
    subnet: str
    dhcp_range_start: str
    dhcp_range_end: str


class DNSConfig(BaseModel):
    spoof_target: str = "10.0.1.1"
    upstream_servers: list[str] = ["1.1.1.1", "8.8.8.8"]


class PortalConfig(BaseModel):
    http_port: int = 80
    https_port: int = 443
    ssl_cert: str = "/etc/jetlag/ssl/portal.crt"
    ssl_key: str = "/etc/jetlag/ssl/portal.key"
    ssl_cn: str = "wifi.airline.com"
    # Portal type: click_through | web_login | tiered | time_limited | walled_garden
    portal_type: str = "click_through"
    # Web-login credentials (portal_type == "web_login")
    login_username: str = "guest"
    login_password: str = "guest"
    # Time-limited session duration in minutes (portal_type == "time_limited")
    session_duration_minutes: int = 60
    # Tiered plan names/durations in minutes (portal_type == "tiered")
    tiered_plans: list[dict] = [
        {"name": "Basic (30 min)", "duration_minutes": 30},
        {"name": "Standard (2 hr)", "duration_minutes": 120},
        {"name": "Premium (unlimited)", "duration_minutes": 0},
    ]
    # Walled garden: allowed domains even when unauthenticated
    walled_garden_domains: list[str] = []
    # Redirect URL after auth
    redirect_url: str = "https://www.google.com"
    # Custom welcome message
    welcome_message: str = "Welcome aboard! Please accept the terms to continue."


class AdminConfig(BaseModel):
    api_port: int = 8080
    frontend_port: int = 3000
    # When True, the admin API + UI require login. Captive-portal endpoints
    # (/api/portal/*) and health/version always stay open to LAN clients.
    auth_enabled: bool = True
    # Hours before an issued admin token expires.
    token_expire_hours: int = 12


class UpdatesConfig(BaseModel):
    """Configuration for the OTA update system."""
    auto_check: bool = True
    check_interval_hours: int = 6
    github_repo: str = "PyKestrel/JetLag"
    channel: str = "stable"  # "stable" = non-prerelease only; "beta" = include prereleases
    auto_download: bool = False


class WirelessConfig(BaseModel):
    """Configuration for the optional WLAN access point (hostapd).

    When hotspot_mode is True the appliance runs in single-WLAN-card mode:
    the physical WLAN card stays connected to the internet (WAN) while a
    virtual AP interface (e.g. ap0) is created on the same radio to act as
    the LAN side.  The virtual interface is registered as a LAN port and
    hostapd is started on it automatically.
    """
    enabled: bool = False
    hotspot_mode: bool = False
    # Physical WLAN interface used as WAN (station) when hotspot_mode is True
    wan_interface: str = ""
    # Virtual AP interface name created by iw (e.g. "ap0")
    virtual_interface: str = "ap0"
    # Interface that hostapd binds to — physical iface normally, virtual in hotspot mode
    interface: str = "wlan0"
    ssid: str = "JetLag-WiFi"
    channel: int = 6
    hw_mode: str = "g"                 # a = 5GHz, g = 2.4GHz
    ieee80211n: bool = True            # 802.11n (HT)
    ieee80211ac: bool = False          # 802.11ac (VHT) — requires hw_mode=a
    wpa: int = 2                       # 0 = open, 2 = WPA2
    wpa_passphrase: str = "JetLag1234"
    wpa_key_mgmt: str = "WPA-PSK"
    rsn_pairwise: str = "CCMP"
    country_code: str = "US"
    # Network: the WLAN AP gets its own subnet for DHCP
    ip: str = "10.0.2.1"
    subnet: str = "10.0.2.0/24"
    dhcp_range_start: str = "10.0.2.100"
    dhcp_range_end: str = "10.0.2.250"
    dhcp_lease_time: str = "1h"
    # Bridge mode: if True, bridge WLAN into the primary LAN port (no separate subnet)
    bridge_to_lan: bool = False
    max_clients: int = 32
    # Hidden SSID
    hidden: bool = False
    # Optional link MTU for the AP interface. None = leave driver/OS default.
    mtu: int | None = None


class CapturesConfig(BaseModel):
    output_dir: str = "/var/lib/jetlag/captures"
    max_file_size_mb: int = 100


class LoggingConfig(BaseModel):
    level: str = "INFO"
    file: str = "/var/log/jetlag/jetlag.log"
    max_size_mb: int = 50
    backup_count: int = 5


# ── Top-level app config ────────────────────────────────────────

class AppConfig(BaseModel):
    setup_completed: bool = False

    # New multi-port lists
    wan_ports: list[WANPort] = []
    lan_ports: list[LANPort] = []

    # Legacy single-interface fields (populated from wan_ports / lan_ports)
    network: NetworkConfig = NetworkConfig()
    dhcp: DHCPConfig = DHCPConfig()
    vlans: list[VLANConfig] = []

    dns: DNSConfig = DNSConfig()
    portal: PortalConfig = PortalConfig()
    admin: AdminConfig = AdminConfig()
    updates: UpdatesConfig = UpdatesConfig()
    wireless: WirelessConfig = WirelessConfig()
    captures: CapturesConfig = CapturesConfig()
    logging: LoggingConfig = LoggingConfig()

    @model_validator(mode="after")
    def _sync_legacy(self) -> "AppConfig":
        """If new-style port lists are empty, seed them from legacy fields.
        If port lists are present, keep legacy fields in sync with the first entries."""
        # Seed from legacy when loading an old config that has no port lists
        if not self.wan_ports and self.network.wan_interface:
            self.wan_ports = [WANPort(interface=self.network.wan_interface)]
        if not self.lan_ports and self.network.lan_interface:
            primary_dhcp = PortDHCPConfig(
                enabled=self.dhcp.enabled,
                range_start=self.dhcp.range_start,
                range_end=self.dhcp.range_end,
                lease_time=self.dhcp.lease_time,
                gateway=self.dhcp.gateway,
                dns_server=self.dhcp.dns_server,
            )
            self.lan_ports = [LANPort(
                interface=self.network.lan_interface,
                ip=self.network.lan_ip,
                subnet=self.network.lan_subnet,
                dhcp=primary_dhcp,
            )]
            # Migrate old-style VLANs into additional lan_ports
            for v in self.vlans:
                self.lan_ports.append(LANPort(
                    interface=v.interface.split(".")[0] if "." in v.interface else v.interface,
                    ip=v.ip,
                    subnet=v.subnet,
                    vlan_id=v.id,
                    vlan_name=v.name,
                    dhcp=PortDHCPConfig(
                        enabled=True,
                        range_start=v.dhcp_range_start,
                        range_end=v.dhcp_range_end,
                        lease_time=self.dhcp.lease_time,
                        gateway=v.ip,
                        dns_server=v.ip,
                    ),
                ))

        # Keep legacy fields in sync with the *first* entries only.
        #
        # WARNING: the legacy ``network``/``dhcp`` scalars can represent a
        # single port. When more than one WAN/LAN port is configured they
        # mirror only ``[0]``; any code still reading ``settings.network.*`` or
        # ``settings.dhcp.*`` therefore sees just the primary port. New code
        # must iterate ``wan_ports`` / ``lan_ports`` instead. We log here so a
        # silent multi-port desync is at least visible in the logs.
        if len(self.wan_ports) > 1 or len(self.lan_ports) > 1:
            logger.debug(
                "Multi-port config (%d WAN, %d LAN): legacy network/dhcp fields "
                "mirror only the first port; consumers must use the port lists.",
                len(self.wan_ports),
                len(self.lan_ports),
            )
        if self.wan_ports:
            self.network.wan_interface = self.wan_ports[0].interface
        if self.lan_ports:
            p = self.lan_ports[0]
            self.network.lan_interface = p.effective_interface
            self.network.lan_ip = p.ip
            self.network.lan_subnet = p.subnet
            self.dhcp.enabled = p.dhcp.enabled
            self.dhcp.range_start = p.dhcp.range_start
            self.dhcp.range_end = p.dhcp.range_end
            self.dhcp.lease_time = p.dhcp.lease_time
            self.dhcp.gateway = p.dhcp.gateway
            self.dhcp.dns_server = p.dhcp.dns_server

        return self

    # ── Convenience helpers used throughout the codebase ──

    def all_lan_interfaces(self) -> list[str]:
        """Return all effective LAN interface names (including VLAN sub-interfaces)."""
        return [p.effective_interface for p in self.lan_ports if p.enabled]

    def all_lan_ips(self) -> list[str]:
        """Return all LAN IPs (one per port)."""
        return [p.ip for p in self.lan_ports if p.enabled]

    def all_wan_interfaces(self) -> list[str]:
        """Return all WAN interface names."""
        return [p.interface for p in self.wan_ports if p.enabled]


def config_path() -> Path:
    """Resolve the on-disk config path (honors the JETLAG_CONFIG override)."""
    return Path(
        os.environ.get(
            "JETLAG_CONFIG",
            str(Path(__file__).parent.parent.parent / "config" / "jetlag.yaml"),
        )
    )


def load_config(config_path_arg: Optional[str] = None) -> AppConfig:
    path = Path(config_path_arg) if config_path_arg else config_path()
    if path.exists():
        with open(path, "r") as f:
            raw = yaml.safe_load(f) or {}
        return AppConfig(**raw)

    return AppConfig()


def serialize_config(cfg: "AppConfig") -> dict:
    """Return the canonical YAML-serializable dict for *cfg*.

    Single source of truth for what gets written to jetlag.yaml — used by both
    the setup and settings routers so no section is ever accidentally dropped.
    """
    return {
        "setup_completed": cfg.setup_completed,
        "wan_ports": [p.model_dump() for p in cfg.wan_ports],
        "lan_ports": [p.model_dump() for p in cfg.lan_ports],
        "network": cfg.network.model_dump(),
        "dhcp": cfg.dhcp.model_dump(),
        "vlans": [v.model_dump() for v in cfg.vlans],
        "dns": cfg.dns.model_dump(),
        "portal": cfg.portal.model_dump(),
        "admin": cfg.admin.model_dump(),
        "updates": cfg.updates.model_dump(),
        "wireless": cfg.wireless.model_dump(),
        "captures": cfg.captures.model_dump(),
        "logging": cfg.logging.model_dump(),
    }


def _atomic_write_yaml(path: Path, data: dict) -> None:
    """Write *data* to *path* atomically (temp file in same dir + os.replace).

    A crash mid-write can never leave a half-written jetlag.yaml: the rename is
    atomic on POSIX and Windows, so readers always see either the old or the
    new complete file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".jetlag-", suffix=".yaml.tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w") as f:
            yaml.dump(data, f, default_flow_style=False, sort_keys=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


async def persist_config(cfg: Optional["AppConfig"] = None) -> dict:
    """Serialize *cfg* (default: the global singleton) and write it atomically.

    The blocking file IO runs in a worker thread so the event loop is never
    stalled. Callers that mutate ``settings`` and then persist should hold
    :data:`config_lock` across the whole mutate+persist to stay race-free.
    """
    cfg = cfg if cfg is not None else settings
    data = serialize_config(cfg)
    await asyncio.to_thread(_atomic_write_yaml, config_path(), data)
    return data


settings = load_config()
