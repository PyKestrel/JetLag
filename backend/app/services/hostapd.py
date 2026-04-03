"""hostapd service wrapper for WLAN access point management.

Provides:
  - WLAN interface detection (iw dev / /sys/class/net/*/wireless)
  - hostapd.conf generation from WirelessConfig
  - Interface IP assignment + DHCP integration via dnsmasq
  - Start / stop / restart / status helpers
  - Connected-stations query
"""
import asyncio
import logging
import platform
from pathlib import Path
from typing import Optional

from app.config import settings

logger = logging.getLogger("jetlag.hostapd")

_IS_LINUX = platform.system() == "Linux"

HOSTAPD_CONF_PATH = "/etc/jetlag/hostapd.conf"
HOSTAPD_PID_FILE = "/run/jetlag-hostapd.pid"


class HostapdService:
    """Manage hostapd for creating a software access point."""

    # ── Shell helper ─────────────────────────────────────────────

    @staticmethod
    async def _run(cmd: str) -> tuple[str, str, int]:
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        return stdout.decode().strip(), stderr.decode().strip(), proc.returncode

    # ── Detection ────────────────────────────────────────────────

    @staticmethod
    async def detect_wlan_interfaces() -> list[dict]:
        """Return a list of wireless-capable interfaces on this system.

        Each entry: {"interface": "wlan0", "driver": "...", "phy": "phy0", "addr": "..."}
        """
        if not _IS_LINUX:
            return []

        interfaces: list[dict] = []

        # Method 1: iw dev (most reliable)
        out, _, rc = await HostapdService._run("iw dev 2>/dev/null")
        if rc == 0 and out:
            current: dict = {}
            for line in out.splitlines():
                line = line.strip()
                if line.startswith("Interface"):
                    if current.get("interface"):
                        interfaces.append(current)
                    current = {"interface": line.split()[-1], "driver": "", "phy": "", "addr": ""}
                elif line.startswith("addr"):
                    current["addr"] = line.split()[-1]
                elif line.startswith("type"):
                    current["type"] = line.split()[-1]
            if current.get("interface"):
                interfaces.append(current)

        # If iw is not available, fall back to /sys/class/net
        if not interfaces:
            try:
                for net_dir in Path("/sys/class/net").iterdir():
                    wireless_dir = net_dir / "wireless"
                    if wireless_dir.exists():
                        iface_name = net_dir.name
                        # Read MAC address
                        addr_file = net_dir / "address"
                        addr = addr_file.read_text().strip() if addr_file.exists() else ""
                        interfaces.append({
                            "interface": iface_name,
                            "driver": "",
                            "phy": "",
                            "addr": addr,
                        })
            except OSError:
                pass

        # Enrich with driver info
        for iface in interfaces:
            name = iface["interface"]
            driver_link = Path(f"/sys/class/net/{name}/device/driver")
            if driver_link.is_symlink() or driver_link.exists():
                try:
                    iface["driver"] = driver_link.resolve().name
                except OSError:
                    pass
            # Get phy name
            out2, _, rc2 = await HostapdService._run(f"iw dev {name} info 2>/dev/null")
            if rc2 == 0:
                for line in out2.splitlines():
                    if "wiphy" in line:
                        try:
                            iface["phy"] = f"phy{line.split()[-1]}"
                        except (IndexError, ValueError):
                            pass

        return interfaces

    @staticmethod
    async def get_phy_capabilities(interface: str) -> dict:
        """Return radio capabilities for the given interface's phy.

        Returns supported bands, channels, HT/VHT capability, etc.
        """
        if not _IS_LINUX:
            return {}

        # Get phy name
        out, _, rc = await HostapdService._run(f"iw dev {interface} info 2>/dev/null")
        phy = None
        if rc == 0:
            for line in out.splitlines():
                if "wiphy" in line:
                    try:
                        phy = f"phy{line.split()[-1]}"
                    except (IndexError, ValueError):
                        pass

        if not phy:
            return {"error": "Could not determine phy for interface"}

        out2, _, rc2 = await HostapdService._run(f"iw phy {phy} info 2>/dev/null")
        if rc2 != 0:
            return {"error": "Failed to query phy info"}

        capabilities: dict = {
            "phy": phy,
            "bands": [],
            "channels_2g": [],
            "channels_5g": [],
            "ht": False,
            "vht": False,
        }

        current_band = ""
        for line in out2.splitlines():
            stripped = line.strip()
            if "Band 1:" in line:
                current_band = "2.4GHz"
                capabilities["bands"].append("2.4GHz")
            elif "Band 2:" in line:
                current_band = "5GHz"
                capabilities["bands"].append("5GHz")
            elif "* " in stripped and "MHz" in stripped and "[" in stripped:
                # Channel line: * 2412 MHz [1] (20.0 dBm)
                try:
                    parts = stripped.split()
                    freq = int(parts[1])
                    chan = int(parts[2].strip("[]"))
                    disabled = "disabled" in stripped.lower() or "no IR" in stripped
                    entry = {"channel": chan, "frequency": freq, "disabled": disabled}
                    if current_band == "2.4GHz":
                        capabilities["channels_2g"].append(entry)
                    elif current_band == "5GHz":
                        capabilities["channels_5g"].append(entry)
                except (IndexError, ValueError):
                    pass
            elif "HT" in stripped and "capabilities" in stripped.lower():
                capabilities["ht"] = True
            elif "VHT" in stripped and "capabilities" in stripped.lower():
                capabilities["vht"] = True

        return capabilities

    # ── Configuration generation ─────────────────────────────────

    @staticmethod
    async def generate_config() -> str:
        """Generate /etc/jetlag/hostapd.conf from current WirelessConfig."""
        cfg = settings.wireless

        lines = [
            "# JetLag hostapd configuration — auto-generated",
            f"interface={cfg.interface}",
            "driver=nl80211",
            f"ssid={cfg.ssid}",
            f"hw_mode={cfg.hw_mode}",
            f"channel={cfg.channel}",
        ]

        # In hotspot mode the virtual AP shares the physical radio which
        # already has its regulatory domain from the station connection.
        # Setting country_code again triggers a COUNTRY_UPDATE that fails
        # with "Failed to set beacon parameters".
        if not cfg.hotspot_mode:
            lines.append(f"country_code={cfg.country_code}")
            lines.append("ieee80211d=1")

        lines += [
            f"max_num_sta={cfg.max_clients}",
            "",
            "# Logging",
            "logger_syslog=-1",
            "logger_syslog_level=2",
            "logger_stdout=-1",
            "logger_stdout_level=2",
            "",
        ]

        # Hidden SSID
        if cfg.hidden:
            lines.append("ignore_broadcast_ssid=1")
        else:
            lines.append("ignore_broadcast_ssid=0")

        # 802.11n / HT
        if cfg.ieee80211n:
            lines.append("ieee80211n=1")
            lines.append("wmm_enabled=1")
        else:
            lines.append("ieee80211n=0")

        # 802.11ac / VHT (requires 5GHz)
        if cfg.ieee80211ac and cfg.hw_mode == "a":
            lines.append("ieee80211ac=1")
        else:
            lines.append("ieee80211ac=0")

        # DFS compliance (required for 5GHz with ieee80211d)
        if cfg.hw_mode == "a" and not cfg.hotspot_mode:
            lines.append("ieee80211h=1")

        lines.append("")

        # Security
        if cfg.wpa == 0:
            # Open network
            lines.append("auth_algs=1")
            lines.append("wpa=0")
        else:
            lines.append("auth_algs=1")
            lines.append(f"wpa={cfg.wpa}")
            lines.append(f"wpa_passphrase={cfg.wpa_passphrase}")
            lines.append(f"wpa_key_mgmt={cfg.wpa_key_mgmt}")
            lines.append(f"rsn_pairwise={cfg.rsn_pairwise}")

        config_content = "\n".join(lines) + "\n"

        conf_path = Path(HOSTAPD_CONF_PATH)
        conf_path.parent.mkdir(parents=True, exist_ok=True)
        conf_path.write_text(config_content)

        logger.info(f"hostapd config written to {HOSTAPD_CONF_PATH} (SSID={cfg.ssid})")
        return config_content

    # ── Interface setup ──────────────────────────────────────────

    @staticmethod
    async def setup_interface() -> bool:
        """Assign IP to the WLAN interface and bring it up.

        In bridge mode, the interface is added to the LAN bridge instead.
        """
        cfg = settings.wireless
        iface = cfg.interface

        logger.info(
            f"setup_interface: iface={iface}, hotspot_mode={cfg.hotspot_mode}, "
            f"bridge_to_lan={cfg.bridge_to_lan}, ip={cfg.ip}, subnet={cfg.subnet}"
        )

        if cfg.bridge_to_lan:
            logger.info(f"Bridge mode: {iface} will be managed by hostapd + bridge")
            return True

        # Check interface exists before configuring
        out, err, rc = await HostapdService._run(f"ip link show {iface}")
        logger.info(f"setup_interface: 'ip link show {iface}' rc={rc}, out={out[:200]}, err={err[:200]}")
        if rc != 0:
            logger.error(f"Interface {iface} does not exist: {err}")
            return False

        # Standalone mode: assign IP to WLAN interface
        # Flush existing IP and assign the configured one
        out, err, rc = await HostapdService._run(f"ip addr flush dev {iface}")
        logger.info(f"setup_interface: 'ip addr flush dev {iface}' rc={rc}, err={err}")

        prefix_len = cfg.subnet.split('/')[-1]
        ip_cmd = f"ip addr add {cfg.ip}/{prefix_len} dev {iface}"
        out, err, rc = await HostapdService._run(ip_cmd)
        logger.info(f"setup_interface: '{ip_cmd}' rc={rc}, out={out}, err={err}")
        if rc != 0:
            logger.error(f"Failed to assign IP to {iface}: {err}")
            return False

        # Bring up interface — skip for virtual AP interfaces (hotspot mode)
        # because the kernel doesn't allow manually bringing a __ap type
        # interface UP; hostapd itself will bring it UP when it starts.
        if not cfg.hotspot_mode:
            out, err, rc = await HostapdService._run(f"ip link set {iface} up")
            logger.info(f"setup_interface: 'ip link set {iface} up' rc={rc}, err={err}")
            if rc != 0:
                logger.error(f"Failed to bring up {iface}: {err}")
                return False
        else:
            logger.info(f"setup_interface: hotspot mode — skipping 'ip link set up' (hostapd will bring it UP)")

        logger.info(f"WLAN interface {iface} configured with IP {cfg.ip}/{prefix_len}")
        return True

    @staticmethod
    async def teardown_interface():
        """Remove IP from WLAN interface."""
        cfg = settings.wireless
        iface = cfg.interface
        await HostapdService._run(f"ip addr flush dev {iface}")
        logger.info(f"WLAN interface {iface} IP flushed")

    # ── Start / Stop / Restart ───────────────────────────────────

    @staticmethod
    async def start() -> dict:
        """Start the hostapd access point.

        Steps:
          1. Generate hostapd.conf
          2. Setup interface IP
          3. Start hostapd process
          4. Integrate WLAN into dnsmasq + firewall
        """
        if not _IS_LINUX:
            return {"success": False, "error": "Wireless AP requires Linux"}

        cfg = settings.wireless
        logger.info(
            f"start: begin — interface={cfg.interface}, hotspot_mode={cfg.hotspot_mode}, "
            f"enabled={cfg.enabled}, ssid={cfg.ssid}, channel={cfg.channel}"
        )

        # Check interface exists
        interfaces = await HostapdService.detect_wlan_interfaces()
        iface_names = [i["interface"] for i in interfaces]
        logger.info(f"start: detected WLAN interfaces: {iface_names}")
        if cfg.interface not in iface_names:
            logger.error(f"start: target interface '{cfg.interface}' not in {iface_names}")
            return {
                "success": False,
                "error": f"Interface '{cfg.interface}' not found. Available: {iface_names}",
            }

        # Generate config
        config_content = await HostapdService.generate_config()
        logger.info(f"start: hostapd.conf generated ({len(config_content)} bytes)")

        # Configure the interface IP (and bring UP for non-hotspot)
        ok = await HostapdService.setup_interface()
        if not ok:
            logger.error("start: setup_interface() returned False — aborting")
            return {"success": False, "error": "Failed to configure WLAN interface"}
        logger.info("start: setup_interface() succeeded")

        # Set system regulatory domain before starting hostapd.
        # Skip in hotspot mode — the radio already has its regulatory domain
        # from the active station connection; changing it causes beacon errors.
        if not cfg.hotspot_mode:
            reg_cmd = f"iw reg set {cfg.country_code}"
            out, err, rc = await HostapdService._run(reg_cmd)
            logger.info(f"start: '{reg_cmd}' rc={rc}, err={err}")
            if rc == 0:
                await asyncio.sleep(0.5)

        # Stop existing hostapd if running
        out, err, rc = await HostapdService._run("pkill -f 'hostapd.*jetlag' 2>/dev/null")
        logger.info(f"start: pkill hostapd rc={rc}")
        await asyncio.sleep(0.5)

        # Dump the config file content for debugging
        try:
            conf_on_disk = Path(HOSTAPD_CONF_PATH).read_text()
            logger.info(f"start: hostapd.conf on disk:\n{conf_on_disk}")
        except Exception as e:
            logger.error(f"start: could not read {HOSTAPD_CONF_PATH}: {e}")

        # Start hostapd in background
        hostapd_cmd = f"hostapd -B -P {HOSTAPD_PID_FILE} {HOSTAPD_CONF_PATH}"
        logger.info(f"start: running '{hostapd_cmd}'")
        out, err, rc = await HostapdService._run(hostapd_cmd)
        logger.info(f"start: hostapd rc={rc}, stdout={out[:500]}, stderr={err[:500]}")
        if rc != 0:
            # Run with -dd in foreground to capture detailed error output
            logger.error(f"hostapd -B failed (rc={rc}), running -dd diagnostic...")
            # timeout the foreground run after 5s so we don't hang
            hostapd_debug_cmd = f"timeout 5 hostapd -dd {HOSTAPD_CONF_PATH} 2>&1 || true"
            debug_out, debug_err, debug_rc = await HostapdService._run(hostapd_debug_cmd)
            diag = (debug_out + "\n" + debug_err).strip()
            logger.error(f"hostapd -dd diagnostic output:\n{diag}")
            return {
                "success": False,
                "error": f"hostapd failed (rc={rc}): {err[:200] or out[:200] or 'no output'}\n\nDiagnostic:\n{diag[:500]}",
            }

        # Verify hostapd is actually running (it may fork to bg then exit)
        await asyncio.sleep(1)
        verify_out, _, verify_rc = await HostapdService._run(
            "pgrep -f 'hostapd.*jetlag' 2>/dev/null"
        )
        if verify_rc != 0:
            logger.error("start: hostapd exited immediately after daemonizing — running diagnostic")
            hostapd_debug_cmd = f"timeout 5 hostapd -dd {HOSTAPD_CONF_PATH} 2>&1 || true"
            debug_out, debug_err, debug_rc = await HostapdService._run(hostapd_debug_cmd)
            diag = (debug_out + "\n" + debug_err).strip()
            logger.error(f"hostapd -dd diagnostic output:\n{diag}")
            return {
                "success": False,
                "error": f"hostapd daemonized but exited immediately.\n\nDiagnostic:\n{diag[:500]}",
            }

        logger.info(f"hostapd started and verified running: SSID={cfg.ssid} on {cfg.interface}")

        # In hotspot mode, the virtual AP is registered as a LAN port,
        # so dnsmasq + firewall already cover it — skip integration.
        if not cfg.hotspot_mode:
            # Integrate into dnsmasq (add WLAN DHCP scope)
            try:
                await HostapdService._integrate_dnsmasq()
            except Exception as e:
                logger.error(f"Failed to integrate WLAN into dnsmasq: {e}")

            # Integrate into nftables (add WLAN rules)
            try:
                await HostapdService._integrate_firewall()
            except Exception as e:
                logger.error(f"Failed to integrate WLAN into firewall: {e}")

        return {"success": True, "ssid": cfg.ssid, "interface": cfg.interface}

    @staticmethod
    async def stop() -> dict:
        """Stop hostapd and tear down WLAN interface."""
        if not _IS_LINUX:
            return {"success": False, "error": "Not on Linux"}

        cfg = settings.wireless
        logger.info(f"stop: begin — interface={cfg.interface}, hotspot_mode={cfg.hotspot_mode}")

        # Kill hostapd
        pid_path = Path(HOSTAPD_PID_FILE)
        if pid_path.exists():
            pid = pid_path.read_text().strip()
            logger.info(f"stop: killing hostapd pid={pid}")
            await HostapdService._run(f"kill {pid} 2>/dev/null")
            pid_path.unlink(missing_ok=True)
        else:
            logger.info("stop: no PID file, using pkill")
            await HostapdService._run("pkill -f 'hostapd.*jetlag' 2>/dev/null")

        await asyncio.sleep(0.5)

        # Tear down interface
        await HostapdService.teardown_interface()

        # Log interface state after teardown
        out, err, rc = await HostapdService._run(f"ip link show {cfg.interface} 2>/dev/null")
        logger.info(f"stop: after teardown 'ip link show {cfg.interface}' rc={rc}, out={out[:300]}")

        # Check if iw still sees the interface
        out2, _, rc2 = await HostapdService._run("iw dev 2>/dev/null")
        logger.info(f"stop: 'iw dev' after stop: {out2[:500]}")

        logger.info("hostapd stopped")
        return {"success": True}

    @staticmethod
    async def restart() -> dict:
        """Stop then start hostapd."""
        cfg = settings.wireless
        logger.info(f"restart: begin — interface={cfg.interface}, hotspot_mode={cfg.hotspot_mode}")
        stop_result = await HostapdService.stop()
        logger.info(f"restart: stop completed, result={stop_result}")

        # In hotspot mode, check if the virtual AP interface survived the stop.
        # Some drivers/kernels remove the __ap interface when hostapd exits.
        if cfg.hotspot_mode:
            out, err, rc = await HostapdService._run(f"ip link show {cfg.interface} 2>/dev/null")
            if rc != 0:
                logger.warning(
                    f"restart: virtual AP {cfg.interface} disappeared after stop — "
                    f"recreating from {cfg.wan_interface}"
                )
                from app.routers.setup import _create_virtual_ap
                ok = await _create_virtual_ap(cfg.wan_interface, cfg.interface)
                if not ok:
                    logger.error(f"restart: failed to recreate virtual AP {cfg.interface}")
                    return {"success": False, "error": f"Failed to recreate virtual AP {cfg.interface}"}
                logger.info(f"restart: virtual AP {cfg.interface} recreated successfully")

        start_result = await HostapdService.start()
        logger.info(f"restart: start completed, result={start_result}")
        return start_result

    @staticmethod
    async def status() -> dict:
        """Return current hostapd/AP status."""
        if not _IS_LINUX:
            return {
                "running": False,
                "status": "not available",
                "note": "Wireless AP requires Linux",
            }

        cfg = settings.wireless

        # Check if hostapd process is running
        out, _, rc = await HostapdService._run("pgrep -f 'hostapd.*jetlag' 2>/dev/null")
        running = rc == 0 and bool(out.strip())

        # Get connected stations count
        stations = []
        if running:
            stations = await HostapdService.get_connected_stations()

        # Check if WLAN interface has an IP
        iface_ip = None
        out2, _, rc2 = await HostapdService._run(
            f"ip -4 addr show {cfg.interface} 2>/dev/null"
        )
        if rc2 == 0:
            for line in out2.splitlines():
                if "inet " in line:
                    iface_ip = line.strip().split()[1]
                    break

        return {
            "running": running,
            "enabled": cfg.enabled,
            "interface": cfg.interface,
            "ssid": cfg.ssid,
            "channel": cfg.channel,
            "hw_mode": cfg.hw_mode,
            "security": "Open" if cfg.wpa == 0 else f"WPA{cfg.wpa}",
            "ip": iface_ip,
            "connected_clients": len(stations),
            "stations": stations,
        }

    # ── Connected stations ───────────────────────────────────────

    @staticmethod
    async def get_connected_stations() -> list[dict]:
        """Query hostapd for connected client stations."""
        cfg = settings.wireless
        stations: list[dict] = []

        # Method 1: iw dev <iface> station dump
        out, _, rc = await HostapdService._run(
            f"iw dev {cfg.interface} station dump 2>/dev/null"
        )
        if rc == 0 and out:
            current: dict = {}
            for line in out.splitlines():
                line = line.strip()
                if line.startswith("Station"):
                    if current:
                        stations.append(current)
                    mac = line.split()[1]
                    current = {"mac": mac, "signal": "", "rx_bytes": 0, "tx_bytes": 0, "connected_time": ""}
                elif "signal:" in line:
                    current["signal"] = line.split(":")[-1].strip()
                elif "rx bytes:" in line:
                    try:
                        current["rx_bytes"] = int(line.split(":")[-1].strip())
                    except ValueError:
                        pass
                elif "tx bytes:" in line:
                    try:
                        current["tx_bytes"] = int(line.split(":")[-1].strip())
                    except ValueError:
                        pass
                elif "connected time:" in line:
                    current["connected_time"] = line.split(":")[-1].strip()
            if current:
                stations.append(current)

        return stations

    # ── Private integration helpers ──────────────────────────────

    @staticmethod
    async def _integrate_dnsmasq():
        """Regenerate dnsmasq config to include WLAN DHCP scope, then restart."""
        from app.services.dnsmasq import DnsmasqService
        await DnsmasqService.generate_config()
        await DnsmasqService.restart()

    @staticmethod
    async def _integrate_firewall():
        """Add nftables rules for the WLAN interface (captive portal redirect + NAT)."""
        from app.services.firewall import FirewallService

        cfg = settings.wireless
        iface = cfg.interface
        portal_ip = cfg.ip

        if cfg.bridge_to_lan:
            # In bridge mode, traffic goes through the LAN bridge — no extra rules needed
            return

        # Add prerouting rules for WLAN clients (same pattern as LAN ports)
        rules = [
            f'nft add rule inet jetlag prerouting iifname "{iface}" ip saddr @authenticated_ips accept',
            f'nft add rule inet jetlag prerouting iifname "{iface}" udp dport 53 dnat ip to {portal_ip}:53',
            f'nft add rule inet jetlag prerouting iifname "{iface}" tcp dport 53 dnat ip to {portal_ip}:53',
            f'nft add rule inet jetlag prerouting iifname "{iface}" tcp dport 80 dnat ip to {portal_ip}:8080',
            f'nft add rule inet jetlag prerouting iifname "{iface}" tcp dport 443 dnat ip to {portal_ip}:8080',
        ]

        # Add forward rules for WLAN → WAN
        for wi in settings.all_wan_interfaces():
            rules.extend([
                f'nft add rule inet jetlag forward iifname "{iface}" ip saddr @authenticated_ips oifname "{wi}" accept',
                f'nft add rule inet jetlag forward iifname "{wi}" oifname "{iface}" ct state established,related accept',
            ])

        # Add input rule: allow traffic from WLAN to appliance
        rules.append(f'nft add rule inet jetlag input iifname "{iface}" accept')

        for cmd in rules:
            _, err, rc = await HostapdService._run(cmd)
            if rc != 0:
                logger.warning(f"nft rule failed: {err} ({cmd})")

        logger.info(f"Firewall rules added for WLAN interface {iface}")
