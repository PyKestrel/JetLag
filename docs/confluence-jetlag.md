# JetLag — Captive Portal Network Simulator

> **Version:** 0.2.0 | **Platform:** Linux (Ubuntu 22.04+)

---

## 1. Overview

JetLag is a Linux-based virtual appliance that simulates hostile, restrictive captive-portal network environments — specifically airline Wi-Fi — for testing VPN clients, Zero Trust agents, and other connectivity software under real-world adverse conditions.

It acts as an inline network gateway: clients connect to one or more of the appliance's LAN interfaces (including optional VLAN sub-interfaces), are presented with a captive portal page, and once they accept the terms of service, they gain internet access through the appliance's WAN interface(s). Administrators can then apply network impairments (latency, packet loss, bandwidth limits, etc.) to shape and degrade traffic in a controlled, repeatable manner. Multiple WAN and LAN ports can be dynamically added or removed at runtime, each LAN port running its own independent DHCP scope.

### Key Capabilities

| Capability | Description |
|---|---|
| **Captive Portal** | Intercepts unauthenticated HTTP traffic and presents a branded "airline Wi-Fi" splash page |
| **Client Management** | Tracks all connected devices (DHCP + static IP), manages authentication state |
| **Network Impairment** | Applies tc/netem rules for latency, jitter, loss, corruption, reordering, duplication, and bandwidth shaping |
| **Traffic Matching** | Impairments can target specific IPs, subnets, MACs, protocols, ports, or VLANs |
| **Directional Control** | Impairments can be applied inbound, outbound, or both |
| **Packet Capture** | On-demand tcpdump captures with filtering, downloadable as .pcap files |
| **Event Logging** | Structured logs for DHCP, DNS, auth, firewall, impairment, capture, and system events |
| **Multi-Port Support** | Multiple WAN and LAN ports with dynamic add/remove, per-port DHCP, and VLAN tagging |
| **VLAN Support** | Optional VLAN-tagged sub-interfaces with independent DHCP scopes per LAN port |
| **Profile Management** | Simplified single-page editor for existing profiles, disable/enable toggle without deletion |
| **Admin UI** | React-based single-page application for full appliance management |
| **REST API** | Complete JSON API for automation and integration (including port CRUD) |

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          JetLag Appliance                              │
│                                                                        │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐        │
│  │  Admin UI     │   │   Captive    │   │  Network Services   │        │
│  │  React SPA    │   │   Portal     │   │  dnsmasq (per-port) │        │
│  │  :3000 (dev)  │   │  /portal     │   │  nftables           │        │
│  └──────┬───────┘   └──────┬───────┘   │  tc/netem           │        │
│         │                  │            │  tcpdump            │        │
│  ┌──────┴──────────────────┴────────────┴────────────────────┐        │
│  │                 FastAPI Backend (:8080)                     │        │
│  │     SQLite DB  |  Service Layer  |  Middleware  |  Port Mgr │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                        │
│  WAN Ports                               LAN Ports                     │
│  ┌───────────┐                           ┌───────────┐                │
│  │  eth0      │ ◄── WAN 1               │  eth1      │ ◄── LAN 1    │
│  └───────────┘                           │  DHCP scope │               │
│  ┌───────────┐                           └───────────┘                │
│  │  eth2      │ ◄── WAN 2 (optional)    ┌───────────┐                │
│  └───────────┘                           │  eth1.100  │ ◄── LAN 2    │
│       ...                                │  VLAN 100  │    (VLAN)    │
│                                          │  DHCP scope │               │
│                                          └───────────┘                │
│                                               ...                      │
└────────────────────────────────────────────────────────────────────────┘
```

### Component Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18, TypeScript, Vite, TailwindCSS, Radix UI, Lucide icons | Admin dashboard SPA |
| **Backend** | Python 3.11+, FastAPI, Uvicorn, SQLAlchemy (async), Pydantic v2 | REST API, service orchestration |
| **Database** | SQLite via aiosqlite | Persistent storage for clients, profiles, captures, logs |
| **DHCP/DNS** | dnsmasq | Per-port DHCP server for LAN clients (one scope per LAN port/VLAN), DNS forwarding to upstream resolvers |
| **Firewall** | nftables | NAT, captive portal redirect, client authentication enforcement |
| **Traffic Shaping** | Linux tc/netem + HTB | Network impairment (latency, loss, bandwidth) |
| **Packet Capture** | tcpdump | On-demand .pcap captures |
| **Configuration** | YAML (config/jetlag.yaml) | Appliance settings, persisted across restarts |

---

## 3. Captive Portal Flow

The captive portal uses an HTTP-redirect architecture (no DNS spoofing):

```
Client joins LAN
       │
       ▼
