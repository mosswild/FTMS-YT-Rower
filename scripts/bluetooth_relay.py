#!/usr/bin/env python3
"""
FTMS-Rower: Standalone Bluetooth Relay Bridge
============================================
Scans for Bluetooth FTMS rowing machines (0x1826 / 0x2AD1) and BLE Heart Rate monitors (0x180D),
decodes real-time rowing metrics, and relays them to the FTMS-Rower server via WebSocket or HTTP.

Enables devices without Web Bluetooth support (such as standard iOS Safari over local Wi-Fi)
to receive live telemetry, drive the cockpit HUD, and modulate scenic video speed.

Requirements:
    pip install bleak

Usage:
    # Scan for nearby rowing machines:
    python scripts/bluetooth_relay.py --scan

    # Connect to first detected FTMS rower and relay to server:
    python scripts/bluetooth_relay.py --server http://192.168.1.100:8000

    # Connect to a specific rower by name or address:
    python scripts/bluetooth_relay.py --server http://192.168.1.100:8000 --name "Merach"
"""

import argparse
import asyncio
import datetime
import json
import logging
import shutil
import sys
import time
import urllib.request
import urllib.error

# FTMS UUIDs
FTMS_SERVICE_UUID = "00001826-0000-1000-8000-00805f9b34fb"
ROWER_DATA_CHAR_UUID = "00002ad1-0000-1000-8000-00805f9b34fb"
HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT_CHAR_UUID = "00002a37-0000-1000-8000-00805f9b34fb"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("BLE-Relay")


class ConsoleHUD:
    """Renders a single-line real-time status display without flooding the terminal with scrolling logs."""
    def __init__(self, verbose: bool = False):
        self.verbose = verbose

    def update(self, text: str):
        """Updates the single status line in-place using carriage return and width padding."""
        if self.verbose:
            logger.info(text)
            return
        try:
            cols = max(40, shutil.get_terminal_size((80, 24)).columns - 1)
        except Exception:
            cols = 79
        # Truncate if exceeds column width to prevent unintended terminal wrapping
        display_text = text[:cols]
        # Pad with spaces to clear any leftover characters from previous longer lines
        padded = display_text.ljust(cols)
        sys.stdout.write(f"\r{padded}")
        sys.stdout.flush()

    def log(self, text: str):
        """Prints a persistent event message on a fresh line, clearing the in-place status line first."""
        if not self.verbose:
            try:
                cols = max(40, shutil.get_terminal_size((80, 24)).columns - 1)
            except Exception:
                cols = 79
            sys.stdout.write("\r" + " " * cols + "\r")
        print(text)
        sys.stdout.flush()

    def clear(self):
        """Clears the live status line."""
        if not self.verbose:
            try:
                cols = max(40, shutil.get_terminal_size((80, 24)).columns - 1)
            except Exception:
                cols = 79
            sys.stdout.write("\r" + " " * cols + "\r")
            sys.stdout.flush()


def format_telemetry_summary(device_name: str, metrics: dict) -> str:
    """Formats live rowing telemetry into a concise, compact single-line HUD string with a live updating timestamp."""
    parts = []

    # 1. Cadence
    spm = metrics.get("stroke_rate")
    if spm is not None:
        parts.append(f"{spm} SPM")

    # 2. Power
    watts = metrics.get("watts")
    if watts is not None:
        parts.append(f"{watts}W")

    # 3. 500m Split
    split_s = metrics.get("split_seconds")
    if split_s is not None:
        if 0 < split_s < 3600:
            parts.append(f"{split_s // 60}:{split_s % 60:02d}/500m")
        else:
            parts.append("--/500m")

    # 4. Total Distance
    dist = metrics.get("distance")
    if dist is not None:
        parts.append(f"{dist:,}m")

    # 5. Elapsed Time
    el = metrics.get("elapsed_seconds")
    if el is not None:
        parts.append(f"{el // 60:02d}:{el % 60:02d}")

    # 6. Resistance (if reported)
    res = metrics.get("resistance")
    if res is not None:
        parts.append(f"Res:{res}")

    # 7. Heart Rate (if reported)
    hr = metrics.get("hr")
    if hr is not None:
        parts.append(f"{hr}bpm")

    body = " | ".join(parts) if parts else "Receiving packets..."

    t_str = datetime.datetime.now().strftime("%I:%M:%S %p")
    tag = device_name[:14] if len(device_name) > 14 else device_name

    line = f"[{t_str}] [{tag}] {body}"

    try:
        cols = max(40, shutil.get_terminal_size((80, 24)).columns - 1)
    except Exception:
        cols = 79

    # If line is tight on standard 80-col terminals, shorten device tag (e.g. MRK-2CEE)
    if len(line) > cols and "-" in tag:
        tag_short = "MRK-" + tag.split("-")[-1] if tag.startswith("MRK") else tag.split("-")[-1]
        line = f"[{t_str}] [{tag_short}] {body}"

    return line


