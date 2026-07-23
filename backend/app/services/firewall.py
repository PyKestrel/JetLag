import asyncio
import logging
import os
import re
import tempfile
from typing import Optional

from app.config import settings

logger = logging.getLogger("jetlag.firewall")

# Characters permitted in a free-text nftables comment.
_COMMENT_RE = re.compile(r"[^A-Za-z0-9 _.\-]")


class FirewallService:
    """Wrapper around nftables for captive portal interception and NAT."""

    @staticmethod
    async def _run(cmd: str) -> tuple[str, str, int]:
        from app.services.command import run_shell
        return await run_shell(cmd)

    @staticmethod
    async def _apply_ruleset(ruleset: str) -> tuple[str, str, int]:
        """Load a full nftables ruleset via a temp file (avoids shell quoting).

        Using ``nft -f <file>`` instead of ``echo '...' | nft -f -`` means the
        ruleset can safely contain any character (quotes, semicolons, etc.).
        """
        fd, path = tempfile.mkstemp(prefix="jetlag-nft-", suffix=".conf")
        try:
            with os.fdopen(fd, "w") as f:
                f.write(ruleset)
            return await FirewallService._run(f"nft -f {path}")
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

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
        result_out, result_err, rc = await FirewallService._apply_ruleset(ruleset)
        if rc != 0:
            logger.error(f"Failed to initialize nftables: {result_err}")
            raise RuntimeError(f"nftables init failed: {result_err}")
        logger.info(f"nftables initialized: LAN={lan_ifaces}, WAN={wan_ifaces}")

    @staticmethod
    async def is_client_allowed(ip: str) -> bool:
        """Check if a client IP is currently in the nftables authenticated set."""
        current = await FirewallService.get_authenticated_ips()
        # Elements may be plain strings or dicts with "val" key depending on nft version
        for elem in current:
            if isinstance(elem, str) and elem == ip:
                return True
            if isinstance(elem, dict) and elem.get("val") == ip:
                return True
        return False

    @staticmethod
    async def allow_client(ip: str, mac: Optional[str] = None):
        """Add client IP to the authenticated set, lifting interception.

        Uses 'timeout 24h' on each add so re-adding refreshes the expiry.
        """
        cmd = f"nft add element inet jetlag authenticated_ips {{ {ip} timeout 24h }}"
        out, err, rc = await FirewallService._run(cmd)
        if rc != 0:
            # Element may already exist — try delete + re-add to refresh timeout
            await FirewallService._run(
                f"nft delete element inet jetlag authenticated_ips {{ {ip} }}"
            )
            out, err, rc = await FirewallService._run(cmd)
            if rc != 0:
                logger.error(f"Failed to allow client {ip}: {err}")
                return
        logger.info(f"Client {ip} ({mac}) added to authenticated set")

        # Schedule a deferred conntrack flush so stale DNAT mappings from
        # captive-portal interception don't corrupt post-auth traffic.
        # The flush is delayed because the auth response itself travels on a
        # DNAT'd connection; flushing immediately would destroy that NAT
        # mapping and prevent the redirect URL from reaching the browser.
        async def _deferred_ct_flush():
            await asyncio.sleep(2)
            ct_cmd = f"conntrack -D -s {ip} 2>/dev/null; conntrack -D -d {ip} 2>/dev/null"
            await FirewallService._run(ct_cmd)
            logger.debug(f"Flushed conntrack entries for {ip}")

        asyncio.create_task(_deferred_ct_flush())

    @staticmethod
    async def intercept_client(ip: str, mac: Optional[str] = None):
        """Remove client IP from authenticated set, re-enabling interception."""
        # Drop any cached "authenticated" fast-path entry so the middleware
        # can't immediately re-allow a client we're revoking.
        from app.services.ip_cache import authed_ip_cache
        authed_ip_cache.invalidate(ip)

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
        from app.services.ip_cache import authed_ip_cache
        authed_ip_cache.clear()

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
    async def apply_custom_rules(rules) -> dict:
        """Flush and rebuild custom_forward / custom_input chains from DB rules.

        Rules are expected to be a list of FirewallRule model instances (or any
        object with the same attributes).

        Returns a summary dict ``{"applied", "failed", "total"}`` where ``failed``
        is a list of ``{"id", "name", "error"}`` so callers can surface exactly
        which rules could not be applied and why.
        """
        results: dict = {"applied": 0, "failed": [], "total": len(rules)}

        # Flush existing custom chains (create them if they don't exist yet)
        for chain in ("custom_forward", "custom_input"):
            # Ensure chain exists (ignore "already exists" noise)
            await FirewallService._run(
                f"nft add chain inet jetlag {chain} 2>/dev/null"
            )
            # Flush it — a failure here usually means the base ruleset is missing
            # (firewall not initialized), which would make every rule fail.
            _, ferr, frc = await FirewallService._run(
                f"nft flush chain inet jetlag {chain}"
            )
            if frc != 0:
                emsg = ferr.strip() or f"could not prepare chain {chain}"
                logger.error(
                    f"Firewall: cannot prepare chain {chain} "
                    f"(is the base ruleset initialized?): {emsg}"
                )
                results["failed"].append(
                    {"id": None, "name": f"chain:{chain}", "error": emsg}
                )

        for rule in rules:
            nft_rule, build_err = FirewallService._build_nft_rule(rule)
            if build_err:
                logger.error(
                    f"Firewall rule {rule.id} ({rule.name}) is invalid: {build_err}"
                )
                results["failed"].append(
                    {"id": rule.id, "name": rule.name, "error": build_err}
                )
                continue
            chain = "custom_input" if rule.direction == "inbound" else "custom_forward"
            # Apply via `nft -f <file>` (not the shell) so values containing
            # spaces or special characters — e.g. a comment "Block UDP" — are
            # lexed by nft itself and not mangled by shell quote-stripping.
            script = f"add rule inet jetlag {chain} {nft_rule}\n"
            out, err, rc = await FirewallService._apply_ruleset(script)
            if rc != 0:
                emsg = err.strip() or "nft command failed"
                logger.error(
                    f"Failed to apply rule {rule.id} ({rule.name}): {emsg} | rule: {nft_rule}"
                )
                results["failed"].append(
                    {"id": rule.id, "name": rule.name, "error": emsg}
                )
            else:
                results["applied"] += 1
                logger.debug(f"Applied rule {rule.id} to {chain}: {nft_rule}")

        logger.info(
            f"Firewall apply: {results['applied']}/{results['total']} rules applied, "
            f"{len(results['failed'])} failed"
        )
        return results

    # ── Validation helpers (prevent shell/nft injection from DB values) ──

    @staticmethod
    def _valid_ip(value: str) -> bool:
        """Accept a single IPv4 address or CIDR network."""
        import ipaddress
        try:
            if "/" in value:
                ipaddress.IPv4Network(value, strict=False)
            else:
                ipaddress.IPv4Address(value)
            return True
        except (ValueError, TypeError):
            return False

    @staticmethod
    def _valid_port(value: str) -> bool:
        """Accept a single port (1-65535) or an inclusive range 'a-b'."""
        value = str(value).strip()
        m = re.fullmatch(r"(\d{1,5})(?:-(\d{1,5}))?", value)
        if not m:
            return False
        lo = int(m.group(1))
        hi = int(m.group(2)) if m.group(2) else lo
        return 0 < lo <= hi <= 65535

    @staticmethod
    def _build_nft_rule(rule) -> tuple[Optional[str], Optional[str]]:
        """Convert a FirewallRule model instance into an nftables rule string.

        All values originate from the database and are validated/escaped before
        interpolation so a malicious rule name or field can't inject nft/shell
        syntax.

        Returns a ``(rule_string, error)`` tuple: on success ``(str, None)``; if
        the rule is invalid, ``(None, reason)`` so callers can surface why.
        """
        parts = []

        # Protocol match
        proto = getattr(rule, "protocol", "any") or "any"
        if proto not in ("tcp", "udp", "icmp", "any"):
            return None, f"invalid protocol {proto!r}"
        # A port match (e.g. "tcp dport 443") already implies the L4 protocol.
        # Only emit an explicit protocol match when no port match is present.
        has_port = bool((rule.src_port or rule.dst_port) and proto in ("tcp", "udp"))
        if proto != "any" and not has_port:
            # In an `inet` table, protocol matching must go through meta l4proto;
            # a bare "tcp"/"udp"/"icmp" token is invalid nftables syntax.
            parts.append(f"meta l4proto {proto}")

        # Source IP
        if rule.src_ip:
            if not FirewallService._valid_ip(rule.src_ip):
                return None, f"invalid source IP {rule.src_ip!r}"
            parts.append(f"ip saddr {rule.src_ip}")

        # Destination IP
        if rule.dst_ip:
            if not FirewallService._valid_ip(rule.dst_ip):
                return None, f"invalid destination IP {rule.dst_ip!r}"
            parts.append(f"ip daddr {rule.dst_ip}")

        # Source port (requires tcp/udp)
        if rule.src_port and proto in ("tcp", "udp"):
            if not FirewallService._valid_port(rule.src_port):
                return None, f"invalid source port {rule.src_port!r}"
            parts.append(f"{proto} sport {rule.src_port}")

        # Destination port (requires tcp/udp)
        if rule.dst_port and proto in ("tcp", "udp"):
            if not FirewallService._valid_port(rule.dst_port):
                return None, f"invalid destination port {rule.dst_port!r}"
            parts.append(f"{proto} dport {rule.dst_port}")

        # Action
        action = getattr(rule, "action", "drop") or "drop"
        if action not in ("accept", "drop", "reject"):
            return None, f"invalid action {action!r}"
        parts.append(action)

        # Comment — strip to an allowlisted character set
        comment = getattr(rule, "comment", None) or getattr(rule, "name", "")
        if comment:
            safe = _COMMENT_RE.sub("", comment)[:64].strip()
            if safe:
                parts.append(f'comment "{safe}"')

        return " ".join(parts), None

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
