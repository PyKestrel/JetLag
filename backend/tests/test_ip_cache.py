"""Authenticated-IP TTL cache behaviour."""

import time

import pytest

from app.services.ip_cache import AuthedIPCache


def test_set_get_hit():
    c = AuthedIPCache(ttl_seconds=10)
    c.set("10.0.1.5", "aa:bb:cc:dd:ee:ff")
    assert c.get("10.0.1.5") == "aa:bb:cc:dd:ee:ff"


def test_miss_returns_none():
    c = AuthedIPCache(ttl_seconds=10)
    assert c.get("10.0.1.99") is None


def test_expiry():
    c = AuthedIPCache(ttl_seconds=0.05)
    c.set("10.0.1.5", "mac")
    time.sleep(0.1)
    assert c.get("10.0.1.5") is None


def test_invalidate():
    c = AuthedIPCache(ttl_seconds=10)
    c.set("10.0.1.5", "mac")
    c.invalidate("10.0.1.5")
    assert c.get("10.0.1.5") is None


def test_clear():
    c = AuthedIPCache(ttl_seconds=10)
    c.set("a", "1")
    c.set("b", "2")
    c.clear()
    assert c.get("a") is None and c.get("b") is None


def test_max_entries_eviction():
    c = AuthedIPCache(ttl_seconds=100, max_entries=3)
    for i in range(5):
        c.set(f"ip{i}", f"mac{i}")
    # Should never exceed the cap.
    assert len(c._data) <= 3