def format_scan_status(last_connected_dt, nearby_count: int = 0) -> str:
    """Formats the real-time scanning status line."""
    status = "[Scanning] Searching for FTMS rower..."
    extra = []
    if nearby_count > 0:
        extra.append(f"{nearby_count} BLE device(s) seen")
    if last_connected_dt:
        t_str = last_connected_dt.strftime("%I:%M:%S %p")
        extra.append(f"Last connected: {t_str} - Pull handle to wake")
    else:
        extra.append("Pull handle or press dial to wake")

    return f"{status} ({' | '.join(extra)})"


def parse_ftms_rower_data(data: bytearray) -> dict:
    """Decodes Bluetooth SIG FTMS Rower Data (0x2AD1) packet."""
    if len(data) < 2:
        return {}

    flags = int.from_bytes(data[0:2], byteorder="little")
    idx = 2
    parsed = {
        "timestamp": time.time(),
        "source": "ble-relay"
    }

    # Bit 0: More Data (0 = Stroke Rate & Stroke Count present)
    if not (flags & (1 << 0)) and idx + 3 <= len(data):
        raw_spm = data[idx]
        # Standard FTMS is 0.5 stroke/min; some devices report direct SPM
        parsed["stroke_rate"] = round(raw_spm * 0.5) if raw_spm > 50 else raw_spm
        idx += 1
        parsed["total_strokes"] = int.from_bytes(data[idx:idx+2], byteorder="little")
        idx += 2

    # Bit 1: Average Stroke Rate present
    if (flags & (1 << 1)) and idx + 1 <= len(data):
        idx += 1

    # Bit 2: Total Distance present (uint24 in meters)
    if (flags & (1 << 2)) and idx + 3 <= len(data):
        parsed["distance"] = int.from_bytes(data[idx:idx+3], byteorder="little")
        idx += 3

    # Bit 3: Instantaneous Pace present (uint16 in seconds per 500m)
    if (flags & (1 << 3)) and idx + 2 <= len(data):
        parsed["split_seconds"] = int.from_bytes(data[idx:idx+2], byteorder="little")
        idx += 2

    # Bit 4: Average Pace present
    if (flags & (1 << 4)) and idx + 2 <= len(data):
        idx += 2

    # Bit 5: Instantaneous Power present (sint16 in watts)
    if (flags & (1 << 5)) and idx + 2 <= len(data):
        parsed["watts"] = int.from_bytes(data[idx:idx+2], byteorder="little", signed=True)
        idx += 2

    # Bit 6: Average Power present
    if (flags & (1 << 6)) and idx + 2 <= len(data):
        idx += 2

    # Bit 7: Resistance Level present (sint16 in 0.1 resolution or uint8)
    if (flags & (1 << 7)) and idx + 1 <= len(data):
        if idx + 2 <= len(data):
            raw_res = int.from_bytes(data[idx:idx+2], byteorder="little", signed=True)
            parsed["resistance"] = round(raw_res * 0.1) if raw_res > 50 else raw_res
            idx += 2
        else:
            parsed["resistance"] = data[idx]
            idx += 1

    # Bit 8: Expended Energy present (uint16 total, uint16/hr, uint8/min)
    if (flags & (1 << 8)) and idx + 5 <= len(data):
        idx += 5

    # Bit 9: Heart Rate present (uint8)
    if (flags & (1 << 9)) and idx + 1 <= len(data):
        parsed["hr"] = data[idx]
        idx += 1

    # Bit 10: Metabolic Equivalent present
    if (flags & (1 << 10)) and idx + 1 <= len(data):
        idx += 1

    # Bit 11: Elapsed Time present (uint16 in seconds)
    if (flags & (1 << 11)) and idx + 2 <= len(data):
        parsed["elapsed_seconds"] = int.from_bytes(data[idx:idx+2], byteorder="little")
        idx += 2

    return parsed


