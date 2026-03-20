# JetLag Dev Server — Install & Start (Windows/PowerShell)
# Installs all dependencies and starts both backend + frontend dev servers.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1

$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir  = Split-Path -Parent $ScriptDir
$BackendDir  = Join-Path $ProjectDir "backend"
$FrontendDir = Join-Path $ProjectDir "frontend"

function Log($msg)  { Write-Host "[jetlag] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[  ok ] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "[fail] $msg" -ForegroundColor Red; exit 1 }

# ── Pre-flight checks ──────────────────────────────────────────────
Log "Checking prerequisites..."

if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Fail "python not found. Install Python 3.11+." }
if (-not (Get-Command node -ErrorAction SilentlyContinue))   { Fail "node not found. Install Node.js 20+." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue))    { Fail "npm not found. Install Node.js 20+." }

$pyVer   = python --version 2>&1
$nodeVer = node --version 2>&1
Ok "$pyVer, Node $nodeVer"

# ── Backend setup ───────────────────────────────────────────────────
Log "Setting up backend..."
Push-Location $BackendDir

if (-not (Test-Path "venv")) {
    Log "Creating Python virtual environment..."
    python -m venv venv
}

# Activate venv
$activateScript = Join-Path "venv" "Scripts" "Activate.ps1"
if (Test-Path $activateScript) {
    & $activateScript
} else {
    Fail "Could not find venv activation script at $activateScript"
}

Log "Installing Python dependencies..."
pip install -q -r requirements.txt
Ok "Backend dependencies installed"
Pop-Location

# ── Frontend setup ──────────────────────────────────────────────────
Log "Setting up frontend..."
Push-Location $FrontendDir

if (-not (Test-Path "node_modules")) {
    Log "Installing npm packages (first run)..."
} else {
    Log "node_modules exists, syncing..."
}
npm install
Ok "Frontend dependencies installed"
Pop-Location

# ── Ensure config exists ────────────────────────────────────────────
$configPath = Join-Path $ProjectDir "config" "jetlag.yaml"
if (-not (Test-Path $configPath)) {
    Fail "config/jetlag.yaml not found."
}
Ok "Config file found"

# ── Start servers ───────────────────────────────────────────────────
Log ""
Log "Starting JetLag dev servers..."
Log "  Backend  -> http://0.0.0.0:8080  (API)"
Log "  Frontend -> http://0.0.0.0:3000  (Admin UI)"
Log "  Both are reachable from other machines on the network."
Log ""
Log "Press Ctrl+C to stop both servers."
Log ""

# Start backend in background job
$backendJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    & (Join-Path "venv" "Scripts" "Activate.ps1")
    uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
} -ArgumentList $BackendDir

# Start frontend in background job
$frontendJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    npm run dev
} -ArgumentList $FrontendDir

# Stream output and wait
try {
    while ($true) {
        Receive-Job $backendJob  -ErrorAction SilentlyContinue
        Receive-Job $frontendJob -ErrorAction SilentlyContinue

        if ($backendJob.State -eq "Completed" -or $backendJob.State -eq "Failed") {
            Log "Backend stopped."
            break
        }
        if ($frontendJob.State -eq "Completed" -or $frontendJob.State -eq "Failed") {
            Log "Frontend stopped."
            break
        }
        Start-Sleep -Milliseconds 500
    }
} finally {
    Log "Shutting down..."
    Stop-Job $backendJob  -ErrorAction SilentlyContinue
    Stop-Job $frontendJob -ErrorAction SilentlyContinue
    Remove-Job $backendJob  -Force -ErrorAction SilentlyContinue
    Remove-Job $frontendJob -Force -ErrorAction SilentlyContinue
    Log "Stopped."
}
