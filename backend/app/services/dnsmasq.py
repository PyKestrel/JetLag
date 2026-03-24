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
        """Generate the dnsmasq configuration file.

        Iterates over all configured LAN ports (including VLAN sub-interfaces)
        and creates per-port interface bindings and DHCP scopes.
        """
        cfg = settings
        lan_ports = cfg.lan_ports

        lines = [
            "# JetLag dnsmasq configuration — auto-generated",
            "bind-interfaces",
        ]

        # Listen addresses — one per LAN port
        listen_addrs = set()
        for lp in lan_ports:
            if not lp.enabled:
                continue
            iif = lp.effective_interface
            tag = f"lan_{iif.replace('.', '_')}"

            lines.append("")
            label = f"VLAN {lp.vlan_id} ({lp.vlan_name})" if lp.vlan_id is not None else iif
            lines.append(f"# LAN port: {label}")
            lines.append(f"interface={iif}")
            listen_addrs.add(lp.ip)

            if lp.dhcp.enabled:
                lines.append(
                    f"dhcp-range=set:{tag},{lp.dhcp.range_start},{lp.dhcp.range_end},{lp.dhcp.lease_time}"
                )
                lines.append(f"dhcp-option=tag:{tag},option:router,{lp.dhcp.gateway}")
                lines.append(f"dhcp-option=tag:{tag},option:dns-server,{lp.dhcp.dns_server}")

        # Listen addresses
        for addr in sorted(listen_addrs):
            lines.append(f"listen-address={addr}")

        # Upstream DNS
        lines.append("")
        lines.append("# Upstream DNS — forward all queries to real resolvers")
        lines.append("# Captive portal redirect is handled by nftables, not DNS spoofing")
        for server in cfg.dns.upstream_servers:
            lines.append(f"server={server}")

        lines.append("")
        lines.append("# Logging")
        lines.append("log-queries")
        lines.append("log-dhcp")
        lines.append("log-facility=/var/log/jetlag/dnsmasq.log")

        config_content = "\n".join(lines) + "\n"

        # Ensure log directory exists
        Path("/var/log/jetlag").mkdir(parents=True, exist_ok=True)

        conf_path = Path(DNSMASQ_CONF_PATH)
        conf_path.parent.mkdir(parents=True, exist_ok=True)
        conf_path.write_text(config_content)

        logger.info(f"dnsmasq config written to {DNSMASQ_CONF_PATH} ({len(lan_ports)} LAN ports)")
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
