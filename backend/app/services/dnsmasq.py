import asyncio
import logging
from pathlib import Path
from typing import Optional

from app.config import settings

logger = logging.getLogger("jetlag.dnsmasq")

DNSMASQ_CONF_PATH = "/etc/dnsmasq.d/jetlag.conf"
DNSMASQ_HOSTS_DIR = "/etc/jetlag/hosts"


class DnsmasqService:
    """Wrapper around dnsmasq for DHCP and DNS spoofing."""

    @staticmethod
    async def _run(cmd: str) -> tuple[str, str, int]:
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        return stdout.decode(), stderr.decode(), proc.returncode

    @staticmethod
    async def generate_config():
        """Generate the dnsmasq configuration file for captive portal mode."""
        cfg = settings
        lan = cfg.network.lan_interface
        lan_ip = cfg.network.lan_ip

        lines = [
            "# JetLag dnsmasq configuration — auto-generated",
            f"interface={lan}",
            f"listen-address={lan_ip}",
            "bind-interfaces",
            "",
            "# DHCP",
            f"dhcp-range={cfg.dhcp.range_start},{cfg.dhcp.range_end},{cfg.dhcp.lease_time}",
            f"dhcp-option=option:router,{cfg.dhcp.gateway}",
            f"dhcp-option=option:dns-server,{cfg.dhcp.dns_server}",
            "",
            "# Upstream DNS — forward all queries to real resolvers",
            "# Captive portal redirect is handled by nftables, not DNS spoofing",
        ]

        for server in cfg.dns.upstream_servers:
            lines.append(f"server={server}")

        # VLAN-specific DHCP ranges
        for vlan in cfg.vlans:
            lines.append("")
            lines.append(f"# VLAN {vlan.id}: {vlan.name}")
            lines.append(f"interface={vlan.interface}")
            lines.append(
                f"dhcp-range=set:vlan{vlan.id},{vlan.dhcp_range_start},{vlan.dhcp_range_end},{cfg.dhcp.lease_time}"
            )
            lines.append(f"dhcp-option=tag:vlan{vlan.id},option:router,{vlan.ip}")
            lines.append(f"dhcp-option=tag:vlan{vlan.id},option:dns-server,{vlan.ip}")

        lines.append("")
        lines.append("# Logging")
        lines.append("log-queries")
        lines.append("log-dhcp")
        lines.append(f"log-facility=/var/log/jetlag/dnsmasq.log")

        config_content = "\n".join(lines) + "\n"

        # Ensure log directory exists
        Path("/var/log/jetlag").mkdir(parents=True, exist_ok=True)

        conf_path = Path(DNSMASQ_CONF_PATH)
        conf_path.parent.mkdir(parents=True, exist_ok=True)
        conf_path.write_text(config_content)

        logger.info(f"dnsmasq config written to {DNSMASQ_CONF_PATH}")
        return config_content

    @staticmethod
    async def restart():
        """Restart the dnsmasq service."""
        out, err, rc = await DnsmasqService._run("systemctl restart dnsmasq")
        if rc != 0:
            logger.error(f"Failed to restart dnsmasq: {err}")
            raise RuntimeError(f"dnsmasq restart failed: {err}")
        logger.info("dnsmasq restarted")

    @staticmethod
    async def reload():
        """Send SIGHUP to dnsmasq to reload config."""
        out, err, rc = await DnsmasqService._run("systemctl reload dnsmasq")
        if rc != 0:
            logger.warning(f"dnsmasq reload failed, trying restart: {err}")
            await DnsmasqService.restart()
        else:
            logger.info("dnsmasq reloaded")

    @staticmethod
    async def get_leases() -> list[dict]:
        """Parse the dnsmasq lease file and return active leases."""
        lease_file = Path("/var/lib/misc/dnsmasq.leases")
        if not lease_file.exists():
            # Try alternate location
            lease_file = Path("/var/lib/dnsmasq/dnsmasq.leases")

        if not lease_file.exists():
            logger.warning("dnsmasq lease file not found")
            return []

        leases = []
        for line in lease_file.read_text().strip().splitlines():
            parts = line.split()
            if len(parts) >= 4:
                leases.append({
                    "expiry": parts[0],
                    "mac_address": parts[1],
                    "ip_address": parts[2],
                    "hostname": parts[3] if parts[3] != "*" else None,
                })

        return leases

    @staticmethod
    async def status() -> dict:
        """Check dnsmasq service status."""
        import platform
        if platform.system() != "Linux":
            return {"running": False, "status": "not available", "note": "dnsmasq requires Linux"}
        try:
            out, err, rc = await DnsmasqService._run(
                "systemctl is-active dnsmasq"
            )
            status_text = out.strip()
            active = status_text == "active"
            if active:
                return {"running": True, "status": "active"}
            # If setup hasn't been completed yet, show as not configured
            if not settings.setup_completed:
                return {"running": False, "status": "not configured"}
            return {"running": False, "status": status_text}
        except Exception:
            return {"running": False, "status": "not installed"}