def parse_hr_measurement(data: bytearray) -> dict:
    """Decodes standard Bluetooth SIG Heart Rate Measurement (0x2A37)."""
    if len(data) < 2:
        return {}
    flags = data[0]
    hr_is_16bit = bool(flags & 0x01)
    bpm = int.from_bytes(data[1:3], byteorder="little") if hr_is_16bit else data[1]
    return {
        "hr": bpm,
        "heart_rate": bpm,
        "timestamp": time.time(),
        "source": "ble-relay"
    }


class RelayPublisher:
    """Publishes telemetry to the FTMS-Rower server via HTTP POST."""
    def __init__(self, server_url: str):
        self.server_url = server_url.rstrip("/")
        # If server_url ends with /ftms-rower, use /ftms-rower/api/telemetry/publish
        if self.server_url.endswith("/ftms-rower"):
            self.endpoint = f"{self.server_url}/api/telemetry/publish"
        else:
            self.endpoint = f"{self.server_url}/api/telemetry/publish"
        logger.info(f"Relay publisher configured for endpoint: {self.endpoint}")

    def publish(self, payload: dict):
        try:
            req_data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                self.endpoint,
                data=req_data,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                pass
        except Exception as e:
            logger.debug(f"Publish failed: {e}")


def extract_device_info(d, adv=None):
    """Safely extracts device name and service UUIDs across all Bleak versions without touching removed attributes."""
    name = (adv.local_name if (adv and getattr(adv, "local_name", None)) else getattr(d, "name", None)) or "Unknown"
    uuids = []
    if adv and hasattr(adv, "service_uuids") and adv.service_uuids:
        uuids = [str(u).lower() for u in adv.service_uuids]
    elif hasattr(d, "metadata") and isinstance(getattr(d, "metadata", None), dict):
        uuids = [str(u).lower() for u in d.metadata.get("uuids", [])]
    return name, uuids


async def run_scanner():
    """Scans and displays available Bluetooth fitness devices."""
    try:
        from bleak import BleakScanner
    except ImportError:
        logger.error("Please install bleak: pip install bleak")
        sys.exit(1)

    logger.info("Scanning for Bluetooth devices (6 seconds)...")
    try:
        devices_dict = await BleakScanner.discover(timeout=6.0, return_adv=True)
        items = list(devices_dict.values())
    except TypeError:
        devices = await BleakScanner.discover(timeout=6.0)
        items = [(d, None) for d in devices]

    found_any = False

    print("\n--- Available Bluetooth Devices ---")
    for d, adv in items:
        name, uuids = extract_device_info(d, adv)
        
        name_lower = name.lower()
        is_ftms = (
            any("1826" in u for u in uuids)
            or any(k in name_lower for k in ["merach", "mr-", "mrk", "q1", "rower", "pm5", "concept2", "waterrower", "iconsole", "ftms"])
        )
        is_hr = any("180d" in u for u in uuids) or any(k in name_lower for k in ["hr", "polar", "garmin", "wahoo", "heart"])

        tag = ""
        if is_ftms:
            tag += " [FTMS Rower]"
            found_any = True
        if is_hr:
            tag += " [Heart Rate]"
            found_any = True

        print(f"  * {name:<28} Address: {d.address} {tag}")

    if not found_any:
        print("  (No devices advertising FTMS or HR service were detected.)")
        print("  Tips:")
        print("   1. Pull the rower handle or tap the console to wake it up.")
        print("   2. Disconnect/close the Merach app on your phone (BLE only connects to 1 device at a time).")
        print("   3. Ensure Bluetooth is turned ON.")
    print("-----------------------------------\n")


