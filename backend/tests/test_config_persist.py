"""Phase 2: atomic + concurrent-safe config persistence."""

import asyncio
import os
from pathlib import Path

import pytest
import yaml

from app import config as cfgmod


def _load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text()) or {}


async def test_persist_config_writes_all_sections(config_path):
    from app.config import settings, persist_config

    data = await persist_config(settings)
    on_disk = _load_yaml(config_path)

    # Every canonical section must be present (regression: wireless/updates
    # used to be dropped by one of the two persist paths).
    for key in ("wan_ports", "lan_ports", "network", "dhcp", "dns", "portal",
                "admin", "updates", "wireless", "captures", "logging"):
        assert key in on_disk, f"missing section {key}"
    assert on_disk["setup_completed"] is True
    assert data["wireless"] == on_disk["wireless"]


async def test_atomic_write_no_temp_left_behind(config_path):
    from app.config import settings, persist_config

    await persist_config(settings)
    leftovers = list(config_path.parent.glob(".jetlag-*.yaml.tmp"))
    assert leftovers == []


def test_atomic_write_failure_cleans_up(tmp_path, monkeypatch):
    target = tmp_path / "jetlag.yaml"
    target.write_text("setup_completed: true\n")

    # Force yaml.dump to blow up mid-write.
    def boom(*a, **k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(cfgmod.yaml, "dump", boom)
    with pytest.raises(RuntimeError):
        cfgmod._atomic_write_yaml(target, {"x": 1})

    # Original file untouched, no temp files left.
    assert target.read_text() == "setup_completed: true\n"
    assert list(tmp_path.glob(".jetlag-*.yaml.tmp")) == []


async def test_concurrent_persist_under_lock(config_path):
    """Parallel writers guarded by config_lock produce a valid, complete file."""
    from app.config import settings, config_lock, persist_config

    async def writer(dns_server: str):
        async with config_lock:
            settings.dns.upstream_servers = [dns_server]
            await persist_config(settings)

    await asyncio.gather(*(writer(f"9.9.9.{i}") for i in range(10)))

    # File must parse cleanly (never a half-written interleave).
    on_disk = _load_yaml(config_path)
    assert on_disk["dns"]["upstream_servers"][0].startswith("9.9.9.")
