#!/usr/bin/env bash
# JetLag Dev Server — Install & Start
# Installs all dependencies and starts both backend + frontend dev servers.
# Usage: bash scripts/start-dev.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="${PROJECT_DIR}/backend"
FRONTEND_DIR="${PROJECT_DIR}/frontend"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[jetlag]${NC} $*"; }
ok()   { echo -e "${GREEN}[  ok ]${NC} $*"; }
fail() { echo -e "${RED}[fail]${NC} $*"; exit 1; }

# ── Pre-flight checks ──────────────────────────────────────────────
log "Checking prerequisites..."

# Select a supported Python interpreter. pydantic-core's bundled PyO3 does not
# support Python 3.14+, so the venv MUST be built with 3.11–3.13. We prefer an
# explicitly-versioned binary and fall back to `python3` only if it is in range.
pick_python() {
    local candidate ver major minor
    for candidate in python3.13 python3.12 python3.11 python3; do
        command -v "$candidate" >/dev/null 2>&1 || continue
        ver=$("$candidate" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null) || continue
        major=${ver%%.*}; minor=${ver##*.}
        if [[ "$major" -eq 3 && "$minor" -ge 11 && "$minor" -le 13 ]]; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}

PYTHON_BIN="$(pick_python)" || fail "No supported Python found. Need Python 3.11–3.13 (3.14+ not yet supported by pydantic-core/PyO3). Install one, e.g.: sudo apt-get install python3.13 python3.13-venv"
command -v node >/dev/null 2>&1 || fail "node not found. Install Node.js 20+."
command -v npm  >/dev/null 2>&1 || fail "npm not found. Install Node.js 20+."

PYTHON_VER=$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
NODE_VER=$(node -v | sed 's/v//')
ok "Python ${PYTHON_VER} (${PYTHON_BIN}), Node ${NODE_VER}"

# ── Install system packages if missing (Linux only) ───────────────
if [[ "$(uname)" == "Linux" ]]; then
    MISSING_PKGS=()
    command -v dnsmasq  >/dev/null 2>&1 || MISSING_PKGS+=(dnsmasq)
    command -v nft      >/dev/null 2>&1 || MISSING_PKGS+=(nftables)
    command -v tcpdump  >/dev/null 2>&1 || MISSING_PKGS+=(tcpdump)

    if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
        log "Installing missing system packages: ${MISSING_PKGS[*]}"
        if command -v apt-get >/dev/null 2>&1; then
            sudo apt-get update -qq
            sudo apt-get install -y -qq "${MISSING_PKGS[@]}"
        elif command -v dnf >/dev/null 2>&1; then
            sudo dnf install -y -q "${MISSING_PKGS[@]}"
        elif command -v yum >/dev/null 2>&1; then
            sudo yum install -y -q "${MISSING_PKGS[@]}"
        elif command -v pacman >/dev/null 2>&1; then
            sudo pacman -S --noconfirm "${MISSING_PKGS[@]}"
        else
            fail "Cannot auto-install packages. Manually install: ${MISSING_PKGS[*]}"
        fi
        ok "System packages installed: ${MISSING_PKGS[*]}"
    else
        ok "System packages present (dnsmasq, nftables, tcpdump)"
    fi

    # Ensure dnsmasq is stopped until setup configures it
    if systemctl is-active --quiet dnsmasq 2>/dev/null; then
        log "Stopping dnsmasq (will be configured via setup wizard)..."
        sudo systemctl stop dnsmasq
        sudo systemctl disable dnsmasq 2>/dev/null || true
    fi
else
    log "Not Linux — skipping system package checks (dnsmasq, nftables, tcpdump)"
fi

# ── Backend setup ───────────────────────────────────────────────────
log "Setting up backend..."

cd "$BACKEND_DIR"

# Rebuild the venv if it was created with an unsupported Python (e.g. 3.14),
# otherwise `pip install` will keep trying to compile pydantic-core and fail.
if [[ -d "venv" ]]; then
    VENV_VER=$(venv/bin/python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "")
    VENV_MINOR=${VENV_VER##*.}
    if ! [[ "${VENV_VER%%.*}" == "3" && "$VENV_MINOR" =~ ^[0-9]+$ && "$VENV_MINOR" -ge 11 && "$VENV_MINOR" -le 13 ]]; then
        log "Existing venv uses unsupported Python '${VENV_VER:-unknown}' — rebuilding with ${PYTHON_VER}..."
        rm -rf venv
    fi
fi

if [[ ! -d "venv" ]]; then
    log "Creating Python virtual environment (${PYTHON_BIN} → ${PYTHON_VER})..."
    "$PYTHON_BIN" -m venv venv
fi

source venv/bin/activate
log "Installing Python dependencies..."
pip install -q -r requirements.txt
ok "Backend dependencies installed"

# ── Frontend setup ──────────────────────────────────────────────────
log "Setting up frontend..."

cd "$FRONTEND_DIR"

if [[ ! -d "node_modules" ]]; then
    log "Installing npm packages (first run)..."
    npm install
else
    log "node_modules exists, running npm install to sync..."
    npm install
fi
ok "Frontend dependencies installed"

# ── Ensure config exists ────────────────────────────────────────────
if [[ ! -f "${PROJECT_DIR}/config/jetlag.yaml" ]]; then
    fail "config/jetlag.yaml not found. Copy the example config first."
fi
ok "Config file found"

# ── Start servers ───────────────────────────────────────────────────
log ""
log "Starting JetLag dev servers..."
log "  Backend  → http://0.0.0.0:8080  (API)"
log "  Frontend → http://0.0.0.0:3000  (Admin UI)"
log "  Both are reachable from other machines on the network."
log ""
log "Press Ctrl+C to stop both servers."
log ""

cleanup() {
    log "Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    log "Stopped."
}
trap cleanup EXIT INT TERM

# Start backend
cd "$BACKEND_DIR"
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload &
BACKEND_PID=$!

# Start frontend
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!

# Wait for either to exit
wait -n $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