async def run_relay(args):
    """Connects to rower via Bleak and streams packets to server with a single-line real-time HUD."""
    try:
        from bleak import BleakClient, BleakScanner
    except ImportError:
        print("[ERROR] Please install bleak: pip install bleak")
        sys.exit(1)

    publisher = RelayPublisher(args.server)
    hud = ConsoleHUD(verbose=args.verbose)

    dev_name = "FTMS Rower"
    last_connected_dt = None
    last_active_time = time.time()
    composite_metrics = {}

    def notification_handler(sender, data: bytearray):
        nonlocal last_connected_dt, last_active_time
        parsed = parse_ftms_rower_data(data)
        if any(k in parsed for k in ("stroke_rate", "watts", "distance", "split_seconds", "resistance", "hr")):
            # Update active timestamp when athlete is pulling/producing power
            if (parsed.get("stroke_rate") or 0) > 0 or (parsed.get("watts") or 0) > 0:
                last_active_time = time.time()

            # Merge incoming fields into composite state so alternating FTMS packets
            # (cadence/power in packet 1, distance/time in packet 2) combine into a single complete display
            for k, v in parsed.items():
                if v is not None and k not in ("timestamp", "source"):
                    composite_metrics[k] = v
            composite_metrics["timestamp"] = parsed.get("timestamp", time.time())
            composite_metrics["source"] = "ble-relay"

            publisher.publish(composite_metrics)
            if args.verbose:
                spm = composite_metrics.get("stroke_rate", "--")
                watts = composite_metrics.get("watts", "--")
                split = composite_metrics.get("split_seconds", "--")
                dist = composite_metrics.get("distance", "--")
                res = composite_metrics.get("resistance")
                res_str = f" | Res: Lvl {res}" if res is not None else ""
                logger.info(f"Live Metric -> SPM: {spm:<3} | Watts: {watts:<4} | 500m Split: {split}s | Dist: {dist}m{res_str}")
            else:
                hud.update(format_telemetry_summary(dev_name, composite_metrics))

    print("\n=======================================================")
    print(" FTMS-Rower Bluetooth Relay Bridge Active")
    print(f" Target Server: {publisher.endpoint}")
    if args.verbose:
        print(" Mode: Verbose Multi-line Scrolling Logs")
    else:
        print(" Mode: Real-time Live Console HUD (single-line updates)")
    if args.idle_timeout > 0:
        idle_m = round(args.idle_timeout / 60, 1)
        m_str = f"{int(idle_m)}" if idle_m.is_integer() else f"{idle_m}"
        print(f" Battery Guard: Auto-disconnects after {m_str}m of idle inactivity")
    print(" Press Ctrl+C to stop.")
    print("=======================================================\n")

    while True:
        target_device = None
        nearby_seen = []
        try:
            if args.address:
                hud.update(f"[Scanning] Searching for device by address: {args.address}...")
                target_device = await BleakScanner.find_device_by_address(args.address, timeout=5.0)
            else:
                hud.update(format_scan_status(last_connected_dt, len(nearby_seen)))
                try:
                    devices_dict = await BleakScanner.discover(timeout=4.0, return_adv=True)
                    items = list(devices_dict.values())
                except TypeError:
                    devices = await BleakScanner.discover(timeout=4.0)
                    items = [(d, None) for d in devices]

                for d, adv in items:
                    name, uuids = extract_device_info(d, adv)
                    display_name = name or "Unknown"
                    nearby_seen.append(display_name)

                    name_lower = name.lower()
                    if args.name and args.name.lower() in name_lower:
                        target_device = d
                        break

                    # Match standard FTMS service UUID or common smart rower advertising names
                    if any("1826" in u for u in uuids) or any(k in name_lower for k in ["merach", "mr-", "mrk", "q1", "rower", "pm5", "concept2", "waterrower", "iconsole", "ftms"]):
                        target_device = d
                        break

            if not target_device:
                hud.update(format_scan_status(last_connected_dt, len(nearby_seen)))
                if args.verbose and nearby_seen:
                    logger.info(f"Nearby BLE devices seen: {nearby_seen[:5]}")
                await asyncio.sleep(2.5)
                continue

            dev_name = target_device.name or "FTMS Rower"
            hud.log(f"-> Discovered {dev_name} ({target_device.address})! Connecting...")

            async with BleakClient(target_device) as client:
                last_connected_dt = datetime.datetime.now()
                last_active_time = time.time()
                composite_metrics.clear()
                t_str = last_connected_dt.strftime("%I:%M:%S %p")
                hud.log(f"[OK] Connected to {dev_name} at {t_str}! Streaming telemetry to {publisher.endpoint}")

                await client.start_notify(ROWER_DATA_CHAR_UUID, notification_handler)

                if not args.verbose:
                    hud.update(f"[Connected: {dev_name}] Waiting for first stroke...")

                idle_disconnected = False
                while client.is_connected:
                    await asyncio.sleep(0.5)
                    if args.idle_timeout > 0:
                        idle_elapsed = time.time() - last_active_time
                        if idle_elapsed >= args.idle_timeout:
                            idle_m = round(args.idle_timeout / 60, 1)
                            m_str = f"{int(idle_m)}" if idle_m.is_integer() else f"{idle_m}"
                            hud.log(f"! Idle timeout ({m_str}m without strokes). Disconnecting to conserve rower battery...")
                            idle_disconnected = True
                            try:
                                await client.disconnect()
                            except Exception:
                                pass
                            break

                disconnect_time = datetime.datetime.now().strftime("%I:%M:%S %p")
                if idle_disconnected:
                    cooldown_sec = getattr(args, "silence_window", 480)
                    cooldown_start = time.time()
                    m_silence = round(cooldown_sec / 60, 1)
                    m_silence_str = f"{int(m_silence)}" if m_silence.is_integer() else f"{m_silence}"

                    hud.log(f"[Idle] Disconnected at {disconnect_time} to save battery.")
                    hud.log(f"       Entering {m_silence_str}m radio silence so rower powers off. Press any key to resume early.")

                    while True:
                        # Check keyboard interrupt on Windows/cmd
                        interrupted = False
                        try:
                            import msvcrt
                            if msvcrt.kbhit():
                                msvcrt.getch()
                                interrupted = True
                        except (ImportError, Exception):
                            pass

                        if interrupted:
                            hud.log("[Input] Manual reconnect requested by user. Resuming scanner...")
                            break

                        elapsed = int(time.time() - cooldown_start)
                        if elapsed >= cooldown_sec:
                            hud.log(f"[OK] {m_silence_str}m radio silence complete. Rower should now be powered off.")
                            hud.log("     Battery conserved! Pull handle or press dial to wake.")
                            break

                        remaining = max(0, cooldown_sec - elapsed)
                        rem_m = remaining // 60
                        rem_s = remaining % 60
                        hud.update(f"[Radio Silence] Muted for {rem_m:02d}:{rem_s:02d} to let rower sleep... (Press any key to resume)")
                        await asyncio.sleep(1.0)
                else:
                    hud.log(f"! Rower disconnected at {disconnect_time} (inactive/asleep). Resuming search...")

        except asyncio.CancelledError:
            break
        except Exception as err:
            if args.verbose:
                logger.warning(f"Connection notice: {err}. Retrying in 4 seconds...")
            else:
                hud.log(f"! Connection notice: {err}. Retrying in 4 seconds...")
            await asyncio.sleep(4.0)