┌─────────────────────┐
│ DHCP lease from      │  ◄── dnsmasq assigns IP, gateway, DNS = appliance LAN IP
│ dnsmasq              │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Client resolves DNS  │  ◄── dnsmasq forwards to real upstream (1.1.1.1, 8.8.8.8)
│ (gets REAL answers)  │      Hard-coded DNS (e.g. 8.8.8.8) is DNAT'd to dnsmasq
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Client opens browser │  ◄── HTTP to any site → nftables DNAT to appliance:8080
│ (HTTP, port 80)      │      HTTPS to any site → also DNAT'd to 8080
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ FastAPI middleware    │  ◄── Detects DNAT via Host header mismatch (e.g. "google.com"
│ serves portal page   │      ≠ appliance IP) → returns portal/index.html
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Client clicks        │  ◄── POST /api/portal/accept
│ "Connect to Wi-Fi"   │      → ARP lookup resolves real MAC
│                      │      → Client record created/updated in DB
│                      │      → IP added to nftables authenticated_ips set
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Client authenticated │  ◄── nftables prerouting skips DNAT
│ Full internet access │      Forward chain allows WAN access
│                      │      Masquerade handles NAT
└─────────────────────┘
```

### nftables Ruleset Structure

| Chain | Hook | Purpose |
|---|---|---|
| `prerouting` | dstnat | Skips authenticated IPs; redirects DNS (port 53), HTTP (80→8080), HTTPS (443→8080) for unauthenticated clients on all LAN interfaces |
| `postrouting` | srcnat | Masquerades all traffic leaving each WAN interface (one rule per WAN port) |
| `forward` | filter | Allows authenticated clients from any LAN port to reach any WAN port; drops unauthenticated forwarded traffic; allows established/related return traffic |
| `input` | filter | Accepts all LAN traffic (all LAN ports) to the appliance, SSH on WAN, loopback, established/related |

### Static IP Client Support

Clients using static IPs (no DHCP lease) are fully supported:

- **DNS**: If the client points DNS to the appliance, dnsmasq answers. If they use external DNS (e.g. 8.8.8.8), nftables DNAT intercepts port 53 and redirects to dnsmasq.
- **Portal redirect**: HTTP/HTTPS DNAT to port 8080 works regardless of how the client obtained its IP.
- **MAC resolution**: The portal `accept` endpoint performs an ARP lookup (`ip neigh show`) to resolve the client's real MAC address from the kernel neighbour table.
- **Client discovery**: The `/api/clients/sync-leases` endpoint scans both the dnsmasq lease file and the ARP table to discover all LAN-visible hosts.

---

## 4. Project Structure

```
jetlag/
├── VERSION                      # Semantic version (single source of truth)
├── backend/                     # FastAPI backend
│   ├── app/
│   │   ├── main.py              # App entrypoint, lifespan, middleware
│   │   ├── version.py           # Reads VERSION file, exposes __version__
│   │   ├── config.py            # Pydantic config models, YAML loader
│   │   ├── database.py          # SQLite async engine, session factory
│   │   ├── models/              # SQLAlchemy ORM models
│   │   │   ├── client.py        # Client (mac, ip, auth_state)
│   │   │   ├── impairment_profile.py  # ImpairmentProfile + MatchRule
│   │   │   ├── capture.py       # Capture (tcpdump sessions)
│   │   │   └── event_log.py     # EventLog (structured logging)
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   │   ├── client.py
│   │   │   ├── impairment_profile.py
│   │   │   └── capture.py
│   │   ├── routers/             # API route handlers
│   │   │   ├── overview.py      # GET /api/overview
│   │   │   ├── clients.py       # /api/clients/*
│   │   │   ├── profiles.py      # /api/profiles/*
│   │   │   ├── captures.py      # /api/captures/*
│   │   │   ├── logs.py          # /api/logs
│   │   │   ├── portal.py        # /api/portal/accept, /api/portal/status
│   │   │   ├── settings.py      # /api/settings
│   │   │   └── setup.py         # /api/setup/*
│   │   └── services/            # Business logic & system wrappers
│   │       ├── impairment.py    # tc/netem wrapper
│   │       ├── firewall.py      # nftables wrapper
│   │       ├── dnsmasq.py       # dnsmasq config generation & management
│   │       ├── network.py       # ARP lookup, neighbour table, ping sweep
│   │       ├── capture.py       # tcpdump wrapper
│   │       └── logging_service.py  # Structured DB event logging
│   └── requirements.txt
├── frontend/                    # React admin SPA
│   ├── src/
│   │   ├── pages/
│   │   │   ├── OverviewPage.tsx     # Dashboard with client/profile/service stats
│   │   │   ├── ClientsPage.tsx      # Client list, auth/deauth, bulk reset
│   │   │   ├── ProfilesPage.tsx     # Impairment profile wizard (5-step)
│   │   │   ├── CapturesPage.tsx     # Start/stop/download packet captures
│   │   │   ├── LogsPage.tsx         # Event log viewer with filtering
│   │   │   ├── SettingsPage.tsx     # Appliance configuration editor
│   │   │   └── SetupWizard.tsx      # Initial setup wizard
│   │   ├── lib/
│   │   │   └── api.ts               # API client & TypeScript interfaces
│   │   └── components/              # Shared UI components
│   └── package.json
├── portal/                      # Captive portal splash page
│   └── index.html               # "SkyConnect Airlines" branded page
├── config/
│   └── jetlag.yaml              # Appliance configuration file
└── scripts/
    ├── start-dev.sh             # Linux/macOS dev launcher
    ├── start-dev.ps1            # Windows dev launcher
    ├── bump-version.sh          # SemVer bump (Linux/macOS)
    └── bump-version.ps1         # SemVer bump (Windows)
```

---

## 5. Configuration Reference

All configuration is stored in `config/jetlag.yaml` and loaded at startup. Settings can also be modified at runtime via the Admin UI or the `PUT /api/settings` API.

### 5.1 Top-Level

| Key | Type | Default | Description |
|---|---|---|---|
| `setup_completed` | boolean | `false` | Set to `true` after the setup wizard completes. Controls whether services initialize on startup. |

### 5.2 WAN Ports

```yaml
wan_ports:
  - interface: eth0
    enabled: true
  - interface: eth2
    enabled: true
