"""Overview endpoint: grouped counts return the correct shape and totals."""

import pytest


async def _seed(session):
    from app.models.client import Client, AuthState
    from app.models.impairment_profile import ImpairmentProfile

    session.add_all(
        [
            Client(mac_address="aa:aa:aa:aa:aa:01", ip_address="10.0.1.10",
                   auth_state=AuthState.AUTHENTICATED),
            Client(mac_address="aa:aa:aa:aa:aa:02", ip_address="10.0.1.11",
                   auth_state=AuthState.AUTHENTICATED),
            Client(mac_address="aa:aa:aa:aa:aa:03", ip_address="10.0.1.12",
                   auth_state=AuthState.PENDING),
        ]
    )
    session.add_all(
        [
            ImpairmentProfile(name="p-on", enabled=True),
            ImpairmentProfile(name="p-off", enabled=False),
            ImpairmentProfile(name="p-off2", enabled=False),
        ]
    )
    await session.commit()


async def test_overview_counts(client, db_engine):
    from app.database import async_session

    async with async_session() as session:
        await _seed(session)

    resp = await client.get("/api/overview")
    assert resp.status_code == 200
    body = resp.json()

    assert body["clients"] == {"total": 3, "pending": 1, "authenticated": 2}
    assert body["profiles"] == {"total": 3, "active": 1}
    assert body["captures"]["active"] == 0
    assert "dnsmasq" in body["services"]


async def test_overview_empty(client, db_engine):
    resp = await client.get("/api/overview")
    assert resp.status_code == 200
    body = resp.json()
    assert body["clients"] == {"total": 0, "pending": 0, "authenticated": 0}
    assert body["profiles"] == {"total": 0, "active": 0}
