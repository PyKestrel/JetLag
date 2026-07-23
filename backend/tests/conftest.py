"""Shared pytest fixtures for the JetLag backend test suite.

Runs entirely off-Linux: the database is a throwaway temp SQLite file and all
system commands are intercepted by a fake command runner so no real ``ip`` /
``nft`` / ``systemctl`` process is ever spawned.

Environment variables are set *before* any ``app.*`` module is imported so the
config singleton and the SQLAlchemy engine bind to the temp locations.
"""

import os
import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

# ── Bind config + DB to temp locations BEFORE importing app modules ──
_TMP = Path(tempfile.mkdtemp(prefix="jetlag-test-"))
_CONFIG_PATH = _TMP / "jetlag.yaml"
_DB_DIR = _TMP / "data"
_DB_DIR.mkdir(parents=True, exist_ok=True)

# A minimal, setup-completed config so routers behave as in production.
_CONFIG_PATH.write_text(
    """
setup_completed: true
wan_ports:
  - interface: eth0
    enabled: true
lan_ports:
  - interface: eth1
    ip: 10.0.1.1
    subnet: 10.0.1.0/24
    enabled: true
    dhcp:
      enabled: true
      range_start: 10.0.1.100
      range_end: 10.0.1.250
      lease_time: 1h
      gateway: 10.0.1.1
      dns_server: 10.0.1.1
dns:
  upstream_servers: ["1.1.1.1"]
admin:
  auth_enabled: false
"""
)

os.environ["JETLAG_CONFIG"] = str(_CONFIG_PATH)
os.environ["JETLAG_DB_DIR"] = str(_DB_DIR)


@pytest.fixture(scope="session")
def config_path() -> Path:
    return _CONFIG_PATH


@pytest_asyncio.fixture
async def db_engine():
    """Create all tables on the temp engine, drop them after the test."""
    from app.database import engine, Base
    import app.models  # noqa: F401 — ensure all models are registered

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client(db_engine):
    """An httpx AsyncClient bound to the FastAPI app via ASGITransport.

    The captive-portal/auth middleware runs normally; auth is disabled in the
    test config so admin routes are reachable.
    """
    from httpx import AsyncClient, ASGITransport
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


@pytest.fixture
def fake_commands():
    """Install a recording fake command runner.

    Yields a ``FakeRunner`` whose ``.calls`` list records every invocation and
    whose ``.reply(match, stdout=..., rc=...)`` queues canned responses.
    """
    from app.services import command

    class FakeRunner:
        def __init__(self):
            self.calls: list[dict] = []
            self._rules: list[tuple] = []

        def reply(self, match: str, stdout: str = "", stderr: str = "", rc: int = 0):
            self._rules.append((match, stdout, stderr, rc))
            return self

        async def __call__(self, argv, shell):
            cmd = " ".join(argv) if argv else (shell or "")
            self.calls.append({"argv": argv, "shell": shell, "cmd": cmd})
            for match, out, err, rc in self._rules:
                if match in cmd:
                    return out, err, rc
            return "", "", 0

    runner = FakeRunner()
    command.set_runner(runner)
    try:
        yield runner
    finally:
        command.set_runner(None)