```

| Key | Type | Default | Description |
|---|---|---|---|
| `interface` | string | — | Network interface name (e.g. `eth0`) |
| `enabled` | boolean | `true` | Whether this WAN port is active |

WAN ports can be dynamically added or removed at runtime via the Admin UI or the port management API. The firewall generates masquerade rules for each enabled WAN port.

### 5.3 LAN Ports

```yaml
lan_ports:
  - interface: eth1
    ip: 10.0.1.1
    subnet: 10.0.1.0/24
    vlan_id: null
    vlan_name: ""
    enabled: true
    dhcp:
      enabled: true
      range_start: 10.0.1.100
      range_end: 10.0.1.250
      lease_time: 1h
      gateway: 10.0.1.1
      dns_server: 10.0.1.1
  - interface: eth1
    ip: 10.0.10.1
    subnet: 10.0.10.0/24
    vlan_id: 100
    vlan_name: "Guest WiFi"
    enabled: true
    dhcp:
      enabled: true
      range_start: 10.0.10.100
      range_end: 10.0.10.250
      lease_time: 1h
      gateway: 10.0.10.1
      dns_server: 10.0.10.1
```

| Key | Type | Default | Description |
|---|---|---|---|
| `interface` | string | — | Base interface name (e.g. `eth1`) |
| `ip` | string | — | IP address for this LAN port |
| `subnet` | string | — | Subnet in CIDR notation |
| `vlan_id` | integer / null | `null` | VLAN tag ID. When set, a sub-interface `<interface>.<vlan_id>` is created |
| `vlan_name` | string | `""` | Human-readable VLAN label |
| `enabled` | boolean | `true` | Whether this LAN port is active |
| `dhcp.enabled` | boolean | `true` | Run a DHCP scope on this port |
| `dhcp.range_start` | string | auto | First IP in DHCP pool |
| `dhcp.range_end` | string | auto | Last IP in DHCP pool |
| `dhcp.lease_time` | string | `1h` | Lease duration |
| `dhcp.gateway` | string | same as `ip` | Gateway advertised to clients |
| `dhcp.dns_server` | string | same as `ip` | DNS server advertised to clients |

Each LAN port gets its own dnsmasq DHCP scope. VLAN sub-interfaces are automatically created on Linux when `vlan_id` is set (e.g. `eth1.100`). The captive portal middleware checks all LAN IPs and subnets for access control.

### 5.4 Network (Legacy)

```yaml
network:
  wan_interface: eth0
  lan_interface: eth1
  lan_ip: 10.0.1.1
  lan_subnet: 10.0.1.0/24
```

| Key | Type | Default | Description |
|---|---|---|---|
| `wan_interface` | string | `eth0` | Primary upstream interface (legacy — prefer `wan_ports`) |
| `lan_interface` | string | `eth1` | Primary client-facing interface (legacy — prefer `lan_ports`) |
| `lan_ip` | string | `10.0.1.1` | Primary LAN IP (legacy — prefer `lan_ports`) |
| `lan_subnet` | string | `10.0.1.0/24` | Primary LAN subnet (legacy — prefer `lan_ports`) |

> **Note:** The `network` section is maintained for backward compatibility. When `wan_ports` and `lan_ports` are present, they take precedence. The setup wizard populates both.

### 5.5 DHCP

```yaml
dhcp:
  enabled: true
  range_start: 10.0.1.100
  range_end: 10.0.1.250
  lease_time: 1h
  gateway: 10.0.1.1
  dns_server: 10.0.1.1
```

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Enable DHCP server on LAN interface |
| `range_start` | string | `10.0.1.100` | First IP in DHCP pool |
| `range_end` | string | `10.0.1.250` | Last IP in DHCP pool |
| `lease_time` | string | `1h` | DHCP lease duration |
| `gateway` | string | `10.0.1.1` | Default gateway advertised to clients |
| `dns_server` | string | `10.0.1.1` | DNS server advertised to clients (should be the appliance LAN IP) |

### 5.6 DNS

```yaml
dns:
  spoof_target: 10.0.1.1
  upstream_servers:
    - 1.1.1.1
    - 8.8.8.8
```

| Key | Type | Default | Description |
|---|---|---|---|
| `spoof_target` | string | `10.0.1.1` | (Legacy — not used in current architecture) |
| `upstream_servers` | list[string] | `[1.1.1.1, 8.8.8.8]` | Real DNS resolvers that dnsmasq forwards queries to |

> **Note:** Captive portal redirect is handled by nftables HTTP DNAT, not by DNS spoofing.

### 5.7 VLANs (Legacy)

```yaml
vlans: []
  # - id: 10
  #   name: "economy-class"
  #   interface: eth1.10
  #   ip: 10.0.10.1
  #   subnet: 10.0.10.0/24
  #   dhcp_range_start: 10.0.10.100
  #   dhcp_range_end: 10.0.10.250
```

| Key | Type | Description |
|---|---|---|
| `id` | integer | VLAN tag ID |
| `name` | string | Human-readable label |
| `interface` | string | Sub-interface name (e.g. `eth1.10`) |
| `ip` | string | Gateway IP for this VLAN |
| `subnet` | string | VLAN subnet in CIDR |
| `dhcp_range_start` | string | First IP in VLAN DHCP pool |
| `dhcp_range_end` | string | Last IP in VLAN DHCP pool |

> **Note:** The `vlans` list is a legacy configuration format. VLAN support is now integrated into the `lan_ports` list (section 5.3) where each LAN port can optionally specify a `vlan_id`. The setup wizard and port management API use `lan_ports` exclusively.

### 5.8 Portal

```yaml
portal:
  http_port: 80
  https_port: 443
  ssl_cert: /etc/jetlag/ssl/portal.crt
  ssl_key: /etc/jetlag/ssl/portal.key
  ssl_cn: "wifi.airline.com"
