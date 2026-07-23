"""Phase 4: captive-portal config persistence + web-login behaviour."""

import pytest
import yaml


async def test_portal_config_update_persists_all_sections(client, config_path):
    """PUT /api/portal/config must go through the centralized writer.

    Regression: portal config used to be written by its own read-modify-write
    helper that raced with config_lock and could clobber concurrent writes.
    The centralized writer emits the full canonical document.
    """
    resp = await client.put(
        "/api/portal/config",
        json={"portal_type": "web_login", "login_username": "u", "login_password": "p"},
    )
    assert resp.status_code == 200
    assert resp.json()["portal_type"] == "web_login"

    on_disk = yaml.safe_load(config_path.read_text())
    assert on_disk["portal"]["portal_type"] == "web_login"
    # Full document, not just the portal key (regression guard).
    for key in ("wan_ports", "lan_ports", "network", "dhcp", "dns", "wireless", "updates"):
        assert key in on_disk


async def test_portal_config_rejects_invalid_type(client):
    resp = await client.put("/api/portal/config", json={"portal_type": "nope"})
    assert resp.status_code == 422


async def test_web_login_rejects_bad_credentials(client, db_engine):
    await client.put(
        "/api/portal/config",
        json={"portal_type": "web_login", "login_username": "alice", "login_password": "secret"},
    )
    bad = await client.post("/api/portal/login", json={"username": "alice", "password": "wrong"})
    assert bad.status_code == 401


async def test_web_login_accepts_good_credentials(client, db_engine, fake_commands):
    await client.put(
        "/api/portal/config",
        json={"portal_type": "web_login", "login_username": "alice", "login_password": "secret"},
    )
    ok = await client.post("/api/portal/login", json={"username": "alice", "password": "secret"})
    assert ok.status_code == 200
    assert "redirect" in ok.json()
