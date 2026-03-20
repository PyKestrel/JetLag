# JetLag — Captive Portal Network Simulator

A Linux-based virtual appliance that simulates hostile, restrictive captive portal network environments (airline Wi-Fi) for testing VPN and Zero Trust clients.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    JetLag Appliance                       │
│                                                           │
│  ┌──────────┐   ┌──────────┐   ┌───────────────────┐    │
│  │ Admin UI │   │ Captive  │   │  Network Services  │    │
│  │ React SPA│   │ Portal   │   │  dnsmasq, nftables │    │
│  │ :3000    │   │ :80/:443 │   │  tc/netem, tcpdump │    │
│  └────┬─────┘   └────┬─────┘   └─────────┬─────────┘    │
│       │              │                     │              │
│  ┌────┴──────────────┴─────────────────────┴──────────┐  │
│  │              FastAPI Backend (:8080)                 │  │
│  │         SQLite DB  |  Service Layer                 │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────────┐                            ┌──────────┐     │
│  │ eth0    │ ◄── WAN (upstream)         │ eth1     │     │
│  │ (WAN)   │                            │ (LAN)    │     │
│  └─────────┘                            └──────────┘     │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- Ubuntu Server 22.04+ (for production / system-level features)

### One-Command Dev Start
Installs all dependencies (Python venv + pip, npm) and launches both servers:

**Linux / macOS:**
```bash
bash scripts/start-dev.sh
```

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1
```

This will start:
- **Backend API** at `http://localhost:8080`
- **Frontend Admin UI** at `http://localhost:5173`

Press `Ctrl+C` to stop both.

### Manual Setup

#### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate        # Linux/macOS
# venv\Scripts\activate         # Windows
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

### System Setup (Linux production, requires root)
```bash
sudo ./scripts/setup.sh
```
Installs dnsmasq, nftables, iproute2, tcpdump, generates SSL certs, and configures system services.

## Project Structure
```
jetlag/
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── main.py          # App entrypoint
│   │   ├── config.py        # Configuration
│   │   ├── database.py      # SQLite/SQLAlchemy setup
│   │   ├── models/          # SQLAlchemy ORM models
│   │   ├── schemas/         # Pydantic request/response schemas
│   │   ├── routers/         # API route handlers
│   │   └── services/        # Business logic & network wrappers
│   └── requirements.txt
├── frontend/                # React admin SPA
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── lib/
│   └── package.json
├── portal/                  # Captive portal static page
├── scripts/                 # System setup & utility scripts
├── config/                  # Default configuration files
└── README.md
```

## Configuration

Edit `config/jetlag.yaml` to configure network interfaces, DHCP ranges, DNS behavior, and default impairment profiles.

## License

Internal tool — not for redistribution.
