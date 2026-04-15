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
        """Set up base nftables ruleset: NAT, DNS interception, HTTP/HTTPS redirect.

        Supports multiple WAN and LAN ports (including VLAN sub-interfaces).
        """
        cfg = settings
        lan_ports = cfg.lan_ports
        wan_ports = cfg.wan_ports
        lan_ifaces = cfg.all_lan_interfaces()
        wan_ifaces = cfg.all_wan_interfaces()

        if not lan_ifaces or not wan_ifaces:
            logger.warning("No LAN or WAN ports configured — skipping nftables init")
            return

        # Build interface name sets for nftables
        lan_set = ", ".join(f'"{i}"' for i in lan_ifaces)   # "eth1", "eth1.100"
        wan_set = ", ".join(f'"{i}"' for i in wan_ifaces)   # "eth0"

        # Build per-LAN-port prerouting rules
        prerouting_rules = []
        for lp in lan_ports:
            if not lp.enabled:
                continue
            iif = lp.effective_interface
            portal_ip = lp.ip
            prerouting_rules.append(f'        iifname "{iif}" ip saddr @authenticated_ips accept')
            prerouting_rules.append(f'        iifname "{iif}" udp dport 53 dnat ip to {portal_ip}:53')
            prerouting_rules.append(f'        iifname "{iif}" tcp dport 53 dnat ip to {portal_ip}:53')
            prerouting_rules.append(f'        iifname "{iif}" tcp dport 80 dnat ip to {portal_ip}:8080')
            prerouting_rules.append(f'        iifname "{iif}" tcp dport 443 dnat ip to {portal_ip}:8080')
        prerouting_block = "\n".join(prerouting_rules)

        # Build per-WAN masquerade rules
        postrouting_rules = []
        for wi in wan_ifaces:
            postrouting_rules.append(f'        oifname "{wi}" masquerade')
        postrouting_block = "\n".join(postrouting_rules)

        # Build forward rules for all LAN↔WAN combinations
        forward_rules = ["        ct state established,related accept"]
        for li in lan_ifaces:
            for wi in wan_ifaces:
                forward_rules.append(f'        iifname "{li}" ip saddr @authenticated_ips oifname "{wi}" accept')
                forward_rules.append(f'        iifname "{wi}" oifname "{li}" ct state established,related accept')
                # Reject QUIC (UDP 443) from unauthenticated clients so browsers
                # get an ICMP error and fall back to TCP HTTPS immediately
                forward_rules.append(f'        iifname "{li}" oifname "{wi}" udp dport 443 reject')
                forward_rules.append(f'        iifname "{li}" oifname "{wi}" drop')
        forward_block = "\n".join(forward_rules)

        # Build input rules
        input_rules = [
            "        ct state established,related accept",
            '        iifname "lo" accept',
        ]
        for li in lan_ifaces:
            input_rules.append(f'        iifname "{li}" accept')
        for wi in wan_ifaces:
            input_rules.append(f'        iifname "{wi}" tcp dport {{ 22 }} accept')
        input_block = "\n".join(input_rules)

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
{prerouting_block}
    }}

    chain postrouting {{
        type nat hook postrouting priority srcnat; policy accept;
{postrouting_block}
    }}

    chain custom_forward {{
    }}

    chain custom_input {{
    }}

    chain forward {{
        type filter hook forward priority filter; policy drop;
        jump custom_forward
{forward_block}
    }}

    chain input {{
        type filter hook input priority filter; policy accept;
        jump custom_input
{input_block}
    }}
}}
"""
        result_out, result_err, rc = await FirewallService._run(
            f"echo '{ruleset}' | nft -f -"
        )
        if rc != 0:
            logger.error(f"Failed to initialize nftables: {result_err}")
            raise RuntimeError(f"nftables init failed: {result_err}")
        logger.info(f"nftables initialized: LAN={lan_ifaces}, WAN={wan_ifaces}")

    @staticmethod
    async def allow_client(ip: str, mac: Optional[str] = None):
        """Add client IP to the authenticated set, lifting interception."""
        cmd = f"nft add element inet jetlag authenticated_ips {{ {ip} }}"
        out, err, rc = await FirewallService._run(cmd)
        if rc != 0:
            logger.error(f"Failed to allow client {ip}: {err}")
        else:
            logger.info(f"Client {ip} ({mac}) added to authenticated set")

        # Flush conntrack entries for this client so stale DNAT mappings
        # from captive-portal interception don't corrupt post-auth traffic
        # (fixes ERR_QUIC_PROTOCOL_ERROR / stale NAT for HTTPS)
        ct_cmd = f"conntrack -D -s {ip} 2>/dev/null; conntrack -D -d {ip} 2>/dev/null"
        await FirewallService._run(ct_cmd)
        logger.debug(f"Flushed conntrack entries for {ip}")

    @staticmethod
    async def intercept_client(ip: str, mac: Optional[str] = None):
        """Remove client IP from authenticated set, re-enabling interception."""
        cmd = f"nft delete element inet jetlag authenticated_ips {{ {ip} }}"
        out, err, rc = await FirewallService._run(cmd)
        if rc != 0:
            logger.warning(f"Failed to remove client {ip} from auth set: {err}")
        else:
            logger.info(f"Client {ip} ({mac}) removed from authenticated set")

        # Tear down existing flows so they cannot bypass the captive portal via
        # the global "ct state established,related accept" forward rule.
        ct_cmd = f"conntrack -D -s {ip} 2>/dev/null; conntrack -D -d {ip} 2>/dev/null"
        await FirewallService._run(ct_cmd)
        logger.debug(f"Flushed conntrack entries after intercept for {ip}")

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

    # ── User-defined firewall rules ──────────────────────────────

    @staticmethod
    async def apply_custom_rules(rules) -> None:
        """Flush and rebuild custom_forward / custom_input chains from DB rules.

        Rules are expected to be a list of FirewallRule model instances (or any
        object with the same attributes).
        """
        # Flush existing custom chains (create them if they don't exist yet)
        for chain in ("custom_forward", "custom_input"):
            # Ensure chain exists
            await FirewallService._run(
                f"nft add chain inet jetlag {chain} 2>/dev/null"
            )
            # Flush it
            await FirewallService._run(
                f"nft flush chain inet jetlag {chain}"
            )

        for rule in rules:
            nft_rule = FirewallService._build_nft_rule(rule)
            if nft_rule:
                chain = "custom_input" if rule.direction == "inbound" else "custom_forward"
                cmd = f'nft add rule inet jetlag {chain} {nft_rule}'
                out, err, rc = await FirewallService._run(cmd)
                if rc != 0:
                    logger.error(f"Failed to apply rule {rule.id} ({rule.name}): {err}")
                else:
                    logger.debug(f"Applied rule {rule.id}: {cmd}")

        logger.info(f"Applied {len(rules)} custom firewall rules")

    @staticmethod
    def _build_nft_rule(rule) -> str:
        """Convert a FirewallRule model instance into an nftables rule string."""
        parts = []

        # Protocol match
        proto = getattr(rule, "protocol", "any") or "any"
        if proto != "any":
            parts.append(f"{proto}")

        # Source IP
        if rule.src_ip:
            parts.append(f"ip saddr {rule.src_ip}")

        # Destination IP
        if rule.dst_ip:
            parts.append(f"ip daddr {rule.dst_ip}")

        # Source port (requires tcp/udp)
        if rule.src_port:
            if proto in ("tcp", "udp"):
                parts.append(f"{proto} sport {rule.src_port}")
            else:
                # If protocol is 'any', we can't match a port without specifying
                # a transport protocol — skip port match
                pass

        # Destination port (requires tcp/udp)
        if rule.dst_port:
            if proto in ("tcp", "udp"):
                parts.append(f"{proto} dport {rule.dst_port}")
            else:
                pass

        # Action
        action = getattr(rule, "action", "drop") or "drop"
        parts.append(action)

        # Comment
        comment = getattr(rule, "comment", None) or getattr(rule, "name", "")
        if comment:
            safe = comment.replace('"', '\\"')[:64]
            parts.append(f'comment "{safe}"')

        return " ".join(parts)

    @staticmethod
    async def get_ruleset_summary() -> dict:
        """Return a summary of the current nftables ruleset."""
        out, err, rc = await FirewallService._run("nft list ruleset")
        if rc != 0:
            return {"error": err, "ruleset": ""}

        # Count chains and rules
        chains = out.count("chain ")
        rules = out.count(" accept") + out.count(" drop") + out.count(" reject") + out.count(" masquerade") + out.count(" dnat")

        return {
            "ruleset": out,
            "chains": chains,
            "rules_count": rules,
        }