```

| Key | Type | Default | Description |
|---|---|---|---|
| `http_port` | integer | `80` | (Legacy) HTTP listen port |
| `https_port` | integer | `443` | (Legacy) HTTPS listen port |
| `ssl_cert` | string | `/etc/jetlag/ssl/portal.crt` | Path to self-signed SSL certificate |
| `ssl_key` | string | `/etc/jetlag/ssl/portal.key` | Path to SSL private key |
| `ssl_cn` | string | `wifi.airline.com` | Common Name for generated certificate |

> **Note:** In the current architecture, nftables redirects ports 80/443 to the FastAPI backend on port 8080. The `http_port`/`https_port` settings are reserved for a future standalone portal server.

### 5.9 Admin

```yaml
admin:
  api_port: 8080
  frontend_port: 3000
```

| Key | Type | Default | Description |
|---|---|---|---|
| `api_port` | integer | `8080` | FastAPI backend port |
| `frontend_port` | integer | `3000` | Vite dev server port (development only) |

### 5.10 Captures

```yaml
captures:
  output_dir: /var/lib/jetlag/captures
  max_file_size_mb: 100
```

| Key | Type | Default | Description |
|---|---|---|---|
| `output_dir` | string | `/var/lib/jetlag/captures` | Directory for .pcap output files |
| `max_file_size_mb` | integer | `100` | Maximum size per capture file (tcpdump `-C` flag) |

### 5.11 Logging

```yaml
logging:
  level: INFO
  file: /var/log/jetlag/jetlag.log
  max_size_mb: 50
  backup_count: 5
```

| Key | Type | Default | Description |
|---|---|---|---|
| `level` | string | `INFO` | Log verbosity (DEBUG, INFO, WARNING, ERROR) |
| `file` | string | `/var/log/jetlag/jetlag.log` | Log file path |
| `max_size_mb` | integer | `50` | Max log file size before rotation |
| `backup_count` | integer | `5` | Number of rotated log files to retain |

---

## 6. Database Schema

SQLite database stored at `backend/data/jetlag.db` (configurable via `JETLAG_DB_DIR` env var). Auto-created on first startup.

### 6.1 `clients`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, autoincrement | |
| `mac_address` | VARCHAR(17) | UNIQUE, indexed | Client MAC (or `unknown-{ip}` placeholder) |
| `ip_address` | VARCHAR(45) | nullable | Current IP address |
| `hostname` | VARCHAR(255) | nullable | Hostname from DHCP or mDNS |
| `vlan_id` | INTEGER | nullable | VLAN tag if applicable |
| `auth_state` | ENUM | `pending` / `authenticated` | Current authentication state |
| `first_seen` | DATETIME | | When client was first discovered |
| `last_seen` | DATETIME | auto-updated | Last activity timestamp |
| `authenticated_at` | DATETIME | nullable | When client was last authenticated |

### 6.2 `impairment_profiles`

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | INTEGER | PK | |
| `name` | VARCHAR(255) | UNIQUE | Profile name |
| `description` | TEXT | nullable | |
| `enabled` | BOOLEAN | `false` | Whether tc rules are currently active |
| `direction` | VARCHAR(10) | `outbound` | `outbound`, `inbound`, or `both` |
| `latency_ms` | INTEGER | `0` | Added delay in milliseconds |
| `jitter_ms` | INTEGER | `0` | Jitter variation in milliseconds |
| `latency_correlation` | FLOAT | `0.0` | Latency correlation % |
| `latency_distribution` | VARCHAR(20) | `""` | Distribution model (normal, pareto, paretonormal) |
| `packet_loss_percent` | FLOAT | `0.0` | Packet loss % |
| `loss_correlation` | FLOAT | `0.0` | Loss correlation % |
| `corruption_percent` | FLOAT | `0.0` | Bit-flip corruption % |
| `corruption_correlation` | FLOAT | `0.0` | Corruption correlation % |
| `reorder_percent` | FLOAT | `0.0` | Packet reordering % (requires latency > 0) |
| `reorder_correlation` | FLOAT | `0.0` | Reordering correlation % |
| `duplicate_percent` | FLOAT | `0.0` | Packet duplication % |
| `duplicate_correlation` | FLOAT | `0.0` | Duplication correlation % |
| `bandwidth_limit_kbps` | INTEGER | `0` | Bandwidth cap in kbit/s (0 = unlimited) |
| `bandwidth_burst_kbytes` | INTEGER | `0` | HTB burst buffer in kbytes |
| `bandwidth_ceil_kbps` | INTEGER | `0` | HTB ceil rate in kbit/s |
| `created_at` | DATETIME | | |
| `updated_at` | DATETIME | auto-updated | |

### 6.3 `match_rules`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | PK |
| `profile_id` | INTEGER | FK → `impairment_profiles.id` (CASCADE delete) |
| `src_ip` | VARCHAR(45) | Source IP filter (`0.0.0.0` = any) |
| `dst_ip` | VARCHAR(45) | Destination IP filter |
| `src_subnet` | VARCHAR(49) | Source subnet in CIDR (`0.0.0.0/0` = any) |
| `dst_subnet` | VARCHAR(49) | Destination subnet in CIDR |
| `mac_address` | VARCHAR(17) | MAC address filter |
| `vlan_id` | INTEGER | VLAN tag filter |
| `protocol` | VARCHAR(10) | `tcp`, `udp`, or `icmp` |
| `port` | INTEGER | Destination port filter |

### 6.4 `captures`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | PK |
| `name` | VARCHAR(255) | Capture name |
| `state` | ENUM | `running` / `stopped` / `error` |
| `file_path` | VARCHAR(512) | Absolute path to .pcap file |
| `file_size_bytes` | BIGINT | File size |
| `filter_ip` | VARCHAR(45) | IP filter applied |
| `filter_mac` | VARCHAR(17) | MAC filter applied |
| `filter_vlan` | INTEGER | VLAN filter applied |
| `filter_expression` | VARCHAR(512) | Raw tcpdump filter expression |
| `pid` | INTEGER | tcpdump process ID |
| `started_at` | DATETIME | |
| `stopped_at` | DATETIME | nullable |

### 6.5 `event_logs`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | PK |
| `category` | ENUM | `dhcp`, `dns`, `auth`, `firewall`, `impairment`, `capture`, `system` |
| `level` | VARCHAR(10) | `INFO`, `WARNING`, `ERROR` |
| `message` | TEXT | Human-readable event message |
| `source_ip` | VARCHAR(45) | nullable |
| `source_mac` | VARCHAR(17) | nullable |
| `details` | TEXT | nullable, extra context |
| `created_at` | DATETIME | indexed |

---

## 7. REST API Reference

**Base URL:** `http://<appliance-ip>:8080/api`

