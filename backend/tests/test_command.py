"""Tests for the central async command runner and its test hook."""

import asyncio
import sys

import pytest

from app.services import command


async def test_run_argv_real_process():
    # Portable: run the current Python to echo a known string.
    out, err, rc = await command.run_argv(
        [sys.executable, "-c", "print('hello-jetlag')"]
    )
    assert rc == 0
    assert out == "hello-jetlag"
    assert err == ""


async def test_run_argv_missing_binary_returns_127():
    out, err, rc = await command.run_argv(["definitely-not-a-real-binary-xyz"])
    assert rc == 127


async def test_run_argv_timeout():
    out, err, rc = await command.run_argv(
        [sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.2
    )
    assert rc == 124
    assert "timed out" in err


async def test_fake_runner_records_and_replies(fake_commands):
    fake_commands.reply("sysctl", stdout="net.ipv4.ip_forward = 1")

    out, err, rc = await command.run_argv(["sysctl", "-w", "net.ipv4.ip_forward=1"])
    assert rc == 0
    assert "ip_forward" in out
    assert fake_commands.calls[0]["cmd"] == "sysctl -w net.ipv4.ip_forward=1"

    # Unmatched commands default to a clean success.
    out, err, rc = await command.run_shell("ip addr flush dev eth1")
    assert rc == 0
    assert fake_commands.calls[-1]["shell"] == "ip addr flush dev eth1"
