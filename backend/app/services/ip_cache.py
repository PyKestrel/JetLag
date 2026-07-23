"""Tiny TTL cache of recently-authenticated client IPs.

The captive-portal middleware performs a DB lookup for every DNAT'd request to
decide whether to self-heal a client's firewall entry. Browsers fire many
sub-requests (assets, favicons, retries) in quick succession, so without a
cache a single page load can trigger a burst of identical DB round-trips.

This cache remembers "IP X was authenticated" for a short TTL so repeat hits
within the window skip the database entirely. It is intentionally tiny and
process-local — correctness still comes from the DB; this is only a fast path.
"""

import threading
import time
from typing import Optional


class AuthedIPCache:
    def __init__(self, ttl_seconds: float = 30.0, max_entries: int = 4096):
        self._ttl = ttl_seconds
        self._max = max_entries
        self._data: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    def get(self, ip: str) -> Optional[str]:
        """Return the cached MAC for *ip* if present and unexpired, else None."""
        now = time.monotonic()
        with self._lock:
            entry = self._data.get(ip)
            if entry is None:
                return None
            mac, expiry = entry
            if expiry < now:
                self._data.pop(ip, None)
                return None
            return mac

    def set(self, ip: str, mac: str) -> None:
        now = time.monotonic()
        with self._lock:
            # Opportunistic eviction of expired entries when the cache grows.
            if len(self._data) >= self._max:
                for k in [k for k, (_, exp) in self._data.items() if exp < now]:
                    self._data.pop(k, None)
                # Still full? drop the soonest-to-expire entry.
                if len(self._data) >= self._max:
                    oldest = min(self._data, key=lambda k: self._data[k][1])
                    self._data.pop(oldest, None)
            self._data[ip] = (mac, now + self._ttl)

    def invalidate(self, ip: str) -> None:
        with self._lock:
            self._data.pop(ip, None)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


# Shared instance used by the captive-portal middleware.
authed_ip_cache = AuthedIPCache()