All responses are JSON. Paginated endpoints return:
```json
{ "items": [...], "total": 100, "page": 1, "per_page": 25, "pages": 4 }
```

### 7.1 Setup

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/setup/status` | Check if initial setup has been completed. Includes `wan_ports` and `lan_ports` arrays. |
| `GET` | `/api/setup/interfaces` | List detected network interfaces with state, MAC, IPv4 addresses |
| `POST` | `/api/setup/complete` | Finalize setup: configure LAN IP, start dnsmasq, nftables, tc/netem, enable IP forwarding |
| `POST` | `/api/setup/reset` | Reset setup status (dev/testing) |
| `GET` | `/api/setup/ports` | List all configured WAN and LAN ports |
| `POST` | `/api/setup/ports/wan` | Add a WAN port (reloads firewall) |
| `DELETE` | `/api/setup/ports/wan/{interface}` | Remove a WAN port |
| `POST` | `/api/setup/ports/lan` | Add a LAN port with optional VLAN and DHCP config (reloads dnsmasq + firewall) |
| `DELETE` | `/api/setup/ports/lan/{interface}` | Remove a LAN port (use `eth1.100` format for VLAN sub-interfaces) |

**POST /api/setup/complete** request body:
```json
{
  "wan_interface": "eth0",
  "lan_interface": "eth1",
  "lan_ip": "10.0.1.1",
  "lan_subnet": "10.0.1.0/24",
  "dhcp_enabled": true,
  "dhcp_range_start": "10.0.1.100",
  "dhcp_range_end": "10.0.1.250",
  "dhcp_lease_time": "1h",
  "dns_upstream": ["1.1.1.1", "8.8.8.8"]
}
```

**POST /api/setup/ports/wan** request body:
```json
{
  "interface": "eth2",
  "enabled": true
}
```

**POST /api/setup/ports/lan** request body:
```json
{
  "interface": "eth1",
  "ip": "10.0.10.1",
  "subnet": "10.0.10.0/24",
  "vlan_id": 100,
  "vlan_name": "Guest WiFi",
  "enabled": true,
  "dhcp_enabled": true,
  "dhcp_range_start": "10.0.10.100",
  "dhcp_range_end": "10.0.10.250",
  "dhcp_lease_time": "1h"
}
```

Port endpoints return the updated port list in the response:
```json
{
  "message": "LAN port eth1.100 added",
  "lan_ports": [{ "interface": "eth1", "ip": "10.0.1.1", "subnet": "10.0.1.0/24", ... }, ...]
}
```

### 7.2 Overview

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/overview` | Dashboard stats: client counts, profile counts, active captures, dnsmasq status |

### 7.3 Clients

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/clients` | List clients (paginated, filterable by `auth_state`, `vlan_id`) |
| `GET` | `/api/clients/{id}` | Get single client |
| `POST` | `/api/clients/{id}/authenticate` | Authenticate client (add to nftables set) |
| `POST` | `/api/clients/{id}/deauthenticate` | Deauthenticate client (remove from nftables set) |
| `POST` | `/api/clients/sync-leases` | Sync clients from DHCP leases + ARP table |
| `POST` | `/api/clients/bulk/reset` | Reset all clients to pending, flush nftables set |

### 7.4 Captive Portal

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/portal/accept` | Client accepts TOS (auto-creates record, ARP lookup, adds to nftables) |
| `GET` | `/api/portal/status` | Check if the calling client's IP is authenticated |

### 7.5 Impairment Profiles

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/profiles` | List profiles (paginated) |
| `GET` | `/api/profiles/{id}` | Get profile with match rules |
| `POST` | `/api/profiles` | Create profile (optionally enable immediately) |
| `PUT` | `/api/profiles/{id}` | Update profile |
| `DELETE` | `/api/profiles/{id}` | Delete profile (removes tc rules if active) |

**POST /api/profiles** request body:
```json
{
  "name": "Airline Wi-Fi Simulation",
  "description": "Simulates typical in-flight connectivity",
  "enabled": true,
  "direction": "both",
  "latency_ms": 600,
  "jitter_ms": 200,
  "packet_loss_percent": 5.0,
  "bandwidth_limit_kbps": 2048,
  "match_rules": [
    {
      "src_subnet": "10.0.1.0/24",
      "protocol": "tcp",
      "port": 443
    }
  ]
}
```

### 7.6 Captures

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/captures` | List captures (paginated) |
| `POST` | `/api/captures` | Start a new tcpdump capture |
| `POST` | `/api/captures/{id}/stop` | Stop a running capture |
| `GET` | `/api/captures/{id}/download` | Download .pcap file |
| `DELETE` | `/api/captures/{id}` | Delete capture record and file |

**POST /api/captures** request body:
```json
{
  "name": "Debug VPN traffic",
  "filter_ip": "10.0.1.150",
  "filter_mac": "aa:bb:cc:dd:ee:ff",
  "filter_vlan": 10,
  "filter_expression": "tcp port 443"
}
```

