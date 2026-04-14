# JetLag Network Impairment Collector

A standalone Windows CLI tool that collects real-world network impairment data
(latency, jitter, packet loss, bandwidth) and outputs replay scenario files
compatible with the JetLag Replay Engine.

## Requirements

- Python 3.8+
- Windows (uses `ping -n`)
- Optional: `iperf3` in PATH for iperf3 bandwidth measurement
- Optional: `PyYAML` for YAML output (`pip install pyyaml`)

## Usage

```bash
# Basic: ping only, 60 seconds, 1-second interval
python jetlag_collector.py --target 8.8.8.8 --duration 60

# With HTTP bandwidth measurement
python jetlag_collector.py --target 1.1.1.1 --duration 300 --interval 5 --bw-method http

# With iperf3 bandwidth measurement
python jetlag_collector.py --target 10.0.1.1 --duration 120 --bw-method iperf3 --iperf3-server 10.0.1.1

# Custom output
python jetlag_collector.py --target 8.8.8.8 --duration 60 --format yaml --output my_scenario.yaml
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--target`, `-t` | required | Target IP or hostname to ping |
| `--duration`, `-d` | 60 | Collection duration in seconds |
| `--interval`, `-i` | 1 | Sample interval in seconds |
| `--ping-count` | 4 | Number of pings per sample |
| `--bw-method` | none | Bandwidth method: `http` or `iperf3` |
| `--http-url` | Cloudflare | URL for HTTP download test |
| `--iperf3-server` | same as target | iperf3 server address |
| `--iperf3-port` | 5201 | iperf3 server port |
| `--direction` | outbound | Default replay direction |
| `--name`, `-n` | auto | Scenario name |
| `--format`, `-f` | json | Output format: `json` or `yaml` |
| `--output`, `-o` | auto | Output file path |

## Output Format

The tool outputs a file directly importable into JetLag's Replay Engine:

```json
{
  "name": "collection_8.8.8.8_20250414_120000",
  "description": "Collected from 8.8.8.8 on 2025-04-14T12:00:00 (60 samples, 1s interval)",
  "default_direction": "outbound",
  "total_duration_ms": 60000,
  "steps": [
    {
      "offset_ms": 0,
      "duration_ms": 1000,
      "latency_ms": 12,
      "jitter_ms": 2,
      "packet_loss_percent": 0.0,
      "bandwidth_kbps": 50000
    }
  ]
}
```

## Importing into JetLag

1. **Web UI**: Go to Profiles > Replay Engine tab > click "Import Scenario"
2. **API**: `POST /api/replay/scenarios/import` with the file as multipart form data