def main():
    parser = argparse.ArgumentParser(description="FTMS-Rower Bluetooth Relay Gateway")
    parser.add_argument("--server", default="http://localhost:8000", help="FTMS-Rower server URL (e.g. http://192.168.1.100:8000)")
    parser.add_argument("--scan", action="store_true", help="Scan and list nearby fitness Bluetooth devices")
    parser.add_argument("--name", help="Device name filter (e.g. Merach, Concept2, PM5)")
    parser.add_argument("--address", help="Exact Bluetooth MAC address / UUID to connect to")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable verbose multi-line scrolling logs instead of single-line HUD")
    parser.add_argument("--idle-timeout", type=int, default=300, help="Inactivity timeout in seconds before disconnecting to save rower battery (default: 300 / 5 min; 0 to disable)")
    parser.add_argument("--silence-window", type=int, default=480, help="Duration in seconds of total radio silence after idle disconnect to allow rower to sleep (default: 480 / 8 min)")

    args = parser.parse_args()

    # Configure logging level based on verbosity
    if not args.verbose:
        logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")
        logging.getLogger("bleak").setLevel(logging.WARNING)
    else:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
        logging.getLogger("bleak").setLevel(logging.INFO)

    if args.scan:
        asyncio.run(run_scanner())
    else:
        hud = ConsoleHUD(verbose=args.verbose)
        try:
            asyncio.run(run_relay(args))
        except KeyboardInterrupt:
            hud.clear()
            print("\nRelay stopped by user.")


if __name__ == "__main__":
    main()
