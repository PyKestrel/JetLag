import asyncio
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger("jetlag.impairment")


class ImpairmentService:
    """Wrapper around Linux tc/netem for network impairment."""

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
    def _build_handle(profile_id: int) -> str:
        """Generate a unique tc handle from profile ID."""
        return f"1:{profile_id}"

    @staticmethod
    def _build_classid(profile_id: int) -> str:
        return f"1:{profile_id}"

    @staticmethod
    async def initialize():
        """Set up root qdisc on the LAN interface."""
        iface = settings.network.lan_interface

        # Clear existing qdiscs (ignore errors if none exist)
        await ImpairmentService._run(f"tc qdisc del dev {iface} root 2>/dev/null")

        # Add HTB root qdisc
        out, err, rc = await ImpairmentService._run(
            f"tc qdisc add dev {iface} root handle 1: htb default 99"
        )
        if rc != 0:
            logger.error(f"Failed to add root qdisc: {err}")
            return

        # Default class: unlimited
        await ImpairmentService._run(
            f"tc class add dev {iface} parent 1: classid 1:99 htb rate 1000mbit"
        )

        logger.info(f"tc root qdisc initialized on {iface}")

    @staticmethod
    async def apply_profile(profile) -> Optional[str]:
        """Apply a tc/netem impairment profile.

        Creates:
          1. An HTB class for bandwidth shaping
          2. A netem qdisc for latency/jitter/loss
          3. tc filter rules based on match criteria
        """
        iface = settings.network.lan_interface
        pid = profile.id
        classid = ImpairmentService._build_classid(pid)

        # Remove existing class for this profile (if any)
        await ImpairmentService._run(
            f"tc class del dev {iface} classid {classid} 2>/dev/null"
        )

        # Determine bandwidth rate
        rate = f"{profile.bandwidth_limit_kbps}kbit" if profile.bandwidth_limit_kbps > 0 else "1000mbit"

        # Add HTB class
        out, err, rc = await ImpairmentService._run(
            f"tc class add dev {iface} parent 1: classid {classid} htb rate {rate}"
        )
        if rc != 0:
            logger.error(f"Failed to add HTB class for profile {pid}: {err}")
            return err

        # Build netem parameters
        netem_params = []
        if profile.latency_ms > 0:
            netem_params.append(f"delay {profile.latency_ms}ms")
            if profile.jitter_ms > 0:
                netem_params.append(f"{profile.jitter_ms}ms")
        if profile.packet_loss_percent > 0:
            netem_params.append(f"loss {profile.packet_loss_percent}%")

        if netem_params:
            netem_str = " ".join(netem_params)
            out, err, rc = await ImpairmentService._run(
                f"tc qdisc add dev {iface} parent {classid} netem {netem_str}"
            )
            if rc != 0:
                logger.error(f"Failed to add netem for profile {pid}: {err}")
                return err

        # Add filters for match rules
        for rule in profile.match_rules:
            filter_cmd = ImpairmentService._build_filter(iface, pid, classid, rule)
            if filter_cmd:
                out, err, rc = await ImpairmentService._run(filter_cmd)
                if rc != 0:
                    logger.warning(f"Failed to add filter for rule {rule.id}: {err}")

        logger.info(f"Applied impairment profile {pid}: {profile.name}")
        return None

    @staticmethod
    def _build_filter(iface: str, profile_id: int, classid: str, rule) -> Optional[str]:
        """Build a tc filter command from a match rule."""
        # Use u32 filter for IP-based matching
        match_parts = []

        if rule.src_ip:
            match_parts.append(f"match ip src {rule.src_ip}")
        if rule.dst_ip:
            match_parts.append(f"match ip dst {rule.dst_ip}")
        if rule.src_subnet:
            match_parts.append(f"match ip src {rule.src_subnet}")
        if rule.dst_subnet:
            match_parts.append(f"match ip dst {rule.dst_subnet}")
        if rule.protocol == "tcp":
            match_parts.append("match ip protocol 6 0xff")
        elif rule.protocol == "udp":
            match_parts.append("match ip protocol 17 0xff")
        elif rule.protocol == "icmp":
            match_parts.append("match ip protocol 1 0xff")
        if rule.port:
            match_parts.append(f"match ip dport {rule.port} 0xffff")

        if not match_parts:
            # No specific criteria — match all
            match_parts.append("match ip src 0.0.0.0/0")

        match_str = " ".join(match_parts)
        prio = 10 + profile_id

        return (
            f"tc filter add dev {iface} parent 1:0 protocol ip prio {prio} "
            f"u32 {match_str} flowid {classid}"
        )

    @staticmethod
    async def remove_profile(profile) -> Optional[str]:
        """Remove tc classes and filters for a profile."""
        iface = settings.network.lan_interface
        classid = ImpairmentService._build_classid(profile.id)

        out, err, rc = await ImpairmentService._run(
            f"tc class del dev {iface} classid {classid} 2>/dev/null"
        )
        if rc != 0:
            logger.warning(f"Failed to remove class for profile {profile.id}: {err}")

        logger.info(f"Removed impairment profile {profile.id}: {profile.name}")
        return None

    @staticmethod
    async def remove_all():
        """Tear down all tc rules and re-initialize."""
        await ImpairmentService.initialize()
        logger.info("All impairment profiles removed, tc re-initialized")