### 7.7 Event Logs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/logs` | List logs (paginated, filterable by `category`, `level`, `source_ip`) |
| `DELETE` | `/api/logs` | Clear logs (optionally by `category`) |

### 7.8 Settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/settings` | Get all appliance settings |
| `PUT` | `/api/settings` | Update settings (partial update, only send sections to change) |

### 7.9 Health & Version

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Returns `{"status": "ok", "service": "jetlag", "version": "0.2.0"}` |
| `GET` | `/api/version` | Returns structured version info: `{"version": "0.2.0", "major": 0, "minor": 2, "patch": 0, "prerelease": null}` |

---

## 8. Admin UI Pages

The admin dashboard is a React SPA accessible at `http://<appliance-ip>:3000` (dev) or served from the backend at `http://<appliance-ip>:8080/` (production build).

| Page | Route | Description |
|---|---|---|
| **Setup Wizard** | `/setup` | First-run wizard: select WAN/LAN interfaces, configure DHCP, DNS upstream servers |
| **Overview** | `/` | Dashboard showing client count (pending/authenticated), active profiles, running captures, dnsmasq status |
| **Clients** | `/clients` | Table of all discovered clients with MAC, IP, hostname, VLAN, auth state. Actions: authenticate, deauthenticate, bulk reset, sync leases |
| **Profiles** | `/profiles` | Impairment profile management: 5-step wizard for new profiles, simplified single-page flat editor for existing profiles, disable/enable toggle |
| **Captures** | `/captures` | Start/stop tcpdump captures with filters, download .pcap files |
| **Logs** | `/logs` | Searchable event log viewer with category and level filters |
| **Settings** | `/settings` | Multi-port management (WAN/LAN add/remove with VLAN and per-port DHCP), plus all YAML configuration sections |

### Profile Creation Wizard (5 Steps — New Profiles)

| Step | Name | Fields |
|---|---|---|
| 1 | **Name & description** | Profile name, description text |
| 2 | **Direction** | Outbound, Inbound, or Both |
| 3 | **Impairment parameters** | Latency (ms), jitter (ms), packet loss (%), corruption (%), reordering (%), duplication (%), bandwidth limit (kbps) |
| 4 | **Traffic match rules** | Match type selector (Single IP / Subnet / MAC Address) with conditional fields, plus protocol, port, VLAN. Multiple rules supported. |
| 5 | **Review & deploy** | Summary table, enable-immediately toggle, save/create button |

### Profile Flat Editor (Existing Profiles)

When editing an existing profile, a simplified single-page editor opens instead of the multi-step wizard. All settings are visible at once in collapsible card sections:

| Section | Fields |
|---|---|
| **Profile information** | Name, direction, description, enabled toggle |
| **Latency / Jitter** | Delay (ms), jitter (ms), correlation (%), distribution |
| **Loss, Corruption, Reorder & Duplication** | All percentage and correlation fields in a compact 4-column grid |
| **Rate control** | Bandwidth limit (kbps), ceil (kbps), burst (KB) |
| **Traffic match rules** | Add/remove rules with match type (IP/Subnet/MAC), protocol, port, VLAN ID |

The flat editor includes a sticky header bar and bottom save bar with **Save changes** and **Cancel** buttons. The **Enabled** toggle in the profile information section allows disabling a profile without deleting it — disabled profiles remain in the database but their tc/netem rules are not applied.

### Settings Page — Port Management

The Settings page now includes two new sections at the top:

| Section | Description |
|---|---|
| **WAN Ports** | Lists all configured WAN ports with enabled/disabled status badges. Add new WAN ports by selecting from detected interfaces. Remove ports with confirmation. |
| **LAN Ports** | Lists all LAN ports showing IP, subnet, VLAN tag, DHCP range, and lease time. Add new LAN ports with IP, subnet, optional VLAN ID/name, and DHCP range. Remove ports with confirmation. |

Port changes take effect immediately — the backend reloads dnsmasq and nftables after each add/remove operation. The legacy Network and DHCP sections remain below for backward-compatible single-interface configuration.

---

## 9. Network Impairment Engine

Impairments are applied using Linux **tc** (traffic control) with **HTB** (Hierarchical Token Bucket) queueing and **netem** (network emulator).

### How It Works

```
                    ┌──── Outbound (egress) ────┐
 LAN clients ─────►│  eth1 root HTB qdisc       │─────► WAN
                    │   ├── class 1:99 (default) │
                    │   ├── class 1:101 (profile) │
                    │   │    └── netem qdisc      │
                    │   └── u32 filters           │
                    └────────────────────────────┘

                    ┌──── Inbound (ingress) ─────┐
 WAN ──────────────►│  eth1 ingress qdisc        │
                    │   └── mirred redirect ──────┼──► ifb0 root HTB qdisc
                    │                             │     ├── class 1:99 (default)
                    └─────────────────────────────┘     ├── class 1:101 (profile)
                                                        │    └── netem qdisc
                                                        └── u32 filters
```

- **Outbound**: Rules are applied directly on the LAN interface (`eth1`).
- **Inbound**: An IFB (Intermediate Functional Block) device (`ifb0`) is created. Ingress traffic on the LAN interface is redirected to `ifb0` via a `mirred` action, where HTB + netem rules shape it.
- **Both**: Rules are applied on both devices simultaneously.

### tc Filter Generation

Match rules are translated to `tc u32` filters:

