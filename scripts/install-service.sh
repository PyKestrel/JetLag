#!/usr/bin/env bash
#
# install-service.sh — Install JetLag as a systemd service
#
# Usage: sudo bash scripts/install-service.sh [/path/to/jetlag]
#
# If no path is given, defaults to the parent directory of this script.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${1:-$(dirname "$SCRIPT_DIR")}"
SERVICE_FILE="/etc/systemd/system/jetlag.service"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[jetlag]${NC} $*"; }
ok()   { echo -e "${GREEN}[  ok ]${NC} $*"; }
fail() { echo -e "${RED}[fail]${NC} $*"; exit 1; }

# ── Check root ────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    fail "This script must be run as root (sudo)."
fi

# ── Validate project directory ────────────────────────────────────
if [[ ! -f "${PROJECT_DIR}/VERSION" ]]; then
    fail "VERSION file not found in ${PROJECT_DIR}. Is this the JetLag project root?"
fi

if [[ ! -f "${PROJECT_DIR}/backend/requirements.txt" ]]; then
    fail "backend/requirements.txt not found. Is this the JetLag project root?"
fi

log "Installing JetLag service from: ${PROJECT_DIR}"

# ── Ensure venv exists ────────────────────────────────────────────
if [[ ! -d "${PROJECT_DIR}/backend/venv" ]]; then
    log "Creating Python virtual environment..."
    python3 -m venv "${PROJECT_DIR}/backend/venv"
    "${PROJECT_DIR}/backend/venv/bin/pip" install -q -r "${PROJECT_DIR}/backend/requirements.txt"
    ok "Virtual environment created"
fi

# ── Build frontend if needed ──────────────────────────────────────
if [[ ! -d "${PROJECT_DIR}/frontend/dist" ]]; then
    log "Building frontend..."
    pushd "${PROJECT_DIR}/frontend" > /dev/null
    npm install --silent
    npm run build
    popd > /dev/null
    ok "Frontend built"
fi

# ── Generate service file from template ───────────────────────────
log "Generating systemd unit file..."

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=JetLag Captive Portal Network Simulator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${PROJECT_DIR}/backend
Environment=JETLAG_CONFIG=${PROJECT_DIR}/config/jetlag.yaml
Environment=JETLAG_DB_DIR=${PROJECT_DIR}/backend/data
ExecStart=${PROJECT_DIR}/backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=jetlag

# Hardening
ProtectSystem=false
PrivateTmp=true
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
EOF

ok "Service file written to ${SERVICE_FILE}"

# ── Enable and start ──────────────────────────────────────────────
log "Enabling and starting jetlag.service..."
systemctl daemon-reload
systemctl enable jetlag.service
systemctl restart jetlag.service

# Wait for it to come up
sleep 2
if systemctl is-active --quiet jetlag.service; then
    ok "jetlag.service is running"
else
    log "Service may still be starting. Check: journalctl -u jetlag -f"
fi

echo ""
log "Installation complete!"
log "  Service status:  systemctl status jetlag"
log "  View logs:       journalctl -u jetlag -f"
log "  Admin UI:        http://<appliance-ip>:8080"
echo ""
