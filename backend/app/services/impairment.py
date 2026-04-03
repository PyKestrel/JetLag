import asyncio
import logging
import platform
from typing import Optional

from app.config import settings

logger = logging.getLogger("jetlag.impairment")

_IS_LINUX = platform.system() == "Linux"
_initialized = False
_ifb_initialized = False

# IFB device name used for inbound (ingress) shaping
_IFB_DEV = "ifb0"


class _HalvedProfile:
    """Proxy that halves additive impairment values for split-direction application.

    When direction='both', the user-entered value (e.g. 500ms latency) should produce
    500ms total RTT, so each direction gets half (250ms).  Probability-based values
    (loss, corruption, reorder, duplicate) are NOT halved — they are per-packet rates.
    """

    _HALVED_ATTRS = frozenset({
        'latency_ms', 'jitter_ms',
        'bandwidth_limit_kbps', 'bandwidth_ceil_kbps', 'bandwidth_burst_kbytes',
    })

    def __init__(self, profile):
        self._profile = profile

    def __getattr__(self, name):
        value = getattr(self._profile, name)
        if name in self._HALVED_ATTRS and isinstance(value, (int, float)) and value > 0:
            return type(value)(max(1, value // 2) if isinstance(value, int) else value / 2)
        return value


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
        # Offset by 100 to avoid collision with default class 1:99
        return f"1:{100 + profile_id}"

    @staticmethod
    async def _iface_exists(iface: str) -> bool:
        """Check if a network interface exists."""
        _, _, rc = await ImpairmentService._run(f"ip link show {iface} 2>/dev/null")
        return rc == 0

    @staticmethod
    async def _init_ifb(iface: str):
        """Set up IFB device and ingress redirect for inbound shaping."""
        global _ifb_initialized
        if _ifb_initialized:
            return

        # Load the ifb kernel module
        await ImpairmentService._run("modprobe ifb numifbs=1")

        # Bring up the IFB device
        await ImpairmentService._run(f"ip link set dev {_IFB_DEV} up")

        # Clear any existing ingress qdisc on the real interface
        await ImpairmentService._run(f"tc qdisc del dev {iface} ingress 2>/dev/null")

        # Add ingress qdisc on the real interface
        out, err, rc = await ImpairmentService._run(
            f"tc qdisc add dev {iface} handle ffff: ingress"
        )
        if rc != 0:
            logger.error(f"Failed to add ingress qdisc on {iface}: {err}")
            return

        # Redirect all ingress traffic to the IFB device
        await ImpairmentService._run(
            f"tc filter add dev {iface} parent ffff: protocol ip u32 "
            f"match u32 0 0 action mirred egress redirect dev {_IFB_DEV}"
        )

        # Set up HTB root qdisc on the IFB device
        await ImpairmentService._run(f"tc qdisc del dev {_IFB_DEV} root 2>/dev/null")
        out, err, rc = await ImpairmentService._run(
            f"tc qdisc add dev {_IFB_DEV} root handle 1: htb default 99"
        )
        if rc != 0:
            logger.error(f"Failed to add root qdisc on {_IFB_DEV}: {err}")
            return

        # Default class on IFB: unlimited
        await ImpairmentService._run(
            f"tc class add dev {_IFB_DEV} parent 1: classid 1:99 htb rate 1000mbit"
        )

        _ifb_initialized = True
        logger.info(f"IFB device {_IFB_DEV} initialized for inbound shaping on {iface}")

    @staticmethod
    async def initialize():
        """Set up root qdisc on the LAN interface."""
        global _initialized
        if not _IS_LINUX:
            logger.info("Skipping tc initialization (not Linux)")
            return

        if not settings.setup_completed:
            logger.info("Skipping tc initialization (setup not completed)")
            return

        iface = settings.network.lan_interface

        if not await ImpairmentService._iface_exists(iface):
            logger.warning(f"LAN interface '{iface}' not found — skipping tc initialization")
            return

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

        _initialized = True
        logger.info(f"tc root qdisc initialized on {iface}")

    @staticmethod
    async def _apply_on_device(dev: str, profile, mirror_filters: bool = False) -> Optional[str]:
        """Apply HTB class + netem qdisc + filters on a specific device.

        When mirror_filters is True, src/dst IP and subnet fields in match
        rules are swapped so that return traffic is correctly matched on the
        IFB (ingress) device.
        """
        pid = profile.id
        classid = ImpairmentService._build_classid(pid)

        # Remove existing filters and class for this profile (if any)
        await ImpairmentService._remove_filters(dev, pid)
        await ImpairmentService._run(
            f"tc class del dev {dev} classid {classid} 2>/dev/null"
        )

        # Determine bandwidth rate
        rate = f"{profile.bandwidth_limit_kbps}kbit" if profile.bandwidth_limit_kbps > 0 else "1000mbit"
        ceil = f"{profile.bandwidth_ceil_kbps}kbit" if getattr(profile, 'bandwidth_ceil_kbps', 0) > 0 else rate
        burst = ""
        if getattr(profile, 'bandwidth_burst_kbytes', 0) > 0:
            burst = f" burst {profile.bandwidth_burst_kbytes}k"

        # Add HTB class
        out, err, rc = await ImpairmentService._run(
            f"tc class add dev {dev} parent 1: classid {classid} htb rate {rate} ceil {ceil}{burst}"
        )
        if rc != 0:
            logger.error(f"Failed to add HTB class on {dev} for profile {pid}: {err}")
            return err

        # Build netem parameters — full tc/netem option set
        netem_params = []

        # Latency / Jitter
        if profile.latency_ms > 0:
            delay_str = f"delay {profile.latency_ms}ms"
            if profile.jitter_ms > 0:
                delay_str += f" {profile.jitter_ms}ms"
                corr = getattr(profile, 'latency_correlation', 0)
                if corr > 0:
                    delay_str += f" {corr}%"
            dist = getattr(profile, 'latency_distribution', '')
            if dist and profile.jitter_ms > 0:
                delay_str += f" distribution {dist}"
            netem_params.append(delay_str)

        # Packet Loss
        if profile.packet_loss_percent > 0:
            loss_str = f"loss {profile.packet_loss_percent}%"
            corr = getattr(profile, 'loss_correlation', 0)
            if corr > 0:
                loss_str += f" {corr}%"
            netem_params.append(loss_str)

        # Packet Corruption
        if getattr(profile, 'corruption_percent', 0) > 0:
            corrupt_str = f"corrupt {profile.corruption_percent}%"
            corr = getattr(profile, 'corruption_correlation', 0)
            if corr > 0:
                corrupt_str += f" {corr}%"
            netem_params.append(corrupt_str)

        # Packet Duplication
        if getattr(profile, 'duplicate_percent', 0) > 0:
            dup_str = f"duplicate {profile.duplicate_percent}%"
            corr = getattr(profile, 'duplicate_correlation', 0)
            if corr > 0:
                dup_str += f" {corr}%"
            netem_params.append(dup_str)

        # Packet Reordering (requires delay to be set)
        if getattr(profile, 'reorder_percent', 0) > 0 and profile.latency_ms > 0:
            reorder_str = f"reorder {profile.reorder_percent}%"
            corr = getattr(profile, 'reorder_correlation', 0)
            if corr > 0:
                reorder_str += f" {corr}%"
            netem_params.append(reorder_str)

        if netem_params:
            netem_str = " ".join(netem_params)
            out, err, rc = await ImpairmentService._run(
                f"tc qdisc add dev {dev} parent {classid} netem {netem_str}"
            )
            if rc != 0:
                logger.error(f"Failed to add netem on {dev} for profile {pid}: {err}")
                return err

        # Add filters for match rules
        for rule in profile.match_rules:
            if mirror_filters:
                filter_cmd = ImpairmentService._build_filter_mirrored(dev, pid, classid, rule)
            else:
                filter_cmd = ImpairmentService._build_filter(dev, pid, classid, rule)
            if filter_cmd:
                out, err, rc = await ImpairmentService._run(filter_cmd)
                if rc != 0:
                    logger.warning(f"Failed to add filter on {dev} for rule {rule.id}: {err}")

        return None

    @staticmethod
    async def _remove_on_device(dev: str, profile_id: int):
        """Remove HTB class + filters for a profile on a specific device."""
        classid = ImpairmentService._build_classid(profile_id)
        await ImpairmentService._remove_filters(dev, profile_id)
        out, err, rc = await ImpairmentService._run(
            f"tc class del dev {dev} classid {classid} 2>/dev/null"
        )
        if rc != 0:
            logger.warning(f"Failed to remove class on {dev} for profile {profile_id}: {err}")

    @staticmethod
    async def apply_profile(profile) -> Optional[str]:
        """Apply a tc/netem impairment profile.

        Depending on profile.direction:
          - 'outbound': apply on the LAN interface (egress)
          - 'inbound':  apply on the IFB device (ingress via redirect)
          - 'both':     apply on both devices
        """
        if not _IS_LINUX:
            logger.info(f"Skipping apply_profile (not Linux): {profile.name}")
            return None

        # Lazy-initialize if tc hasn't been set up yet
        if not _initialized:
            await ImpairmentService.initialize()
            if not _initialized:
                logger.warning(f"Cannot apply profile '{profile.name}' — tc not initialized")
                return "tc not initialized (LAN interface may not exist)"

        iface = settings.network.lan_interface
        direction = getattr(profile, 'direction', 'outbound') or 'outbound'
        devices = []

        if direction in ('outbound', 'both'):
            devices.append(iface)
        if direction in ('inbound', 'both'):
            await ImpairmentService._init_ifb(iface)
            if _ifb_initialized:
                devices.append(_IFB_DEV)
            else:
                logger.error("Cannot apply inbound rules — IFB device not initialized")
                if direction == 'inbound':
                    return "IFB device initialization failed"

        # When applying to both directions, halve additive values so the
        # total round-trip matches the user's intended value.
        effective_profile = _HalvedProfile(profile) if direction == 'both' else profile

        for dev in devices:
            # When direction is 'both', mirror the filter src/dst on the IFB
            # device so return traffic (where the target IP is the source)
            # is correctly matched.
            mirror = (direction == 'both' and dev == _IFB_DEV)
            err = await ImpairmentService._apply_on_device(dev, effective_profile, mirror_filters=mirror)
            if err:
                return err

        logger.info(f"Applied impairment profile {profile.id} ({direction}): {profile.name}")
        return None

    @staticmethod
    def _build_filter_mirrored(iface: str, profile_id: int, classid: str, rule) -> Optional[str]:
        """Build a tc filter with src/dst IP and subnet fields swapped.

        Used on the IFB device when direction='both' so that return traffic
        (where the original dst_ip is now the source) is matched correctly.
        """
        match_parts = []

        # Swap: original dst_ip becomes src match, original src_ip becomes dst match
        if rule.dst_ip and rule.dst_ip != '0.0.0.0':
            match_parts.append(f"match ip src {ImpairmentService._normalize_ip(rule.dst_ip)}")
        if rule.src_ip and rule.src_ip != '0.0.0.0':
            match_parts.append(f"match ip dst {ImpairmentService._normalize_ip(rule.src_ip)}")
        if rule.dst_subnet and rule.dst_subnet != '0.0.0.0/0':
            match_parts.append(f"match ip src {rule.dst_subnet}")
        if rule.src_subnet and rule.src_subnet != '0.0.0.0/0':
            match_parts.append(f"match ip dst {rule.src_subnet}")

        # Protocol and port stay the same direction
        if rule.protocol == "tcp":
            match_parts.append("match ip protocol 6 0xff")
        elif rule.protocol == "udp":
            match_parts.append("match ip protocol 17 0xff")
        elif rule.protocol == "icmp":
            match_parts.append("match ip protocol 1 0xff")
        if rule.port:
            match_parts.append(f"match ip sport {rule.port} 0xffff")

        if not match_parts:
            match_parts.append("match u32 0 0 at 0")

        match_str = " ".join(match_parts)
        prio = 10 + profile_id

        return (
            f"tc filter add dev {iface} parent 1:0 protocol ip prio {prio} "
            f"u32 {match_str} flowid {classid}"
        )

    @staticmethod
    def _normalize_ip(ip: str) -> str:
        """Ensure an IP has CIDR notation for tc u32 matching."""
        return ip if '/' in ip else f"{ip}/32"

    @staticmethod
    def _build_filter(iface: str, profile_id: int, classid: str, rule) -> Optional[str]:
        """Build a tc filter command from a match rule."""
        # Use u32 filter for IP-based matching
        match_parts = []

        if rule.src_ip and rule.src_ip != '0.0.0.0':
            match_parts.append(f"match ip src {ImpairmentService._normalize_ip(rule.src_ip)}")
        if rule.dst_ip and rule.dst_ip != '0.0.0.0':
            match_parts.append(f"match ip dst {ImpairmentService._normalize_ip(rule.dst_ip)}")
        if rule.src_subnet and rule.src_subnet != '0.0.0.0/0':
            match_parts.append(f"match ip src {rule.src_subnet}")
        if rule.dst_subnet and rule.dst_subnet != '0.0.0.0/0':
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
            # No specific criteria — match all traffic
            match_parts.append("match u32 0 0 at 0")

        match_str = " ".join(match_parts)
        prio = 10 + profile_id

        return (
            f"tc filter add dev {iface} parent 1:0 protocol ip prio {prio} "
            f"u32 {match_str} flowid {classid}"
        )

    @staticmethod
    async def _remove_filters(iface: str, profile_id: int):
        """Remove all tc filter rules for a given profile."""
        prio = 10 + profile_id
        # Delete all filters at this priority (may fail if none exist, that's OK)
        await ImpairmentService._run(
            f"tc filter del dev {iface} parent 1:0 prio {prio} 2>/dev/null"
        )

    @staticmethod
    async def remove_profile(profile) -> Optional[str]:
        """Remove tc classes, qdiscs, and filters for a profile."""
        if not _IS_LINUX:
            logger.info(f"Skipping remove_profile (not Linux): {profile.name}")
            return None

        iface = settings.network.lan_interface
        direction = getattr(profile, 'direction', 'outbound') or 'outbound'

        # Remove from outbound (LAN interface)
        if direction in ('outbound', 'both'):
            await ImpairmentService._remove_on_device(iface, profile.id)

        # Remove from inbound (IFB device)
        if direction in ('inbound', 'both') and _ifb_initialized:
            await ImpairmentService._remove_on_device(_IFB_DEV, profile.id)

        logger.info(f"Removed impairment profile {profile.id} ({direction}): {profile.name}")
        return None

    @staticmethod
    async def remove_all():
        """Tear down all tc rules and re-initialize."""
        global _ifb_initialized
        if not _IS_LINUX:
            logger.info("Skipping remove_all (not Linux)")
            return

        # Re-initialize outbound
        await ImpairmentService.initialize()

        # Tear down IFB if it was set up
        if _ifb_initialized:
            await ImpairmentService._run(f"tc qdisc del dev {_IFB_DEV} root 2>/dev/null")
            _ifb_initialized = False

        logger.info("All impairment profiles removed, tc re-initialized")
