"""Phase 4: LAN neighbour discovery honours ALL configured LAN interfaces."""

import pytest

from app.services.network import NetworkService


async def test_get_lan_neighbours_includes_all_lan_ports(monkeypatch):
    """Regression: discovery filtered on the legacy single lan_interface only,
    so clients on secondary LAN ports / VLAN sub-interfaces were dropped."""
    from app.config import settings

    entries = [
        {"ip": "10.0.1.10", "mac": "aa:aa:aa:aa:aa:01", "interface": "eth1", "state": "REACHABLE"},
        {"ip": "10.0.2.10", "mac": "aa:aa:aa:aa:aa:02", "interface": "eth2", "state": "REACHABLE"},
        {"ip": "9.9.9.9", "mac": "bb:bb:bb:bb:bb:bb", "interface": "eth0", "state": "REACHABLE"},
    ]

    async def fake_arp():
        return entries

    monkeypatch.setattr(NetworkService, "get_arp_table", staticmethod(fake_arp))
    monkeypatch.setattr(type(settings), "all_lan_interfaces", lambda self: ["eth1", "eth2"])

    result = await NetworkService.get_lan_neighbours()
    ips = {e["ip"] for e in result}
    assert ips == {"10.0.1.10", "10.0.2.10"}  # eth0 (WAN) excluded


async def test_get_lan_neighbours_falls_back_to_legacy_scalar(monkeypatch):
    from app.config import settings

    entries = [
        {"ip": "10.0.1.10", "mac": "aa:aa:aa:aa:aa:01", "interface": "eth1", "state": "REACHABLE"},
    ]

    async def fake_arp():
        return entries

    monkeypatch.setattr(NetworkService, "get_arp_table", staticmethod(fake_arp))
    monkeypatch.setattr(type(settings), "all_lan_interfaces", lambda self: [])
    # network.lan_interface is already 'eth1' (derived from lan_ports in the
    # test config), so the legacy fallback path should still match.

    result = await NetworkService.get_lan_neighbours()
    assert [e["ip"] for e in result] == ["10.0.1.10"]
