import os
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel
from pydantic_settings import BaseSettings


class NetworkConfig(BaseModel):
    wan_interface: str = "eth0"
    lan_interface: str = "eth1"
    lan_ip: str = "10.0.1.1"
    lan_subnet: str = "10.0.1.0/24"


class DHCPConfig(BaseModel):
    enabled: bool = True
    range_start: str = "10.0.1.100"
    range_end: str = "10.0.1.250"
    lease_time: str = "1h"
    gateway: str = "10.0.1.1"
    dns_server: str = "10.0.1.1"


class VLANConfig(BaseModel):
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


class AdminConfig(BaseModel):
    api_port: int = 8080
    frontend_port: int = 3000


class CapturesConfig(BaseModel):
    output_dir: str = "/var/lib/jetlag/captures"
    max_file_size_mb: int = 100


class LoggingConfig(BaseModel):
    level: str = "INFO"
    file: str = "/var/log/jetlag/jetlag.log"
    max_size_mb: int = 50
    backup_count: int = 5


class AppConfig(BaseModel):
    network: NetworkConfig = NetworkConfig()
    dhcp: DHCPConfig = DHCPConfig()
    vlans: list[VLANConfig] = []
    dns: DNSConfig = DNSConfig()
    portal: PortalConfig = PortalConfig()
    admin: AdminConfig = AdminConfig()
    captures: CapturesConfig = CapturesConfig()
    logging: LoggingConfig = LoggingConfig()


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
