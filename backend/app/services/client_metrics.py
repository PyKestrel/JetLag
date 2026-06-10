"""Per-client live throughput, derived from conntrack accounting.

Reads ``/proc/net/nf_conntrack`` (which exposes per-flow byte counters when
``net.netfilter.nf_conntrack_acct`` is enabled) and diffs successive samples to
compute per-client upload/download rates. Counting is done per-flow so that
flows expiring between samples don't corrupt the totals.

Degrades gracefully: on non-Linux hosts or when accounting is unavailable the
service simply reports no data.
"""

import logging
import platform
import subprocess
import time
from typing import Optional

logger = logging.getLogger("jetlag.client_metrics")

_IS_LINUX = platform.system() == "Linux"
_CONNTRACK_PATH = "/proc/net/nf_conntrack"

# Previous per-flow byte totals: flow_key -> (orig_bytes, reply_bytes)
_prev_flows: dict[str, tuple[int, int]] = {}
_prev_ts: Optional[float] = None
_acct_enabled = False


def _ensure_acct() -> None:
    """Best-effort enable of conntrack byte accounting (idempotent)."""
    global _acct_enabled
    if _acct_enabled or not _IS_LINUX:
        return
    try:
        subprocess.run(
            ["sysctl", "-w", "net.netfilter.nf_conntrack_acct=1"],
            capture_output=True,
            timeout=5,
        )
        _acct_enabled = True
    except Exception as exc:  # pragma: no cover - environment dependent
        logger.debug(f"Could not enable conntrack accounting: {exc}")


def _parse_kv(token: str) -> Optional[tuple[str, str]]:
    if "=" not in token:
        return None
    k, _, v = token.partition("=")
    return k, v


def _read_flows() -> dict[str, tuple[str, int, int]]:
    """Return flow_key -> (client_ip, orig_bytes, reply_bytes).

    ``client_ip`` is the originating source address (the LAN client for
    NAT-ed, client-initiated flows). Flows without two ``bytes=`` fields
    (accounting disabled) are skipped.
    """
    flows: dict[str, tuple[str, int, int]] = {}
    try:
        with open(_CONNTRACK_PATH, "r") as fh:
            lines = fh.readlines()
    except OSError:
        return flows

    for line in lines:
        parts = line.split()
        orig_src = orig_dst = None
        sport = dport = None
        bytes_vals: list[int] = []
        proto = parts[2] if len(parts) > 2 else "?"
        seen_src = False
        for tok in parts:
            kv = _parse_kv(tok)
            if not kv:
                continue
            k, v = kv
            if k == "src" and orig_src is None:
                orig_src = v
                seen_src = True
            elif k == "dst" and orig_dst is None:
                orig_dst = v
            elif k == "sport" and sport is None:
                sport = v
            elif k == "dport" and dport is None:
                dport = v
            elif k == "bytes":
                try:
                    bytes_vals.append(int(v))
                except ValueError:
                    pass
        if orig_src is None or len(bytes_vals) < 2:
            continue
        # orig direction = upload (client -> server); reply = download
        orig_bytes, reply_bytes = bytes_vals[0], bytes_vals[1]
        key = f"{proto}|{orig_src}|{orig_dst}|{sport}|{dport}"
        flows[key] = (orig_src, orig_bytes, reply_bytes)
        _ = seen_src
    return flows


class ClientMetricsService:
    @staticmethod
    def sample() -> dict:
        """Compute per-client throughput since the previous call.

        Returns ``{ "supported": bool, "clients": { ip: {rx_bps, tx_bps} } }``.
        ``rx`` is download (to the client), ``tx`` is upload (from the client).
        """
        global _prev_flows, _prev_ts

        if not _IS_LINUX:
            return {"supported": False, "clients": {}}

        _ensure_acct()
        now = time.time()
        current = _read_flows()

        if not current:
            # Either no flows or accounting unavailable.
            _prev_flows = {}
            _prev_ts = now
            return {"supported": True, "clients": {}}

        interval = (now - _prev_ts) if _prev_ts else 0
        per_client: dict[str, dict] = {}

        if interval > 0:
            for key, (client_ip, orig_bytes, reply_bytes) in current.items():
                prev = _prev_flows.get(key)
                if prev is None:
                    # New flow this interval — count its full byte total.
                    d_orig, d_reply = orig_bytes, reply_bytes
                else:
                    d_orig = max(0, orig_bytes - prev[0])
                    d_reply = max(0, reply_bytes - prev[1])
                if d_orig == 0 and d_reply == 0:
                    continue
                entry = per_client.setdefault(client_ip, {"rx_bytes": 0, "tx_bytes": 0})
                entry["tx_bytes"] += d_orig    # upload from client
                entry["rx_bytes"] += d_reply   # download to client

        clients = {
            ip: {
                "rx_bps": round(v["rx_bytes"] * 8 / interval) if interval > 0 else 0,
                "tx_bps": round(v["tx_bytes"] * 8 / interval) if interval > 0 else 0,
            }
            for ip, v in per_client.items()
        }

        _prev_flows = {k: (v[1], v[2]) for k, v in current.items()}
        _prev_ts = now

        return {"supported": True, "clients": clients}
