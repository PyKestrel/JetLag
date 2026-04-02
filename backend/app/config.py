import os
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel, Field, model_validator
from pydantic_settings import BaseSettings


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


class LANPort(BaseModel):
    """A single LAN (client-facing) interface, optionally VLAN-tagged."""
    interface: str            # physical interface, e.g. "eth1"
    ip: str = "10.0.1.1"
    subnet: str = "10.0.1.0/24"
    vlan_id: int | None = None  # if set, creates e.g. eth1.100
    vlan_name: str = ""        # human-readable label
    enabled: bool = True
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


class UpdatesConfig(BaseModel):
    """Configuration for the OTA update system."""
    auto_check: bool = True
    check_interval_hours: int = 6
    github_repo: str = "PyKestrel/JetLag"
    channel: str = "stable"  # "stable" = non-prerelease only; "beta" = include prereleases
    auto_download: bool = False


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

        # Keep legacy fields in sync with first entries
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


def load_config(config_path: Optional[str] = None) -> AppConfig:
    if config_path is None:
        config_path = os.environ.get(
            "JETLAG_CONFIG",
            str(Path(__file__).parent.parent.parent / "config" / "jetlag.yaml"),
        )

    path = Path(config_path)
    if path.exists():
        with open(path, "r") as f:
            raw = yaml.safe_load(f) or {}
        return AppConfig(**raw)

    return AppConfig()


settings = load_config()
