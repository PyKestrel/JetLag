"""Phase 0 smoke tests: the app boots and basic open endpoints respond."""

import pytest


async def test_health(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "jetlag"


async def test_version(client):
    resp = await client.get("/api/version")
    assert resp.status_code == 200
    assert "version" in resp.json()


def test_catch_all_static_mount_is_last():
    """Regression: the ``/`` StaticFiles mount must be registered last.

    A catch-all mount registered before any API route silently shadows it
    (returns 404) once frontend/dist exists — which broke /api/health and
    /api/version in every built deployment.
    """
    from starlette.routing import Mount

    from app.main import app

    # Starlette stores the root mount ("/") with an empty ``path``.
    root_mounts = [r for r in app.routes if isinstance(r, Mount) and r.path == ""]
    if root_mounts:
        last = app.routes[-1]
        assert isinstance(last, Mount) and last.path == "", (
            "The '/' StaticFiles mount must be the last route so it cannot "
            "shadow API endpoints."
        )


async def test_config_singleton_loaded_from_temp(config_path):
    from app.config import settings

    assert settings.setup_completed is True
    assert settings.admin.auth_enabled is False
    assert settings.lan_ports[0].interface == "eth1"
