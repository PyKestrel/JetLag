"""Central async command runner.

All service/router code that shells out to system tools (``ip``, ``iw``,
``sysctl``, ``systemctl``, ``nft`` …) should route through here so that:

* the FastAPI event loop is never blocked by a synchronous ``subprocess.run``
* tests can install a fake runner (see ``set_runner``) and exercise service
  logic on non-Linux hosts without touching the real system.

Two entry points are provided:

* :func:`run_argv` — preferred, takes an argv list (no shell parsing).
* :func:`run_shell` — for the handful of call sites that rely on shell
  features (pipes, ``2>/dev/null`` redirects, globbing).

Both return ``(stdout, stderr, returncode)`` with text already decoded.
"""

import asyncio
import logging
from typing import Awaitable, Callable, Optional, Sequence

logger = logging.getLogger("jetlag.command")

# Result triple: (stdout, stderr, returncode)
CommandResult = tuple[str, str, int]

# Optional test hook. When set, both run_argv and run_shell delegate to it
# instead of spawning a real process. Signature:
#   async def runner(argv: list[str] | None, shell: str | None) -> CommandResult
_Runner = Callable[[Optional[list[str]], Optional[str]], Awaitable[CommandResult]]
_runner: Optional[_Runner] = None


def set_runner(runner: Optional[_Runner]) -> None:
    """Install (or clear, with ``None``) a fake command runner for tests."""
    global _runner
    _runner = runner


async def run_argv(
    argv: Sequence[str], timeout: Optional[float] = 15.0
) -> CommandResult:
    """Run *argv* without a shell. Returns ``(stdout, stderr, returncode)``.

    On timeout the child is killed and ``returncode`` is ``124`` (matching the
    ``timeout(1)`` convention) with a message on stderr.
    """
    argv = [str(a) for a in argv]
    if _runner is not None:
        return await _runner(argv, None)

    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        return "", str(exc), 127

    return await _communicate(proc, timeout, cmd=" ".join(argv))


async def run_shell(cmd: str, timeout: Optional[float] = 15.0) -> CommandResult:
    """Run *cmd* through the shell. Returns ``(stdout, stderr, returncode)``."""
    if _runner is not None:
        return await _runner(None, cmd)

    proc = await asyncio.create_subprocess_shell(
        cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    return await _communicate(proc, timeout, cmd=cmd)


async def _communicate(proc, timeout: Optional[float], cmd: str) -> CommandResult:
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()
        logger.warning("Command timed out after %ss: %s", timeout, cmd)
        return "", f"timed out after {timeout}s", 124
    return (
        stdout.decode(errors="replace").strip(),
        stderr.decode(errors="replace").strip(),
        proc.returncode,
    )
