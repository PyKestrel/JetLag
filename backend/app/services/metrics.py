"""Live network metrics — per-interface throughput sampled from /proc/net/dev.

Rates are computed by diffing successive counter samples. A small in-memory
ring buffer keeps recent aggregate throughput so the UI can draw sparklines
without a time-series database.
"""

import asyncio
import datetime
import logging
import platform
import time
from collections import deque
from typing import Optional

from app.config import settings

logger = logging.getLogger("jetlag.metrics")

_IS_LINUX = platform.system() == "Linux"

# Background sampler / persistence tuning.
SAMPLE_INTERVAL_SECONDS = 10
RETENTION_HOURS = 24
# Hard cap on the number of points returned by a range query (downsampled).
MAX_RANGE_POINTS = 600

# Per-interface previous counter sample: iface -> (timestamp, rx_bytes, tx_bytes, rx_pkts, tx_pkts)
_prev_samples: dict[str, tuple[float, int, int, int, int]] = {}

# Rolling history of aggregate throughput samples (most recent last).
_HISTORY_MAXLEN = 120
_history: deque[dict] = deque(maxlen=_HISTORY_MAXLEN)


def _read_proc_net_dev() -> dict[str, dict]:
    """Parse /proc/net/dev into {iface: {rx_bytes, tx_bytes, rx_packets, tx_packets}}."""
    result: dict[str, dict] = {}
    try:
        with open("/proc/net/dev", "r") as f:
            lines = f.readlines()
    except OSError:
        return result

    for line in lines[2:]:  # skip the two header lines
        if ":" not in line:
            continue
        name, _, data = line.partition(":")
        name = name.strip()
        fields = data.split()
        if len(fields) < 16:
            continue
        # Field order: rx bytes packets errs drop fifo frame compressed multicast
        #              tx bytes packets errs drop fifo colls carrier compressed
        result[name] = {
            "rx_bytes": int(fields[0]),
            "rx_packets": int(fields[1]),
            "tx_bytes": int(fields[8]),
            "tx_packets": int(fields[9]),
        }
    return result


class MetricsService:
    """Computes per-interface throughput rates and keeps a short history."""

    @staticmethod
    def _tracked_interfaces() -> list[str]:
        """Interfaces we care about: configured LAN + WAN ports."""
        ifaces: list[str] = []
        try:
            ifaces.extend(settings.all_lan_interfaces())
            ifaces.extend(settings.all_wan_interfaces())
        except Exception:
            pass
        # De-duplicate while preserving order
        seen: set[str] = set()
        return [i for i in ifaces if i and not (i in seen or seen.add(i))]

    @staticmethod
    def sample() -> dict:
        """Return current per-interface rates and append an aggregate history point."""
        now = time.time()
        counters = _read_proc_net_dev() if _IS_LINUX else {}
        tracked = MetricsService._tracked_interfaces()

        interfaces: list[dict] = []
        agg_rx_bps = 0.0
        agg_tx_bps = 0.0

        for iface in tracked:
            cur = counters.get(iface)
            rx_bps = tx_bps = rx_pps = tx_pps = 0.0
            if cur:
                prev = _prev_samples.get(iface)
                if prev:
                    prev_t, prev_rx, prev_tx, prev_rxp, prev_txp = prev
                    dt = now - prev_t
                    if dt > 0:
                        rx_bps = max(0.0, (cur["rx_bytes"] - prev_rx) * 8 / dt)
                        tx_bps = max(0.0, (cur["tx_bytes"] - prev_tx) * 8 / dt)
                        rx_pps = max(0.0, (cur["rx_packets"] - prev_rxp) / dt)
                        tx_pps = max(0.0, (cur["tx_packets"] - prev_txp) / dt)
                _prev_samples[iface] = (
                    now,
                    cur["rx_bytes"],
                    cur["tx_bytes"],
                    cur["rx_packets"],
                    cur["tx_packets"],
                )
            interfaces.append({
                "interface": iface,
                "rx_bps": round(rx_bps),
                "tx_bps": round(tx_bps),
                "rx_pps": round(rx_pps),
                "tx_pps": round(tx_pps),
                "rx_bytes": (cur or {}).get("rx_bytes", 0),
                "tx_bytes": (cur or {}).get("tx_bytes", 0),
            })
            agg_rx_bps += rx_bps
            agg_tx_bps += tx_bps

        point = {
            "t": int(now * 1000),
            "rx_bps": round(agg_rx_bps),
            "tx_bps": round(agg_tx_bps),
        }
        _history.append(point)

        return {
            "timestamp": int(now * 1000),
            "interfaces": interfaces,
            "aggregate": {"rx_bps": round(agg_rx_bps), "tx_bps": round(agg_tx_bps)},
            "supported": _IS_LINUX,
        }

    @staticmethod
    def history() -> dict:
        return {"samples": list(_history), "supported": _IS_LINUX}

    @staticmethod
    async def persist_current() -> None:
        """Take a sample and persist the aggregate point, pruning old rows."""
        snapshot = MetricsService.sample()
        agg = snapshot["aggregate"]
        from app.database import async_session
        from app.models.metric_sample import MetricSample

        cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=RETENTION_HOURS)
        async with async_session() as db:
            db.add(MetricSample(rx_bps=int(agg["rx_bps"]), tx_bps=int(agg["tx_bps"])))
            from sqlalchemy import delete

            await db.execute(delete(MetricSample).where(MetricSample.ts < cutoff))
            await db.commit()

    @staticmethod
    async def range(minutes: int) -> dict:
        """Return persisted aggregate samples for the last ``minutes``.

        Results are downsampled to at most ``MAX_RANGE_POINTS`` evenly-spaced
        points so the payload (and chart) stays manageable for wide ranges.
        """
        from app.database import async_session
        from app.models.metric_sample import MetricSample
        from sqlalchemy import select

        since = datetime.datetime.utcnow() - datetime.timedelta(minutes=max(1, minutes))
        async with async_session() as db:
            result = await db.execute(
                select(MetricSample)
                .where(MetricSample.ts >= since)
                .order_by(MetricSample.ts.asc())
            )
            rows = result.scalars().all()

        stride = max(1, len(rows) // MAX_RANGE_POINTS)
        samples = [
            {
                "t": int(r.ts.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000),
                "rx_bps": r.rx_bps,
                "tx_bps": r.tx_bps,
            }
            for r in rows[::stride]
        ]
        return {"samples": samples, "minutes": minutes, "supported": _IS_LINUX}


async def metrics_sampler_loop() -> None:
    """Long-running background task; start from the app lifespan.

    Periodically samples throughput and persists an aggregate data point so the
    UI can render historical charts that survive restarts.
    """
    logger.info("Metrics sampler loop started")
    while True:
        try:
            await MetricsService.persist_current()
        except asyncio.CancelledError:
            logger.info("Metrics sampler loop stopped")
            raise
        except Exception as exc:
            logger.error(f"Metrics sampler error: {exc}")
        await asyncio.sleep(SAMPLE_INTERVAL_SECONDS)