| Match Rule Field | tc Filter |
|---|---|
| `src_ip: 10.0.1.50` | `match ip src 10.0.1.50/32` |
| `dst_subnet: 192.168.0.0/16` | `match ip dst 192.168.0.0/16` |
| `protocol: tcp` | `match ip protocol 6 0xff` |
| `protocol: udp` | `match ip protocol 17 0xff` |
| `protocol: icmp` | `match ip protocol 1 0xff` |
| `port: 443` | `match ip dport 443 0xffff` |
| (no criteria) | `match u32 0 0 at 0` (match all) |

Wildcard values (`0.0.0.0`, `0.0.0.0/0`) are skipped. If no match criteria remain, a universal catch-all filter is used.

---

## 10. Services Reference

### 10.1 FirewallService (`backend/app/services/firewall.py`)

| Method | Description |
|---|---|
| `initialize()` | Load full nftables ruleset (flush + recreate) with rules for all WAN/LAN port combinations. Called on setup completion, startup, and after port add/remove. |
| `allow_client(ip, mac)` | Add IP to `authenticated_ips` set (24h timeout) |
| `intercept_client(ip, mac)` | Remove IP from `authenticated_ips` set |
| `reset_all()` | Flush the entire `authenticated_ips` set |
| `get_authenticated_ips()` | List all currently authenticated IPs (JSON parsing of nft output) |

### 10.2 ImpairmentService (`backend/app/services/impairment.py`)

| Method | Description |
|---|---|
| `initialize()` | Set up HTB root qdisc on the LAN interface |
| `apply_profile(profile)` | Create HTB class + netem qdisc + u32 filters for a profile (direction-aware) |
| `remove_profile(profile)` | Remove all tc objects for a profile |
| `remove_all()` | Tear down all rules and re-initialize |

### 10.3 DnsmasqService (`backend/app/services/dnsmasq.py`)

| Method | Description |
|---|---|
| `generate_config()` | Write `/etc/dnsmasq.d/jetlag.conf` with per-port DHCP scopes (one `dhcp-range` per enabled LAN port, VLAN-aware interface binding) |
| `restart()` | `systemctl restart dnsmasq` |
| `reload()` | `systemctl reload dnsmasq` (falls back to restart) |
| `get_leases()` | Parse dnsmasq lease file, return list of `{mac, ip, hostname}` |
| `status()` | Check if dnsmasq is running via systemctl |

### 10.4 NetworkService (`backend/app/services/network.py`)

| Method | Description |
|---|---|
| `arp_lookup(ip)` | Resolve IP → MAC via `ip neigh show` or `/proc/net/arp` |
| `get_arp_table()` | Return all ARP neighbour entries |
| `get_lan_neighbours()` | ARP entries filtered to the LAN interface |
| `ping_sweep(subnet)` | Send a fast ping sweep (fping or nmap) to populate the ARP table |

### 10.5 CaptureService (`backend/app/services/capture.py`)

| Method | Description |
|---|---|
| `start(data)` | Launch tcpdump subprocess with filters, return Capture record |
| `stop(capture)` | Send SIGTERM to the tcpdump process |

### 10.6 LoggingService (`backend/app/services/logging_service.py`)

| Method | Description |
|---|---|
| `log_auth_event(db, ip, mac, action)` | Log authentication/deauth events |
| `log_dhcp_event(db, message, ip, mac)` | Log DHCP events |
| `log_dns_event(db, message, ip)` | Log DNS events |
| `log_firewall_event(db, message, ip)` | Log firewall rule changes |
| `log_impairment_event(db, message)` | Log impairment profile changes |
| `log_capture_event(db, message, ip)` | Log capture start/stop events |
| `log_system_event(db, message, level)` | Log general system events |

---

## 11. Deployment & Installation

### Prerequisites

| Requirement | Minimum Version | Notes |
|---|---|---|
| **OS** | Ubuntu Server 22.04+ | Any modern Linux with systemd |
| **Python** | 3.11+ | For the FastAPI backend |
| **Node.js** | 20+ | For the frontend build |
| **dnsmasq** | Any | DHCP + DNS |
| **nftables** | 0.9+ | Firewall (replaces iptables) |
| **iproute2** | 5.0+ | tc/netem for traffic shaping |
| **tcpdump** | 4.9+ | Packet capture |
| **Hardware** | 2+ NICs | Minimum one for WAN and one for LAN; additional NICs supported for multi-port configurations |

### Quick Start (Development)

```bash
# Clone the repository
git clone <repo-url> && cd jetlag

# One-command start (installs all dependencies automatically)
sudo bash scripts/start-dev.sh
```

This will:
1. Check for Python 3.11+ and Node.js 20+
2. Install system packages if missing (dnsmasq, nftables, tcpdump)
3. Create Python venv and install pip packages
4. Run `npm install` for the frontend
5. Start the backend on `http://0.0.0.0:8080`
6. Start the frontend dev server on `http://0.0.0.0:3000`

### Production Build

```bash
# Build the frontend
cd frontend && npm run build

# The built SPA is served by FastAPI from frontend/dist/
# Start the backend only:
cd backend
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

### First-Time Setup

1. Open the Admin UI at `http://<appliance-ip>:3000` (dev) or `http://<appliance-ip>:8080` (prod)
2. The **Setup Wizard** will appear automatically
3. Select the **WAN interface** (internet uplink) and **LAN interface** (client-facing)
4. Configure DHCP range and upstream DNS servers
5. Click **Complete Setup**

Setup will automatically:
- Assign the configured IP to the LAN interface (and create VLAN sub-interfaces if needed)
- Generate and start dnsmasq with per-port DHCP scopes
- Load the nftables ruleset with rules for all configured WAN/LAN port combinations
- Initialize tc/netem root qdiscs
- Enable IP forwarding (`net.ipv4.ip_forward=1`)

