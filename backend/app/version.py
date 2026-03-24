"""
Centralized version management for JetLag.

Reads the VERSION file at the project root as the single source of truth.
"""

from pathlib import Path

_VERSION_FILE = Path(__file__).parent.parent.parent / "VERSION"


def get_version() -> str:
    """Return the current semantic version string (e.g. '0.2.0')."""
    try:
        return _VERSION_FILE.read_text().strip()
    except FileNotFoundError:
        return "0.0.0-unknown"


def get_version_info() -> dict:
    """Return structured version metadata."""
    raw = get_version()
    parts = raw.split("-", 1)
    core = parts[0]
    prerelease = parts[1] if len(parts) > 1 else None

    segments = core.split(".")
    return {
        "version": raw,
        "major": int(segments[0]) if len(segments) > 0 else 0,
        "minor": int(segments[1]) if len(segments) > 1 else 0,
        "patch": int(segments[2]) if len(segments) > 2 else 0,
        "prerelease": prerelease,
    }


__version__ = get_version()
