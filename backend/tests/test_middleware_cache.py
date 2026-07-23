"""Captive-portal middleware fast-path cache + revocation invalidation."""

import pytest

from app.services.ip_cache import authed_ip_cache


@pytest.fixture(autouse=True)
def _clear_cache():
    authed_ip_cache.clear()
    yield
    authed_ip_cache.clear()


async def test_cached_ip_skips_db_and_reallows(client, db_engine, fake_commands):
    # A DNAT'd request (Host header is an external site) from an IP we have
    # already cached as authenticated must self-heal via the firewall without
    # touching the database.
    authed_ip_cache.set("127.0.0.1", "aa:bb:cc:dd:ee:ff")

    resp = await client.get("/", headers={"host": "www.google.com"})
    assert resp.status_code == 200
    assert "Reconnecting" in resp.text

    # allow_client should have issued an nft command through the fake runner.
    assert any("authenticated_ips" in c["cmd"] for c in fake_commands.calls)


async def test_intercept_client_invalidates_cache(fake_commands):
    from app.services.firewall import FirewallService

    authed_ip_cache.set("10.0.1.50", "mac")
    await FirewallService.intercept_client("10.0.1.50", "mac")
    assert authed_ip_cache.get("10.0.1.50") is None


async def test_reset_all_clears_cache(fake_commands):
    from app.services.firewall import FirewallService

    authed_ip_cache.set("10.0.1.51", "mac")
    await FirewallService.reset_all()
    assert authed_ip_cache.get("10.0.1.51") is None
