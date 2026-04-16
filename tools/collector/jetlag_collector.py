#!/usr/bin/env python3
"""
JetLag Network Impairment Collector

Cross-platform CLI tool (Windows, macOS, Linux) that collects real-world
network impairment data and outputs replay scenario files compatible with
the JetLag Replay Engine.

Usage:
    python jetlag_collector.py --target 8.8.8.8 --duration 60
    python jetlag_collector.py --target 1.1.1.1 --duration 300 --interval 5 --bw-method http
    python jetlag_collector.py --target 10.0.1.1 --duration 120 --bw-method iperf3 --iperf3-server 10.0.1.1
"""
import argparse, datetime, json, math, os, platform, re, statistics
import subprocess, sys, time, urllib.request, urllib.error
from typing import Optional

PLATFORM = platform.system().lower()  # 'windows', 'darwin', 'linux'

DEFAULT_HTTP_URL = "https://speed.cloudflare.com/__down?bytes=1000000"


def ping_host(target: str, count: int = 4, timeout_ms: int = 2000) -> dict:
    """Run ping and parse output for latency, jitter, loss. Works on Windows, macOS, Linux."""
    try:
        if PLATFORM == 'windows':
            cmd = ["ping", "-n", str(count), "-w", str(timeout_ms), target]
        else:
            # macOS and Linux: -c for count, -W for timeout (seconds)
            timeout_sec = max(1, timeout_ms // 1000)
            cmd = ["ping", "-c", str(count), "-W", str(timeout_sec), target]

        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        out = r.stdout

        # Parse RTTs — covers all platforms:
        #   Windows:  "time=42ms" or "time<1ms"
        #   macOS:    "time=42.123 ms"
        #   Linux:    "time=42.1 ms"
        rtts = [float(m.group(1)) for m in re.finditer(r'time[<=](\d+(?:\.\d+)?)\s*ms', out, re.I)]

        # Parse packet loss — covers all platforms:
        #   Windows:  "(25% loss)" or "(25% perdidos)"
        #   macOS:    "25.0% packet loss" or "25% packet loss"
        #   Linux:    "25% packet loss"
        loss_m = re.search(r'(\d+(?:\.\d+)?)%\s*(?:loss|packet\s*loss|perdidos)', out, re.I)
        loss = float(loss_m.group(1)) if loss_m else 0.0

        avg = statistics.mean(rtts) if rtts else 0.0
        jit = statistics.stdev(rtts) if len(rtts) > 1 else 0.0
        return {"latency_ms": round(avg, 1), "jitter_ms": round(jit, 1),
                "packet_loss_percent": round(loss, 1)}
    except Exception:
        return {"latency_ms": 0, "jitter_ms": 0, "packet_loss_percent": 100.0}


def measure_bw_http(url: str = DEFAULT_HTTP_URL, timeout: int = 15) -> float:
    """Measure download bandwidth via HTTP GET. Returns kbps."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "JetLag-Collector/1.0"})
        t0 = time.monotonic()
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        elapsed = time.monotonic() - t0
        return round((len(data) * 8 / elapsed) / 1000, 1) if elapsed > 0 else 0.0
    except Exception as e:
        print(f"  [warn] HTTP bw failed: {e}", file=sys.stderr)
        return 0.0


def measure_bw_iperf3(server: str, port: int = 5201, dur: int = 5) -> float:
    """Measure bandwidth via iperf3 client. Returns kbps."""
    try:
        r = subprocess.run(
            ["iperf3", "-c", server, "-p", str(port), "-t", str(dur), "-J"],
            capture_output=True, text=True, timeout=dur + 15,
        )
        if r.returncode != 0:
            print(f"  [warn] iperf3 error: {r.stderr.strip()}", file=sys.stderr)
            return 0.0
        d = json.loads(r.stdout)
        bps = d.get("end", {}).get("sum_received", {}).get("bits_per_second", 0)
        return round(bps / 1000, 1)
    except FileNotFoundError:
        print("  [warn] iperf3 not found. Use --bw-method http instead.", file=sys.stderr)
        return 0.0
    except Exception as e:
        print(f"  [warn] iperf3 failed: {e}", file=sys.stderr)
        return 0.0


def collect(args) -> dict:
    """Run collection loop, return scenario dict."""
    target, duration, interval = args.target, args.duration, args.interval
    total = math.ceil(duration / interval)
    name = args.name or f"collection_{target}_{datetime.datetime.now():%Y%m%d_%H%M%S}"

    print(f"\nJetLag Network Impairment Collector")
    print(f"{'=' * 50}")
    print(f"  Platform:   {platform.system()} ({platform.release()})")
    print(f"  Target:     {target}")
    print(f"  Duration:   {duration}s ({total} samples)")
    print(f"  Interval:   {interval}s")
    print(f"  BW method:  {args.bw_method or 'none'}")
    print(f"  Output:     {args.output}")
    print(f"{'=' * 50}\n")

    steps, offset_ms, t0, n = [], 0, time.monotonic(), 0
    try:
        while time.monotonic() - t0 < duration:
            n += 1
            ss = time.monotonic()
            p = ping_host(target, count=args.ping_count)
            bw = 0
            if args.bw_method == "http":
                bw = measure_bw_http(args.http_url)
            elif args.bw_method == "iperf3":
                bw = measure_bw_iperf3(args.iperf3_server or target, args.iperf3_port)

            steps.append({
                "timestamp": datetime.datetime.now().isoformat(),
                "offset_ms": offset_ms, "duration_ms": interval * 1000,
                "latency_ms": int(round(p["latency_ms"])),
                "jitter_ms": int(round(p["jitter_ms"])),
                "packet_loss_percent": round(p["packet_loss_percent"], 1),
                "bandwidth_kbps": int(round(bw)),
            })
            rem = duration - (time.monotonic() - t0)
            bw_s = f" | BW: {bw:.0f}kbps" if args.bw_method else ""
            print(f"  [{n}/{total}] Lat:{p['latency_ms']:.1f}ms Jit:{p['jitter_ms']:.1f}ms "
                  f"Loss:{p['packet_loss_percent']:.1f}%{bw_s}  ({rem:.0f}s left)")
            offset_ms += interval * 1000
            sl = max(0, interval - (time.monotonic() - ss))
            if sl > 0 and (time.monotonic() - t0 + sl) < duration:
                time.sleep(sl)
    except KeyboardInterrupt:
        print(f"\n  Interrupted after {n} samples.")

    return {
        "name": name,
        "description": f"Collected from {target} on {datetime.datetime.now().isoformat()} "
                       f"({len(steps)} samples, {interval}s interval)",
        "default_direction": args.direction,
        "total_duration_ms": len(steps) * interval * 1000,
        "steps": steps,
    }


def print_summary(scenario: dict):
    steps = scenario["steps"]
    if not steps:
        print("\nNo data collected."); return
    lats = [s["latency_ms"] for s in steps]
    jits = [s["jitter_ms"] for s in steps]
    loss = [s["packet_loss_percent"] for s in steps]
    bws = [s["bandwidth_kbps"] for s in steps if s["bandwidth_kbps"] > 0]
    print(f"\n{'=' * 50}")
    print(f"  Summary: {len(steps)} samples, {scenario['total_duration_ms']/1000:.0f}s")
    print(f"  Latency:  avg={statistics.mean(lats):.1f}ms  min={min(lats)}  max={max(lats)}")
    if any(j > 0 for j in jits):
        print(f"  Jitter:   avg={statistics.mean(jits):.1f}ms  max={max(jits):.1f}ms")
    print(f"  Loss:     avg={statistics.mean(loss):.1f}%  max={max(loss):.1f}%")
    if bws:
        print(f"  BW:       avg={statistics.mean(bws):.0f}kbps  min={min(bws):.0f}  max={max(bws):.0f}")
    print(f"{'=' * 50}\n")


def main():
    p = argparse.ArgumentParser(
        description="JetLag Network Impairment Collector",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n"
               "  %(prog)s --target 8.8.8.8 --duration 60\n"
               "  %(prog)s --target 1.1.1.1 --duration 300 --bw-method http\n"
               "  %(prog)s --target 10.0.1.1 --duration 120 --bw-method iperf3 --iperf3-server 10.0.1.1\n"
    )
    p.add_argument("--target", "-t", required=True, help="Target IP/hostname to ping")
    p.add_argument("--duration", "-d", type=int, default=60, help="Collection duration in seconds (default: 60)")
    p.add_argument("--interval", "-i", type=int, default=1, help="Sample interval in seconds (default: 1)")
    p.add_argument("--ping-count", type=int, default=4, help="Pings per sample (default: 4)")
    p.add_argument("--bw-method", choices=["http", "iperf3"], default=None,
                   help="Bandwidth measurement method (default: none)")
    p.add_argument("--http-url", default=DEFAULT_HTTP_URL, help="URL for HTTP bandwidth test")
    p.add_argument("--iperf3-server", default=None, help="iperf3 server address (default: same as target)")
    p.add_argument("--iperf3-port", type=int, default=5201, help="iperf3 server port (default: 5201)")
    p.add_argument("--direction", default="outbound", choices=["outbound", "inbound", "both"],
                   help="Default replay direction (default: outbound)")
    p.add_argument("--name", "-n", default=None, help="Scenario name (default: auto-generated)")
    p.add_argument("--format", "-f", dest="fmt", choices=["json", "yaml"], default="json",
                   help="Output format (default: json)")
    p.add_argument("--output", "-o", default=None, help="Output file path (default: auto-generated)")

    args = p.parse_args()

    if args.output is None:
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        args.output = f"jetlag_scenario_{args.target}_{ts}.{args.fmt}"

    scenario = collect(args)
    print_summary(scenario)

    # Write output
    if args.fmt == "yaml":
        try:
            import yaml
            with open(args.output, "w") as f:
                yaml.dump(scenario, f, default_flow_style=False, sort_keys=False)
        except ImportError:
            print("[warn] PyYAML not installed, writing JSON instead.", file=sys.stderr)
            args.output = args.output.rsplit(".", 1)[0] + ".json"
            with open(args.output, "w") as f:
                json.dump(scenario, f, indent=2)
    else:
        with open(args.output, "w") as f:
            json.dump(scenario, f, indent=2)

    print(f"  Scenario saved to: {os.path.abspath(args.output)}")
    print(f"  Import into JetLag via the Replay Engine tab or POST /api/replay/scenarios/import\n")


if __name__ == "__main__":
    main()
