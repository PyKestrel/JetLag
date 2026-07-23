"""Phase 2: CORS no longer combines wildcard origin with credentials."""

import pytest


async def test_cors_preflight_no_credentials(client):
    resp = await client.options(
        "/api/health",
        headers={
            "Origin": "http://example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    # Wildcard origin echoed, and credentials must NOT be allowed.
    assert resp.headers.get("access-control-allow-origin") == "*"
    assert "access-control-allow-credentials" not in resp.headers


async def test_settings_update_persists_and_locks(client, db_engine, config_path):
    import yaml

    resp = await client.put(
        "/api/settings",
        json={"dns": {"upstream_servers": ["9.9.9.9"], "spoof_target": "10.0.1.1"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["dns"]["upstream_servers"] == ["9.9.9.9"]

    on_disk = yaml.safe_load(config_path.read_text())
    assert on_disk["dns"]["upstream_servers"] == ["9.9.9.9"]
    # Centralized serializer includes wireless/updates sections.
    assert "wireless" in on_disk and "updates" in on_disk
