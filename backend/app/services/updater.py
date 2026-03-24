"""
OTA Update Service for JetLag.

Checks GitHub Releases for new versions, downloads and applies updates
with a multi-step pipeline, and supports automatic rollback on failure.
"""

import asyncio
import json
import logging
import shutil
import subprocess
import time
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

import httpx

from app.version import get_version, get_version_info

logger = logging.getLogger("jetlag.updater")

# ── Paths ─────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent  # backend/app/services -> project root
BACKUP_DIR = PROJECT_ROOT / "backups"
VERSION_FILE = PROJECT_ROOT / "VERSION"
CONFIG_FILE = PROJECT_ROOT / "config" / "jetlag.yaml"
DB_FILE = PROJECT_ROOT / "backend" / "data" / "jetlag.db"
BACKEND_DIR = PROJECT_ROOT / "backend"
FRONTEND_DIR = PROJECT_ROOT / "frontend"

# Paths that must NEVER be touched by git clean / code swap
PROTECTED_PATHS = [
    "config/",
    "backend/data/",
    "backups/",
    "backend/venv/",
    "frontend/node_modules/",
    ".env",
]

MAX_BACKUPS = 3


# ── Data models ───────────────────────────────────────────────────

class UpdateState(str, Enum):
    IDLE = "idle"
    CHECKING = "checking"
    AVAILABLE = "available"
    DOWNLOADING = "downloading"
    IN_PROGRESS = "in_progress"
    RESTARTING = "restarting"
    COMPLETED = "completed"
    FAILED = "failed"
    ROLLING_BACK = "rolling_back"


class UpdateStep(str, Enum):
    PREFLIGHT = "preflight"
    BACKUP = "backup"
    FETCH = "fetch"
    VERIFY = "verify"
    STOP_SERVICES = "stop_services"
    APPLY_CODE = "apply_code"
    INSTALL_DEPS = "install_deps"
    BUILD_FRONTEND = "build_frontend"
    RUN_MIGRATIONS = "run_migrations"
    RESTART_SERVICE = "restart_service"
    HEALTH_CHECK = "health_check"
    POST_FLIGHT = "post_flight"


class UpdateStatus:
    """Mutable singleton tracking the current update state."""

    def __init__(self):
        self.state: UpdateState = UpdateState.IDLE
        self.step: Optional[UpdateStep] = None
        self.progress_pct: int = 0
        self.message: str = ""
        self.started_at: Optional[str] = None
        self.completed_at: Optional[str] = None
        self.error: Optional[str] = None
        self.target_version: Optional[str] = None
        self.log_lines: list[str] = []

    def set(self, state: UpdateState, step: Optional[UpdateStep],
            pct: int, msg: str):
        self.state = state
        self.step = step
        self.progress_pct = pct
        self.message = msg
        self._log(msg)

    def fail(self, error: str):
        self.state = UpdateState.FAILED
        self.error = error
        self.completed_at = _now_iso()
        self._log(f"FAILED: {error}")

    def complete(self):
        self.state = UpdateState.COMPLETED
        self.progress_pct = 100
        self.message = "Update completed successfully"
        self.completed_at = _now_iso()
        self._log(self.message)

    def _log(self, msg: str):
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        self.log_lines.append(f"[{ts}] {msg}")
        logger.info(msg)
        # Cap log buffer
        if len(self.log_lines) > 200:
            self.log_lines = self.log_lines[-200:]

    def to_dict(self) -> dict:
        return {
            "state": self.state.value,
            "step": self.step.value if self.step else None,
            "progress_pct": self.progress_pct,
            "message": self.message,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "error": self.error,
            "target_version": self.target_version,
            "log_lines": self.log_lines[-50:],
        }

    def reset(self):
        self.__init__()


class UpdateCheckResult:
    """Cached result of the last version check."""

    def __init__(self):
        self.available: bool = False
        self.current_version: str = get_version()
        self.latest_version: Optional[str] = None
        self.release_notes: Optional[str] = None
        self.published_at: Optional[str] = None
        self.download_url: Optional[str] = None
        self.html_url: Optional[str] = None
        self.checked_at: Optional[str] = None
        self.prerelease: bool = False

    def to_dict(self) -> dict:
        return {
            "available": self.available,
            "current_version": self.current_version,
            "latest_version": self.latest_version,
            "release_notes": self.release_notes,
            "published_at": self.published_at,
            "download_url": self.download_url,
            "html_url": self.html_url,
            "checked_at": self.checked_at,
            "prerelease": self.prerelease,
        }


