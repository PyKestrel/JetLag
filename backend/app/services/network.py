import asyncio
import logging
import platform
from typing import Optional

from app.config import settings

logger = logging.getLogger("jetlag.network")

_IS_LINUX = platform.system() == "Linux"


class NetworkService:
    """Utilities for ARP lookups and LAN host discovery."""

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
    async def arp_lookup(ip: str) -> Optional[str]:
        """Resolve an IP address to a MAC address via the kernel ARP table.

        Returns the MAC string (e.g. 'aa:bb:cc:dd:ee:ff') or None.
        """
        if not _IS_LINUX:
            return None

        # Method 1: ip neigh show (most reliable on modern Linux)
        out, _, rc = await NetworkService._run(f"ip neigh show {ip}")
        if rc == 0 and out.strip():
            # Example output: "10.100.123.50 dev ens18 lladdr aa:bb:cc:dd:ee:ff REACHABLE"
            for part in out.strip().split():
                if ":" in part and len(part) == 17:
                    return part.lower()

        # Method 2: fall back to /proc/net/arp
        try:
            with open("/proc/net/arp", "r") as f:
                for line in f:
                    fields = line.split()
                    if len(fields) >= 4 and fields[0] == ip:
                        mac = fields[3]
                        if mac != "00:00:00:00:00:00":
                            return mac.lower()
        except OSError:
            pass

        return None

    @staticmethod
    async def get_arp_table() -> list[dict]:
        """Return all entries from the kernel ARP / neighbour table.

        Each entry is a dict with keys: ip, mac, interface, state.
        """
        if not _IS_LINUX:
            return []

        entries: list[dict] = []

        out, _, rc = await NetworkService._run("ip -4 neigh show")
        if rc != 0:
            return entries

        for line in out.strip().splitlines():
            # "10.100.123.50 dev ens18 lladdr aa:bb:cc:dd:ee:ff REACHABLE"
            parts = line.split()
            if len(parts) < 4:
                continue

            ip = parts[0]
            mac = None
            iface = None
            state = parts[-1] if parts[-1].isalpha() else "UNKNOWN"

            for i, p in enumerate(parts):
                if p == "dev" and i + 1 < len(parts):
                    iface = parts[i + 1]
                if p == "lladdr" and i + 1 < len(parts):
                    mac = parts[i + 1].lower()

            if mac and mac != "00:00:00:00:00:00":
                entries.append({
                    "ip": ip,
                    "mac": mac,
                    "interface": iface,
                    "state": state,
                })

        return entries

    @staticmethod
    async def get_lan_neighbours() -> list[dict]:
        """Return ARP entries filtered to the LAN interface only."""
        lan = settings.network.lan_interface
        all_entries = await NetworkService.get_arp_table()
        return [e for e in all_entries if e.get("interface") == lan]

    @staticmethod
    async def ping_sweep(subnet: Optional[str] = None) -> int:
        """Send a fast ping sweep to populate the ARP table.

        Uses nmap if available, otherwise falls back to fping.
        Returns the number of hosts that responded.
        """
        if not _IS_LINUX:
            return 0

        target = subnet or settings.network.lan_subnet

        # Try fping first (fast, parallel)
        out, _, rc = await NetworkService._run(
            f"fping -a -q -g {target} -r 1 -t 200 2>/dev/null"
        )
        if rc in (0, 1) and out.strip():
            return len(out.strip().splitlines())

        # Fallback: nmap ping scan
        out, _, rc = await NetworkService._run(
            f"nmap -sn -n --min-rate 100 {target} 2>/dev/null"
        )
        if rc == 0:
            # Count lines containing "Host is up"
            return sum(1 for line in out.splitlines() if "Host is up" in line)

        return 0