After initial setup, additional WAN and LAN ports can be added at any time via the **Settings** page or the port management API (`/api/setup/ports/*`). Each new LAN port can optionally specify a VLAN tag and its own DHCP scope.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JETLAG_CONFIG` | `config/jetlag.yaml` | Path to the configuration file |
| `JETLAG_DB_DIR` | `backend/data/` | Directory for the SQLite database |

---

## 12. Versioning

JetLag uses [Semantic Versioning](https://semver.org/) (SemVer). The single source of truth is the `VERSION` file at the project root.

### Version Format

```
MAJOR.MINOR.PATCH[-PRERELEASE]
```

| Segment | When to increment |
|---|---|
| **MAJOR** | Breaking API or config changes |
| **MINOR** | New features, backward-compatible |
| **PATCH** | Bug fixes, backward-compatible |
| **PRERELEASE** | Optional suffix (e.g. `1.0.0-beta.1`) |

### Where the Version Lives

| Location | Description |
|---|---|
| `VERSION` | **Source of truth** — plain text file at project root |
| `backend/app/version.py` | Python module that reads `VERSION`; exposes `__version__` and `get_version_info()` |
| `frontend/package.json` | `"version"` field (synced by bump script) |
| `docs/confluence-jetlag.md` | Header and footer version references (synced by bump script) |
| FastAPI `app.version` | Set from `__version__` at startup |
| `GET /api/version` | Returns `{"version", "major", "minor", "patch", "prerelease"}` |
| `GET /api/health` | Includes `"version"` in response |
| Admin UI footer | Fetches version from `/api/version` on load |

### Bumping the Version

**Linux / macOS:**
```bash
./scripts/bump-version.sh patch    # 0.2.0 → 0.2.1
./scripts/bump-version.sh minor    # 0.2.0 → 0.3.0
./scripts/bump-version.sh major    # 0.2.0 → 1.0.0
./scripts/bump-version.sh set 1.0.0-rc.1  # explicit version
```

**Windows (PowerShell):**
```powershell
.\scripts\bump-version.ps1 patch
.\scripts\bump-version.ps1 minor
.\scripts\bump-version.ps1 major
.\scripts\bump-version.ps1 set 1.0.0-rc.1
```

The bump scripts update `VERSION`, `frontend/package.json`, and `docs/confluence-jetlag.md` in one step. After bumping:
```bash
git add VERSION frontend/package.json docs/confluence-jetlag.md
git commit -m "chore: bump version to <new-version>"
git tag v<new-version>
```

---

## 13. Troubleshooting

### Client can't get an IP address
- Verify dnsmasq is running: `systemctl status dnsmasq`
- Check the generated config: `cat /etc/dnsmasq.d/jetlag.conf`
- Ensure the LAN interface has the correct IP: `ip addr show <lan_interface>`

### Captive portal page doesn't appear
- Verify nftables rules are loaded: `nft list ruleset`
- Check the prerouting chain has DNAT rules for ports 80 and 443
- Ensure the backend is running on port 8080: `curl http://localhost:8080/api/health`
- Check the middleware log for DNAT detection

### Client authenticates but has no internet
- Verify the client IP is in the authenticated set: `nft list set inet jetlag authenticated_ips`
- Check IP forwarding: `sysctl net.ipv4.ip_forward` (should be 1)
- Verify the WAN interface has internet: `ping -I <wan_interface> 8.8.8.8`
- Check the forward chain allows authenticated traffic: `nft list chain inet jetlag forward`

### Impairment profiles don't take effect
- Verify the profile is enabled in the database
- Check tc rules: `tc qdisc show dev <lan_interface>` and `tc class show dev <lan_interface>`
- Check tc filters: `tc filter show dev <lan_interface>`
- For inbound rules, also check `tc qdisc show dev ifb0`

### nftables initialization fails
- The `inet` table requires `dnat ip to` (not bare `dnat to`) for IPv4 DNAT rules
- Run `nft -c -f - <<< '...'` to validate ruleset syntax before applying

### Database schema errors after code update
- Delete the existing database to force recreation: `rm backend/data/jetlag.db`
- Restart the backend — tables will be auto-created

---

## 14. Security Considerations

| Area | Implementation |
|---|---|
| **Admin access** | After setup, the admin API/UI is restricted to LAN-originating requests only. WAN access returns 403. |
| **SSH** | Port 22 is allowed on the WAN interface for remote administration. |
| **Captive portal** | HTTPS interception will show TLS errors to clients (expected; portal detection uses HTTP). |
| **API** | No authentication on the API (relies on network-level LAN restriction). Consider adding API keys for production. |
| **Database** | SQLite file stored locally. No encryption at rest. |
| **nftables** | The `authenticated_ips` set has a 24-hour timeout — clients are automatically deauthenticated. |

---

## 15. Example Impairment Profiles

### Airline Wi-Fi (Economy)
```json
{
  "name": "Economy Wi-Fi",
  "direction": "both",
  "latency_ms": 600,
  "jitter_ms": 200,
  "packet_loss_percent": 5.0,
  "bandwidth_limit_kbps": 1024,
  "match_rules": []
}
```

### Satellite Backhaul
```json
{
  "name": "Satellite Link",
  "direction": "both",
  "latency_ms": 1200,
  "jitter_ms": 100,
  "packet_loss_percent": 2.0,
  "corruption_percent": 0.1,
  "bandwidth_limit_kbps": 5120,
  "match_rules": []
}
```

### Selective VPN Throttling
```json
{
  "name": "Throttle VPN",
  "direction": "outbound",
  "bandwidth_limit_kbps": 256,
  "packet_loss_percent": 10.0,
  "match_rules": [
    { "protocol": "udp", "port": 1194 },
    { "protocol": "udp", "port": 51820 }
  ]
}
```

---

*Document generated from codebase analysis — JetLag v0.2.0*