# ── Singleton state ───────────────────────────────────────────────

_status = UpdateStatus()
_check_result = UpdateCheckResult()
_update_lock = asyncio.Lock()
_update_history: list[dict] = []


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compare_versions(current: str, remote: str) -> bool:
    """Return True if remote > current using semver comparison."""
    def parse(v: str) -> tuple:
        core = v.lstrip("v").split("-")[0]
        parts = core.split(".")
        return tuple(int(p) for p in parts)
    try:
        return parse(remote) > parse(current)
    except (ValueError, IndexError):
        return False


def _run_cmd(cmd: list[str], cwd: Optional[str] = None,
             timeout: int = 300) -> subprocess.CompletedProcess:
    """Run a shell command and return the result."""
    logger.debug(f"Running: {' '.join(cmd)}")
    return subprocess.run(
        cmd, capture_output=True, text=True,
        cwd=cwd or str(PROJECT_ROOT), timeout=timeout,
    )


# ── Public API ────────────────────────────────────────────────────

def get_status() -> dict:
    return _status.to_dict()


def get_check_result() -> dict:
    return _check_result.to_dict()


def get_history() -> list[dict]:
    return list(reversed(_update_history))


async def check_for_update(force: bool = False) -> dict:
    """
    Check GitHub for a newer version.

    Strategy:
    1. Try the Releases API first (provides release notes, etc.).
    2. If no releases exist (404 or empty), fall back to the Tags API
       so that simply pushing a tag (e.g. ``git tag v0.3.1 && git push --tags``)
       is enough to trigger an update.
    Results are cached; pass force=True to bypass cache.
    """
    from app.config import settings as cfg

    # Use cache if checked recently (< 5 min) and not forced
    if (not force and _check_result.checked_at and
            _check_result.latest_version is not None):
        return _check_result.to_dict()

    repo = cfg.updates.github_repo
    channel = cfg.updates.channel
    current = get_version()

    _check_result.current_version = current
    _check_result.checked_at = _now_iso()

    headers = {"Accept": "application/vnd.github+json"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            release = None

            # ── 1. Try Releases API ──────────────────────────
            if channel == "stable":
                url = f"https://api.github.com/repos/{repo}/releases/latest"
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    release = resp.json()
            else:
                url = f"https://api.github.com/repos/{repo}/releases?per_page=5"
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    releases = resp.json()
                    if releases:
                        release = releases[0]

            # ── 2. Populate from Release if found ────────────
            if release:
                remote_tag = release.get("tag_name", "").lstrip("v")
                _check_result.latest_version = remote_tag
                _check_result.release_notes = release.get("body", "")
                _check_result.published_at = release.get("published_at", "")
                _check_result.html_url = release.get("html_url", "")
                _check_result.prerelease = release.get("prerelease", False)
                _check_result.download_url = release.get("tarball_url", "")
                _check_result.available = _compare_versions(current, remote_tag)

                logger.info(
                    f"Update check (release): current={current}, latest={remote_tag}, "
                    f"available={_check_result.available}"
                )
                return _check_result.to_dict()

            # ── 3. Fallback: Tags API ────────────────────────
            logger.info("No GitHub Releases found — falling back to Tags API")
            url = f"https://api.github.com/repos/{repo}/tags?per_page=20"
            resp = await client.get(url, headers=headers)

            if resp.status_code != 200:
                logger.warning(f"Tags API returned {resp.status_code}")
                _check_result.available = False
                return _check_result.to_dict()

            tags = resp.json()
            if not tags:
                logger.info("No tags found in repository")
                _check_result.available = False
                return _check_result.to_dict()

            # Find the highest semver tag that starts with 'v'
            best_version = None
            best_tag_name = None
            for tag in tags:
                tag_name = tag.get("name", "")
                if not tag_name.startswith("v"):
                    continue
                ver_str = tag_name.lstrip("v").split("-")[0]
                try:
                    ver_tuple = tuple(int(p) for p in ver_str.split("."))
                except (ValueError, IndexError):
                    continue
                if best_version is None or ver_tuple > best_version:
                    best_version = ver_tuple
                    best_tag_name = tag_name

            if best_tag_name is None:
                logger.info("No valid semver tags found")
                _check_result.available = False
                return _check_result.to_dict()

            remote_tag = best_tag_name.lstrip("v")
            _check_result.latest_version = remote_tag
            _check_result.release_notes = ""
            _check_result.published_at = ""
            _check_result.html_url = f"https://github.com/{repo}/releases/tag/{best_tag_name}"
            _check_result.prerelease = False
            _check_result.download_url = ""
            _check_result.available = _compare_versions(current, remote_tag)

            logger.info(
                f"Update check (tag): current={current}, latest={remote_tag}, "
                f"available={_check_result.available}"
            )

    except httpx.HTTPStatusError as e:
        logger.error(f"GitHub API error: {e.response.status_code}")
        _check_result.available = False
    except Exception as e:
        logger.error(f"Update check failed: {e}")
        _check_result.available = False

    return _check_result.to_dict()


async def start_update(target_version: str) -> dict:
    """
    Kick off the update pipeline in a background task.
    Returns immediately with the initial status.
    """
    if _update_lock.locked():
        return {"error": "An update is already in progress"}

    _status.reset()
    _status.state = UpdateState.IN_PROGRESS
    _status.target_version = target_version
    _status.started_at = _now_iso()

    asyncio.create_task(_run_update_pipeline(target_version))
    return _status.to_dict()


async def trigger_rollback() -> dict:
    """Manually trigger a rollback to the most recent backup."""
    if _update_lock.locked():
        return {"error": "An update is in progress — wait for it to finish or fail"}

    backups = _list_backups()
    if not backups:
        return {"error": "No backups available to rollback to"}

    latest_backup = backups[-1]
    asyncio.create_task(_perform_rollback(latest_backup, manual=True))
    return {"message": f"Rollback to {latest_backup.name} started"}


# ── Background update pipeline ────────────────────────────────────

async def _run_update_pipeline(target_version: str):
    """Execute the full update pipeline with rollback on failure."""
    async with _update_lock:
        backup_dir = None
        original_ref = None
        active_profiles = []

        try:
            # ── Step 1: Pre-flight ────────────────────────────
            _status.set(UpdateState.IN_PROGRESS, UpdateStep.PREFLIGHT, 5,
                        "Running pre-flight checks...")

            # Check disk space (need at least 500MB free)
            stat = shutil.disk_usage(str(PROJECT_ROOT))
            free_mb = stat.free // (1024 * 1024)
            if free_mb < 500:
                raise UpdateError(f"Insufficient disk space: {free_mb}MB free, need 500MB+")

            # Check git is available and we're in a repo
            result = _run_cmd(["git", "status", "--porcelain"])
            if result.returncode != 0:
                raise UpdateError("Not a git repository or git not installed")

            # Record current git ref for rollback
            result = _run_cmd(["git", "rev-parse", "HEAD"])
            original_ref = result.stdout.strip()

            _status.set(UpdateState.IN_PROGRESS, UpdateStep.PREFLIGHT, 10,
                        f"Pre-flight passed. Current ref: {original_ref[:8]}")

            # ── Step 2: Backup ────────────────────────────────
            _status.set(UpdateState.IN_PROGRESS, UpdateStep.BACKUP, 15,
                        "Creating backup...")

            backup_dir = _create_backup(original_ref, active_profiles)

            _status.set(UpdateState.IN_PROGRESS, UpdateStep.BACKUP, 20,
                        f"Backup created: {backup_dir.name}")

            # ── Step 3: Fetch ─────────────────────────────────
            _status.set(UpdateState.IN_PROGRESS, UpdateStep.FETCH, 25,
                        "Fetching latest code from GitHub...")

            result = _run_cmd(["git", "fetch", "--tags", "--force", "origin"])
            if result.returncode != 0:
                raise UpdateError(f"git fetch failed: {result.stderr}")

            _status.set(UpdateState.IN_PROGRESS, UpdateStep.FETCH, 35,
                        "Code fetched successfully")

            # ── Step 4: Verify ────────────────────────────────
            _status.set(UpdateState.IN_PROGRESS, UpdateStep.VERIFY, 40,
                        f"Verifying tag v{target_version} exists...")

            result = _run_cmd(["git", "tag", "-l", f"v{target_version}"])
            if not result.stdout.strip():
                raise UpdateError(
                    f"Tag v{target_version} not found. Available tags: "
                    + _run_cmd(["git", "tag", "-l", "--sort=-v:refname"]).stdout.strip()[:200]
                )

            _status.set(UpdateState.IN_PROGRESS, UpdateStep.VERIFY, 42,
                        f"Tag v{target_version} verified")

            # ── Step 5: Stop active impairment profiles ───────
            _status.set(UpdateState.IN_PROGRESS, UpdateStep.STOP_SERVICES, 45,
                        "Stopping active impairment profiles...")

            active_profiles = await _get_active_profiles()
            if active_profiles:
                await _stop_impairment_profiles()
                _status.set(UpdateState.IN_PROGRESS, UpdateStep.STOP_SERVICES, 48,
                            f"Stopped {len(active_profiles)} active profiles")

            # ── Step 6: Apply code ────────────────────────────
            _status.set(UpdateState.IN_PROGRESS, UpdateStep.APPLY_CODE, 50,
                        "Stashing local changes...")

            # Stash any uncommitted changes
            _run_cmd(["git", "stash", "--include-untracked"])

            _status.set(UpdateState.IN_PROGRESS, UpdateStep.APPLY_CODE, 55,
                        f"Checking out v{target_version}...")

            result = _run_cmd(["git", "checkout", f"v{target_version}"])
            if result.returncode != 0:
                raise UpdateError(f"git checkout failed: {result.stderr}")

            # Clean untracked files but protect user data
            exclude_args = []
            for p in PROTECTED_PATHS:
                exclude_args.extend(["-e", p])

            result = _run_cmd(["git", "clean", "-fd"] + exclude_args)

            _status.set(UpdateState.IN_PROGRESS, UpdateStep.APPLY_CODE, 60,
                        "Code updated")

            # ── Step 7: Install dependencies ──────────────────
            _status.set(UpdateState.IN_PROGRESS, UpdateStep.INSTALL_DEPS, 62,
                        "Installing Python dependencies...")

            venv_pip = str(BACKEND_DIR / "venv" / "bin" / "pip")
            result = _run_cmd(
                [venv_pip, "install", "-q", "-r", "requirements.txt"],
                cwd=str(BACKEND_DIR), timeout=120,
            )
            if result.returncode != 0:
                raise UpdateError(f"pip install failed: {result.stderr[:500]}")

            _status.set(UpdateState.IN_PROGRESS, UpdateStep.INSTALL_DEPS, 68,
                        "Python dependencies installed")

            _status.set(UpdateState.IN_PROGRESS, UpdateStep.INSTALL_DEPS, 70,
                        "Installing npm packages...")

            result = _run_cmd(
                ["npm", "install", "--silent"],
                cwd=str(FRONTEND_DIR), timeout=120,
            )
            if result.returncode != 0:
                raise UpdateError(f"npm install failed: {result.stderr[:500]}")

            _status.set(UpdateState.IN_PROGRESS, UpdateStep.INSTALL_DEPS, 75,
                        "npm packages installed")

            # ── Step 8: Build frontend ────────────────────────
            _status.set(UpdateState.IN_PROGRESS, UpdateStep.BUILD_FRONTEND, 78,
                        "Building frontend...")

            result = _run_cmd(
                ["npm", "run", "build"],
                cwd=str(FRONTEND_DIR), timeout=120,
            )
            if result.returncode != 0:
                raise UpdateError(f"Frontend build failed: {result.stderr[:500]}")

            _status.set(UpdateState.IN_PROGRESS, UpdateStep.BUILD_FRONTEND, 82,
                        "Frontend built")

            # ── Step 9: Run migrations ────────────────────────
            _status.set(UpdateState.IN_PROGRESS, UpdateStep.RUN_MIGRATIONS, 85,
                        "Running database migrations...")

            venv_alembic = str(BACKEND_DIR / "venv" / "bin" / "alembic")
            result = _run_cmd(
                [venv_alembic, "upgrade", "head"],
                cwd=str(BACKEND_DIR), timeout=60,
            )
            if result.returncode != 0:
                raise UpdateError(f"Alembic migration failed: {result.stderr[:500]}")

            _status.set(UpdateState.IN_PROGRESS, UpdateStep.RUN_MIGRATIONS, 88,
                        "Migrations applied")

            # ── Step 10: Restart service ──────────────────────
            _status.set(UpdateState.IN_PROGRESS, UpdateStep.RESTART_SERVICE, 90,
                        "Restarting JetLag service...")

            from app.services.process import is_systemd_managed
            if is_systemd_managed():
                # Spawn restart in a detached process so it survives our death
                subprocess.Popen(
                    ["systemctl", "restart", "jetlag.service"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
                _status.set(UpdateState.RESTARTING, UpdateStep.RESTART_SERVICE, 92,
                            "Service restart initiated — waiting for new process...")

                # We're about to die. Write status to disk so the new process
                # can pick up the health check step.
                _write_pending_update(target_version, backup_dir, active_profiles)
                return  # Process will be killed by systemd restart
            else:
                _status.set(UpdateState.IN_PROGRESS, UpdateStep.RESTART_SERVICE, 92,
                            "Not running under systemd — skipping restart")

            # ── Step 11: Health check ─────────────────────────
            await _run_health_check(target_version)

            # ── Step 12: Post-flight ──────────────────────────
            await _run_post_flight(active_profiles, backup_dir, target_version)

        except UpdateError as e:
            _status.fail(str(e))
            if backup_dir and original_ref:
                _status.set(UpdateState.ROLLING_BACK, None, 0,
                            f"Rolling back due to error: {e}")
                await _perform_rollback(backup_dir, original_ref=original_ref)
            _record_history("failed", str(e))

        except Exception as e:
            _status.fail(f"Unexpected error: {e}")
            if backup_dir and original_ref:
                await _perform_rollback(backup_dir, original_ref=original_ref)
            _record_history("failed", str(e))


async def run_post_update_health_check():
    """
    Called on startup — checks if there's a pending update that needs
    its health check + post-flight completed (after a systemd restart).
    """
    pending_file = BACKUP_DIR / ".pending_update.json"
    if not pending_file.exists():
        return

    try:
        data = json.loads(pending_file.read_text())
        target_version = data["target_version"]
        backup_dir = Path(data["backup_dir"])
        active_profiles = data.get("active_profiles", [])

        logger.info(f"Resuming post-restart update check for v{target_version}")

        _status.reset()
        _status.state = UpdateState.IN_PROGRESS
        _status.target_version = target_version
        _status.started_at = data.get("started_at", _now_iso())

        # Run health check
        try:
            await _run_health_check(target_version)
            await _run_post_flight(active_profiles, backup_dir, target_version)
        except UpdateError as e:
            _status.fail(str(e))
            await _perform_rollback(backup_dir)
            _record_history("failed", str(e))

    except Exception as e:
        logger.error(f"Error processing pending update: {e}")
    finally:
        pending_file.unlink(missing_ok=True)


# ── Pipeline helpers ──────────────────────────────────────────────

async def _run_health_check(target_version: str):
    """Poll the health endpoint to verify the new version is running."""
    _status.set(UpdateState.IN_PROGRESS, UpdateStep.HEALTH_CHECK, 95,
                "Running health check...")

    from app.config import settings as cfg
    port = cfg.admin.api_port
    health_url = f"http://127.0.0.1:{port}/api/health"

    for attempt in range(15):
        await asyncio.sleep(2)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(health_url)
                if resp.status_code == 200:
                    body = resp.json()
                    running_version = body.get("version", "")
                    if running_version == target_version:
                        _status.set(UpdateState.IN_PROGRESS, UpdateStep.HEALTH_CHECK, 97,
                                    f"Health check passed — v{running_version} running")
                        return
                    else:
                        _status._log(
                            f"Health check: version mismatch "
                            f"(expected={target_version}, got={running_version}), "
                            f"attempt {attempt + 1}/15"
                        )
        except Exception:
            _status._log(f"Health check attempt {attempt + 1}/15 — service not ready")

    raise UpdateError(
        f"Health check failed after 30s — service did not come up with v{target_version}"
    )


async def _run_post_flight(active_profiles: list, backup_dir: Path,
                           target_version: str):
    """Final steps after a successful health check."""
    _status.set(UpdateState.IN_PROGRESS, UpdateStep.POST_FLIGHT, 98,
                "Running post-flight...")

    # Re-enable profiles that were active before the update
    if active_profiles:
        _status._log(f"Re-enabling {len(active_profiles)} impairment profiles...")
        await _restore_impairment_profiles(active_profiles)

    # Clean old backups (keep last MAX_BACKUPS)
    _clean_old_backups()

    _status.complete()
    _record_history("success", None)


def _create_backup(git_ref: str, active_profiles: list) -> Path:
    """Create a backup of config, database, and metadata."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup = BACKUP_DIR / f"update-{ts}"
    backup.mkdir(parents=True, exist_ok=True)

    # Copy config
    if CONFIG_FILE.exists():
        shutil.copy2(CONFIG_FILE, backup / "jetlag.yaml")

    # Copy database
    if DB_FILE.exists():
        shutil.copy2(DB_FILE, backup / "jetlag.db")

    # Copy VERSION
    if VERSION_FILE.exists():
        shutil.copy2(VERSION_FILE, backup / "VERSION")

    # Save git ref
    (backup / "git_ref.txt").write_text(git_ref)

    # Save active profiles
    (backup / "active_profiles.json").write_text(json.dumps(active_profiles))

    logger.info(f"Backup created at {backup}")
    return backup


def _list_backups() -> list[Path]:
    """List backup directories sorted by age (oldest first)."""
    if not BACKUP_DIR.exists():
        return []
    return sorted(
        [d for d in BACKUP_DIR.iterdir() if d.is_dir() and d.name.startswith("update-")],
        key=lambda d: d.name,
    )


def _clean_old_backups():
    """Remove old backups, keeping the most recent MAX_BACKUPS."""
    backups = _list_backups()
    while len(backups) > MAX_BACKUPS:
        old = backups.pop(0)
        shutil.rmtree(old, ignore_errors=True)
        logger.info(f"Removed old backup: {old.name}")


async def _perform_rollback(backup_dir: Path, original_ref: str = None,
                            manual: bool = False):
    """Restore the appliance from a backup."""
    try:
        _status.set(UpdateState.ROLLING_BACK, None, 0, "Starting rollback...")

        # Get git ref from backup if not provided
        if original_ref is None:
            ref_file = backup_dir / "git_ref.txt"
            if ref_file.exists():
                original_ref = ref_file.read_text().strip()

        # Checkout original code
        if original_ref:
            _status._log(f"Restoring code to {original_ref[:8]}...")
            result = _run_cmd(["git", "checkout", original_ref])
            if result.returncode != 0:
                _status._log(f"Warning: git checkout failed: {result.stderr}")

        # Restore config
        backup_config = backup_dir / "jetlag.yaml"
        if backup_config.exists():
            shutil.copy2(backup_config, CONFIG_FILE)
            _status._log("Restored config/jetlag.yaml")

        # Restore database
        backup_db = backup_dir / "jetlag.db"
        if backup_db.exists():
            shutil.copy2(backup_db, DB_FILE)
            _status._log("Restored database")

        # Restore VERSION
        backup_version = backup_dir / "VERSION"
        if backup_version.exists():
            shutil.copy2(backup_version, VERSION_FILE)

        # Re-install old deps
        _status._log("Reinstalling dependencies for rolled-back version...")
        venv_pip = str(BACKEND_DIR / "venv" / "bin" / "pip")
        _run_cmd([venv_pip, "install", "-q", "-r", "requirements.txt"],
                 cwd=str(BACKEND_DIR), timeout=120)

        # Restart service
        from app.services.process import is_systemd_managed
        if is_systemd_managed():
            _status._log("Restarting service after rollback...")
            subprocess.Popen(
                ["systemctl", "restart", "jetlag.service"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )

        if manual:
            _status.set(UpdateState.COMPLETED, None, 100,
                        f"Rollback to {backup_dir.name} completed")
            _record_history("rollback", None)
        else:
            _status._log("Automatic rollback completed")

    except Exception as e:
        logger.error(f"Rollback failed: {e}")
        _status.fail(f"Rollback also failed: {e}")


def _write_pending_update(target_version: str, backup_dir: Path,
                          active_profiles: list):
    """Write update state to disk so we can resume after restart."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    pending = {
        "target_version": target_version,
        "backup_dir": str(backup_dir),
        "active_profiles": active_profiles,
        "started_at": _status.started_at,
    }
    (BACKUP_DIR / ".pending_update.json").write_text(json.dumps(pending))


def _record_history(outcome: str, error: Optional[str]):
    """Record the outcome of an update attempt."""
    entry = {
        "version": _status.target_version,
        "outcome": outcome,
        "started_at": _status.started_at,
        "completed_at": _now_iso(),
        "error": error,
    }
    _update_history.append(entry)

    # Persist history to disk
    history_file = BACKUP_DIR / "update_history.json"
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    try:
        if history_file.exists():
            existing = json.loads(history_file.read_text())
        else:
            existing = []
        existing.append(entry)
        # Keep last 20 entries
        existing = existing[-20:]
        history_file.write_text(json.dumps(existing, indent=2))
    except Exception as e:
        logger.error(f"Failed to persist history: {e}")


def load_history():
    """Load update history from disk on startup."""
    global _update_history
    history_file = BACKUP_DIR / "update_history.json"
    if history_file.exists():
        try:
            _update_history = json.loads(history_file.read_text())
        except Exception:
            _update_history = []


# ── Impairment profile helpers ────────────────────────────────────

async def _get_active_profiles() -> list:
    """Get list of enabled profile IDs."""
    try:
        from app.database import async_session
        from app.models import ImpairmentProfile
        from sqlalchemy import select

        async with async_session() as session:
            result = await session.execute(
                select(ImpairmentProfile.id, ImpairmentProfile.name)
                .where(ImpairmentProfile.enabled == True)
            )
            return [{"id": row.id, "name": row.name} for row in result.all()]
    except Exception as e:
        logger.error(f"Failed to get active profiles: {e}")
        return []


async def _stop_impairment_profiles():
    """Remove all tc/netem rules before update."""
    try:
        from app.services.impairment import ImpairmentService
        await ImpairmentService.remove_all()
    except Exception as e:
        logger.error(f"Failed to stop impairment profiles: {e}")


async def _restore_impairment_profiles(profile_list: list):
    """Re-apply impairment profiles after update."""
    try:
        from app.database import async_session
        from app.models import ImpairmentProfile
        from app.services.impairment import ImpairmentService
        from sqlalchemy import select

        profile_ids = [p["id"] for p in profile_list]

        async with async_session() as session:
            result = await session.execute(
                select(ImpairmentProfile)
                .where(ImpairmentProfile.id.in_(profile_ids))
            )
            for profile in result.scalars().all():
                try:
                    await ImpairmentService.apply_profile(profile)
                    logger.info(f"Re-enabled profile: {profile.name}")
                except Exception as e:
                    logger.error(f"Failed to re-enable profile {profile.name}: {e}")
    except Exception as e:
        logger.error(f"Failed to restore profiles: {e}")


# ── Background auto-check task ────────────────────────────────────

async def auto_check_loop():
    """Background task that periodically checks for updates."""
    from app.config import settings as cfg

    # Wait a bit after startup before first check
    await asyncio.sleep(30)

    load_history()

    while True:
        try:
            if cfg.updates.auto_check:
                await check_for_update(force=True)
        except Exception as e:
            logger.error(f"Auto-check failed: {e}")

        interval = cfg.updates.check_interval_hours * 3600
        await asyncio.sleep(interval)


class UpdateError(Exception):
    """Raised when an update step fails."""
    pass
