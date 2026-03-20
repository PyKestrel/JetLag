import asyncio
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger("jetlag.firewall")


class FirewallService:
    """Wrapper around nftables for captive portal interception and NAT."""

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
    async def initialize():
        """Set up base nftables ruleset: NAT, DNS interception, HTTP/HTTPS redirect."""
        lan = settings.network.lan_interface
        wan = settings.network.wan_interface
        portal_ip = settings.network.lan_ip

        ruleset = f"""
flush ruleset

table inet jetlag {{
    set authenticated_ips {{
        type ipv4_addr
        flags dynamic,timeout
        timeout 24h
    }}

    chain prerouting {{
        type nat hook prerouting priority dstnat; policy accept;

        # Skip interception for authenticated clients
        iifname "{lan}" ip saddr @authenticated_ips accept

        # DNS interception: redirect all port 53 to local dnsmasq
        iifname "{lan}" udp dport 53 dnat to {portal_ip}:53
        iifname "{lan}" tcp dport 53 dnat to {portal_ip}:53

        # HTTP redirect to captive portal
        iifname "{lan}" tcp dport 80 dnat to {portal_ip}:80

        # HTTPS redirect to captive portal (self-signed intercept)
        iifname "{lan}" tcp dport 443 dnat to {portal_ip}:443
    }}

    chain postrouting {{
        type nat hook postrouting priority srcnat; policy accept;

        # Masquerade authenticated traffic going out WAN
        oifname "{wan}" masquerade
    }}

    chain forward {{
        type filter hook forward priority filter; policy drop;

        # Allow established/related
        ct state established,related accept

        # Allow authenticated clients to reach WAN
        iifname "{lan}" ip saddr @authenticated_ips oifname "{wan}" accept

        # Allow return traffic
        iifname "{wan}" oifname "{lan}" ct state established,related accept

        # Drop everything else from unauthenticated clients
        iifname "{lan}" oifname "{wan}" drop
    }}

    chain input {{
        type filter hook input priority filter; policy accept;

        # Allow all traffic to the appliance itself (DHCP, DNS, portal, admin)
        ct state established,related accept
        iifname "lo" accept
        iifname "{lan}" accept
        iifname "{wan}" tcp dport {{ 22 }} accept
    }}
}}
"""
        result_out, result_err, rc = await FirewallService._run(
            f"echo '{ruleset}' | nft -f -"
        )
        if rc != 0:
            logger.error(f"Failed to initialize nftables: {result_err}")
            raise RuntimeError(f"nftables init failed: {result_err}")
        logger.info("nftables base ruleset initialized")

    @staticmethod
    async def allow_client(ip: str, mac: Optional[str] = None):
        """Add client IP to the authenticated set, lifting interception."""
        cmd = f"nft add element inet jetlag authenticated_ips {{ {ip} }}"
        out, err, rc = await FirewallService._run(cmd)
        if rc != 0:
            logger.error(f"Failed to allow client {ip}: {err}")
        else:
            logger.info(f"Client {ip} ({mac}) added to authenticated set")

    @staticmethod
    async def intercept_client(ip: str, mac: Optional[str] = None):
        """Remove client IP from authenticated set, re-enabling interception."""
        cmd = f"nft delete element inet jetlag authenticated_ips {{ {ip} }}"
        out, err, rc = await FirewallService._run(cmd)
        if rc != 0:
            logger.warning(f"Failed to remove client {ip} from auth set: {err}")
        else:
            logger.info(f"Client {ip} ({mac}) removed from authenticated set")

    @staticmethod
    async def reset_all():
        """Remove all IPs from the authenticated set."""
        cmd = "nft flush set inet jetlag authenticated_ips"
        out, err, rc = await FirewallService._run(cmd)
        if rc != 0:
            logger.error(f"Failed to flush authenticated set: {err}")
        else:
            logger.info("All clients removed from authenticated set")

    @staticmethod
    async def get_authenticated_ips() -> list[str]:
        """List all currently authenticated IPs from nftables set."""
        cmd = "nft list set inet jetlag authenticated_ips -j"
        out, err, rc = await FirewallService._run(cmd)
        if rc != 0:
            return []
        import json
        try:
            data = json.loads(out)
            for item in data.get("nftables", []):
                if "set" in item:
                    return item["set"].get("elem", [])
        except (json.JSONDecodeError, KeyError):
            pass
        return []
