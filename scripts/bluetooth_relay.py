#!/usr/bin/env python3
"""
FTMS-Rower: Standalone Bluetooth Relay Bridge
============================================
Scans for Bluetooth FTMS rowing machines (0x1826 / 0x2AD1) and BLE Heart Rate monitors (0x180D / 0x2A37),
decodes real-time rowing and cardiac metrics, fuses them into composite telemetry, and relays them
to the FTMS-Rower server via WebSocket or HTTP.

Supports concurrent dual-device operation (rower + heart rate strap), live single-line console HUD,
device memory / auto-reconnect, and interactive terminal controls (scan & select, disconnect, device memory).

Requirements:
    pip install bleak

Usage:
    # Auto-connect to rower (and remembered HR monitor if previously paired):
    python scripts/bluetooth_relay.py --server http://localhost:8000

    # Auto-pair rower AND first discovered BLE Heart Rate monitor:
    python scripts/bluetooth_relay.py --server http://localhost:8000 --hr

    # Filter by specific names or addresses:
    python scripts/bluetooth_relay.py --name "Merach" --hr-name "Polar"
    python scripts/bluetooth_relay.py --address "D4:22:CD:00:1A:2B" --hr-address "A1:B2:C3:D4:E5:F6"

    # Interactive hotkeys in terminal:
    #   [r] Scan & select rowing machine from numbered list
    #   [h] Scan & select heart rate monitor from numbered list
    #   [d] Disconnect rower, HR monitor, or both
    #   [c] Clear remembered devices
    #   [m] / [?] Show interactive command menu
    #   [q] Clean quit
"""

import argparse
import asyncio
import datetime
import json
import logging
import os
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request

# FTMS & Heart Rate Bluetooth SIG UUIDs
FTMS_SERVICE_UUID = "00001826-0000-1000-8000-00805f9b34fb"
ROWER_DATA_CHAR_UUID = "00002ad1-0000-1000-8000-00805f9b34fb"
HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT_CHAR_UUID = "00002a37-0000-1000-8000-00805f9b34fb"

# Device memory storage path
CONFIG_FILE_PATH = os.environ.get("FTMS_RELAY_CONFIG", os.path.expanduser("~/.ftms_relay_devices.json"))

logger = logging.getLogger("BLE-Relay")


# ---------------------------------------------------------------------------
# Device Memory (Persistence)
# ---------------------------------------------------------------------------
def load_saved_devices() -> dict:
    """Loads previously connected devices from configuration file."""
    try:
        if os.path.exists(CONFIG_FILE_PATH):
            with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
    except Exception as e:
        logger.debug(f"Failed to read saved devices config: {e}")
    return {}


def save_saved_device(device_type: str, name: str, address: str):
    """Persists last successfully connected device to configuration file."""
    try:
        data = load_saved_devices()
        data[device_type] = {
            "name": name,
            "address": address,
            "last_connected": datetime.datetime.now().isoformat()
        }
        with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        logger.debug(f"Failed to persist device config: {e}")


def clear_saved_devices():
    """Removes saved devices configuration."""
    try:
        if os.path.exists(CONFIG_FILE_PATH):
            os.remove(CONFIG_FILE_PATH)
            return True
    except Exception as e:
        logger.debug(f"Failed to remove device config: {e}")
    return False


# ---------------------------------------------------------------------------
# Console HUD Display
# ---------------------------------------------------------------------------
class ConsoleHUD:
    """Renders a single-line real-time status display without flooding the terminal with scrolling logs."""
    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.paused = False

    def update(self, text: str):
        """Updates the single status line in-place using carriage return and width padding."""
        if self.paused:
            return
        if self.verbose:
            logger.info(text)
            return
        try:
            cols = max(40, shutil.get_terminal_size((80, 24)).columns - 1)
        except Exception:
            cols = 79
        display_text = text[:cols]
        padded = display_text.ljust(cols)
        sys.stdout.write(f"\r{padded}\033[K")
        sys.stdout.flush()

    def log(self, text: str):
        """Prints a persistent event message on a fresh line, clearing the in-place status line first."""
        if not self.verbose:
            sys.stdout.write("\r\033[K")
        print(text)
        sys.stdout.flush()

    def clear(self):
        """Clears the live status line completely."""
        if not self.verbose:
            sys.stdout.write("\r\033[K")
            sys.stdout.flush()


def format_telemetry_summary(
    rower_tag: str,
    hr_tag: str | None,
    metrics: dict,
    interactive: bool = False
) -> str:
    """Formats live rowing and cardiac telemetry into a concise, compact single-line HUD string."""
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

    # 4. Heart Rate (if available)
    hr = metrics.get("hr")
    if hr is not None:
        parts.append(f"{hr}bpm")

    # 5. Total Distance
    dist = metrics.get("distance")
    if dist is not None:
        parts.append(f"{dist:,}m")

    # 6. Elapsed Time
    el = metrics.get("elapsed_seconds")
    if el is not None:
        parts.append(f"{el // 60:02d}:{el % 60:02d}")

    # 7. Resistance (if reported)
    res = metrics.get("resistance")
    if res is not None:
        parts.append(f"Res:{res}")

    body = " | ".join(parts) if parts else "Receiving packets..."
    t_str = datetime.datetime.now().strftime("%I:%M:%S %p")

    # Format device tags
    def sanitize_tag(t: str) -> str:
        if not t:
            return ""
        if len(t) > 12 and "-" in t:
            parts = t.split("-")
            return f"{parts[0][:4]}-{parts[-1]}"
        return t[:12]

    rower_clean = sanitize_tag(rower_tag)
    if hr_tag:
        hr_clean = sanitize_tag(hr_tag)
        tag_str = f"[{rower_clean} | {hr_clean}]"
    else:
        tag_str = f"[{rower_clean}]"

    line = f"[{t_str}] {tag_str} {body}"

    try:
        cols = max(40, shutil.get_terminal_size((80, 24)).columns - 1)
    except Exception:
        cols = 79

    if interactive:
        hints = "(r:rower h:hr d:disc)"
        if len(line) + len(hints) + 1 <= cols:
            line = f"{line} {hints}"

    return line


def format_idle_status(state, interactive: bool = True) -> str:
    """Formats the status line when devices are scanning, standby, or disconnected."""
    rower_is_active = state.rower_enabled and not state.rower_paused
    hr_is_active = state.hr_enabled and not state.hr_paused

    # Case 1: Neither device configured / active
    if not rower_is_active and not hr_is_active:
        return "[Standby] No device configured. Press [r] to select rower | [h] for HR monitor"

    # Case 2: Only HR active
    if not rower_is_active and hr_is_active:
        if state.hr_connected:
            bpm = state.composite_metrics.get("hr", "--")
            return f"[Standby | {state.hr_name} ({bpm}bpm)] Press [r] to select rower | [d] disconnect"
        h_target = state.hr_target_name or state.hr_target_address or "HR monitor"
        return f"[Scanning] Searching for {h_target}... (Turn on strap | r: add rower)"

    # Case 3: Rower is active, HR not active
    if rower_is_active and not hr_is_active:
        if "Muted" in state.rower_status_line:
            return f"[{state.rower_status_line}] (Rower sleeping to save battery | Press 'r' to wake)"
        r_target = state.rower_target_name or state.rower_target_address or "FTMS rower"
        return f"[Scanning] Searching for {r_target}... (Pull handle to wake | r: change | h: add hr)"

    # Case 4: Both are active
    if "Muted" in state.rower_status_line:
        if state.hr_connected:
            bpm = state.composite_metrics.get("hr", "--")
            return f"[{state.rower_status_line} | {state.hr_name} ({bpm}bpm)] Pull handle or press 'r' to wake rower"
        return f"[{state.rower_status_line} | HR Scanning] Press 'r' to wake rower"

    if state.hr_connected:
        bpm = state.composite_metrics.get("hr", "--")
        r_target = state.rower_target_name or state.rower_target_address or "Rower"
        return f"[{r_target} Scanning | {state.hr_name} ({bpm}bpm)] Pull handle to wake rower"

    r_target = state.rower_target_name or state.rower_target_address or "Rower"
    h_target = state.hr_target_name or state.hr_target_address or "HR"
    return f"[Scanning] Searching for {r_target} & {h_target}... (Pull handle to wake | r: rower | h: hr)"


# ---------------------------------------------------------------------------
# Packet Decoders
# ---------------------------------------------------------------------------
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
        parsed["heart_rate"] = data[idx]
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


# ---------------------------------------------------------------------------
# Telemetry Publisher
# ---------------------------------------------------------------------------
class RelayPublisher:
    """Publishes telemetry to the FTMS-Rower server via HTTP POST."""
    def __init__(self, server_url: str):
        self.server_url = server_url.rstrip("/")
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


# ---------------------------------------------------------------------------
# BLE Discovery Coordinator (Prevents Scan Collisions Across Tasks)
# ---------------------------------------------------------------------------
class BLEDiscoveryCoordinator:
    """Thread-safe and asyncio-safe BLE discovery manager with result caching."""
    def __init__(self):
        self.lock = asyncio.Lock()
        self.cached_devices = []
        self.last_scan_time = 0.0

    async def discover(self, timeout: float = 4.0, force_refresh: bool = False):
        """Scans for nearby BLE devices, safely caching results to prevent concurrent scan errors."""
        from bleak import BleakScanner
        async with self.lock:
            now = time.time()
            if not force_refresh and (now - self.last_scan_time) < 3.5 and self.cached_devices:
                return self.cached_devices
            try:
                devices_dict = await BleakScanner.discover(timeout=timeout, return_adv=True)
                items = list(devices_dict.values())
            except TypeError:
                devices = await BleakScanner.discover(timeout=timeout)
                items = [(d, None) for d in devices]
            except Exception as e:
                logger.debug(f"Bleak discovery notice: {e}")
                items = []

            self.cached_devices = items
            self.last_scan_time = time.time()
            return items

    async def find_by_address(self, address: str, timeout: float = 5.0):
        """Finds device by address using the coordinator lock."""
        from bleak import BleakScanner
        async with self.lock:
            return await BleakScanner.find_device_by_address(address, timeout=timeout)


# ---------------------------------------------------------------------------
# Shared Relay State
# ---------------------------------------------------------------------------
class RelayState:
    """Encapsulates shared state between concurrent Rower, Heart Rate, and Terminal UI tasks."""
    def __init__(self, args):
        self.args = args
        self.saved_devices = load_saved_devices()

        # Targets (address or name filter)
        self.rower_target_address = args.address or (self.saved_devices.get("rower", {}).get("address") if not args.forget else None)
        self.rower_target_name = args.name or (self.saved_devices.get("rower", {}).get("name") if not args.forget else None)
        has_rower_target = bool(self.rower_target_address or self.rower_target_name)

        self.rower_enabled = has_rower_target or getattr(args, "auto", False)
        self.rower_enable_event = asyncio.Event()
        if self.rower_enabled:
            self.rower_enable_event.set()

        # Heart rate enabled if CLI flag passed OR saved HR device exists
        hr_cli = bool(args.hr or args.hr_name or args.hr_address)
        saved_hr_exists = bool(self.saved_devices.get("hr", {}).get("address")) and not args.forget
        self.hr_enabled = hr_cli or saved_hr_exists
        self.hr_target_address = args.hr_address or (self.saved_devices.get("hr", {}).get("address") if saved_hr_exists else None)
        self.hr_target_name = args.hr_name or (self.saved_devices.get("hr", {}).get("name") if saved_hr_exists else None)

        # Active status
        self.rower_connected = False
        self.rower_name = "FTMS Rower"
        self.rower_status_line = "Scanning Rower" if self.rower_enabled else "Standby"
        self.active_rower_client = None
        self.rower_paused = False
        self.rower_reconnect_event = asyncio.Event()

        self.hr_connected = False
        self.hr_name = "HR Monitor"
        self.hr_status_line = "HR Scanning" if self.hr_enabled else "HR Disabled"
        self.active_hr_client = None
        self.hr_paused = False
        self.hr_enable_event = asyncio.Event()
        if self.hr_enabled:
            self.hr_enable_event.set()
        self.hr_reconnect_event = asyncio.Event()

        # Telemetry
        self.composite_metrics = {}
        self.last_active_time = time.time()
        self.last_connected_dt = None

        # Interactive state
        self.interactive_mode = False
        self.keyboard_pause_event = threading.Event()
        self.stop_event = asyncio.Event()

    def stop(self):
        """Signals all tasks and events to stop immediately."""
        self.stop_event.set()
        self.rower_enable_event.set()
        self.hr_enable_event.set()
        self.rower_reconnect_event.set()
        self.hr_reconnect_event.set()

    async def disconnect_rower(self):
        """Disconnects the currently connected rower."""
        client = self.active_rower_client
        if client:
            try:
                await asyncio.wait_for(client.disconnect(), timeout=1.5)
            except Exception:
                pass

    async def disconnect_hr(self):
        """Disconnects the currently connected HR monitor."""
        client = self.active_hr_client
        if client:
            try:
                await asyncio.wait_for(client.disconnect(), timeout=1.5)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Concurrent Task: Rower BLE Loop
# ---------------------------------------------------------------------------
async def rower_loop(
    state: RelayState,
    coordinator: BLEDiscoveryCoordinator,
    publisher: RelayPublisher,
    hud: ConsoleHUD,
    args
):
    from bleak import BleakClient

    def rower_notification_handler(sender, data: bytearray):
        parsed = parse_ftms_rower_data(data)
        if any(k in parsed for k in ("stroke_rate", "watts", "distance", "split_seconds", "resistance", "hr")):
            if (parsed.get("stroke_rate") or 0) > 0 or (parsed.get("watts") or 0) > 0:
                state.last_active_time = time.time()

            for k, v in parsed.items():
                if v is not None and k not in ("timestamp", "source"):
                    state.composite_metrics[k] = v
            state.composite_metrics["timestamp"] = parsed.get("timestamp", time.time())
            state.composite_metrics["source"] = "ble-relay"
            state.composite_metrics["device_name"] = state.rower_name
            state.composite_metrics["device_type"] = "rower"
            if state.hr_connected and "hr" in state.composite_metrics:
                state.composite_metrics["hr_device_name"] = state.hr_name

            publisher.publish(state.composite_metrics)

            if not state.interactive_mode:
                hr_tag = state.hr_name if state.hr_connected else (state.hr_status_line if state.hr_enabled else None)
                hud.update(format_telemetry_summary(
                    state.rower_name,
                    hr_tag,
                    state.composite_metrics,
                    interactive=not args.no_interactive and sys.stdin.isatty()
                ))

    while not state.stop_event.is_set():
        if not state.rower_enabled:
            state.rower_status_line = "Standby"
            if not state.interactive_mode and not state.hr_connected and not args.verbose:
                hud.update(format_idle_status(state, not args.no_interactive and sys.stdin.isatty()))
            await state.rower_enable_event.wait()
            state.rower_enable_event.clear()
            if state.stop_event.is_set():
                break

        if state.rower_paused:
            state.rower_status_line = "Rower Disconnected"
            if not state.interactive_mode and not state.hr_connected and not args.verbose:
                hud.update(format_idle_status(state, not args.no_interactive and sys.stdin.isatty()))
            await asyncio.sleep(1.0)
            continue

        target_device = None
        state.rower_status_line = "Scanning Rower"

        try:
            if not state.interactive_mode and not state.hr_connected and not args.verbose:
                hud.update(format_idle_status(state, not args.no_interactive and sys.stdin.isatty()))

            if state.rower_target_address:
                target_device = await coordinator.find_by_address(state.rower_target_address, timeout=4.0)
            else:
                items = await coordinator.discover(timeout=4.0)
                for d, adv in items:
                    name, uuids = extract_device_info(d, adv)
                    name_lower = name.lower()

                    if state.rower_target_name and state.rower_target_name.lower() in name_lower:
                        target_device = d
                        break

                    if any("1826" in u for u in uuids) or any(k in name_lower for k in [
                        "merach", "mr-", "mrk", "q1", "rower", "pm5", "concept2", "waterrower", "iconsole", "ftms"
                    ]):
                        target_device = d
                        break

            if not target_device:
                if not state.interactive_mode and not state.hr_connected and not args.verbose:
                    hud.update(format_idle_status(state, not args.no_interactive and sys.stdin.isatty()))
                await asyncio.sleep(2.0)
                continue

            state.rower_name = target_device.name or "FTMS Rower"
            save_saved_device("rower", state.rower_name, target_device.address)

            hud.log(f"-> Discovered {state.rower_name} ({target_device.address})! Connecting...")

            async with BleakClient(target_device) as client:
                state.active_rower_client = client
                state.rower_connected = True
                state.last_connected_dt = datetime.datetime.now()
                state.last_active_time = time.time()
                t_str = state.last_connected_dt.strftime("%I:%M:%S %p")
                hud.log(f"[OK] Connected to Rower {state.rower_name} at {t_str}! Streaming telemetry...")

                publisher.publish({
                    "event": "connected",
                    "device_name": state.rower_name,
                    "device_type": "rower",
                    "source": "ble-relay",
                    "timestamp": time.time()
                })

                await client.start_notify(ROWER_DATA_CHAR_UUID, rower_notification_handler)

                idle_disconnected = False
                while client.is_connected and not state.rower_paused and not state.stop_event.is_set():
                    await asyncio.sleep(0.5)

                    # Check idle timeout
                    if args.idle_timeout > 0:
                        idle_elapsed = time.time() - state.last_active_time
                        if idle_elapsed >= args.idle_timeout:
                            idle_m = round(args.idle_timeout / 60, 1)
                            m_str = f"{int(idle_m)}" if idle_m.is_integer() else f"{idle_m}"
                            hud.log(f"! Idle timeout ({m_str}m without strokes). Disconnecting rower to conserve battery...")
                            idle_disconnected = True
                            try:
                                await client.disconnect()
                            except Exception:
                                pass
                            break

                state.rower_connected = False
                state.active_rower_client = None
                disconnect_time = datetime.datetime.now().strftime("%I:%M:%S %p")

                publisher.publish({
                    "event": "disconnected",
                    "device_name": state.rower_name,
                    "device_type": "rower",
                    "source": "ble-relay",
                    "timestamp": time.time()
                })

                if idle_disconnected:
                    cooldown_sec = getattr(args, "silence_window", 480)
                    cooldown_start = time.time()
                    m_silence = round(cooldown_sec / 60, 1)
                    m_silence_str = f"{int(m_silence)}" if m_silence.is_integer() else f"{m_silence}"

                    hud.log(f"[Idle] Rower disconnected at {disconnect_time} to save battery.")
                    hud.log(f"       Entering {m_silence_str}m radio silence so rower powers off. Press [r] to resume early.")

                    while True:
                        if state.rower_paused or state.stop_event.is_set():
                            break

                        elapsed = int(time.time() - cooldown_start)
                        if elapsed >= cooldown_sec:
                            hud.log(f"[OK] {m_silence_str}m radio silence complete. Rower should now be powered off.")
                            hud.log("     Battery conserved! Pull handle or press dial to wake.")
                            break

                        remaining = max(0, cooldown_sec - elapsed)
                        rem_m = remaining // 60
                        rem_s = remaining % 60
                        state.rower_status_line = f"Rower Muted {rem_m:02d}:{rem_s:02d}"

                        if not state.interactive_mode and not state.hr_connected:
                            hud.update(f"[Radio Silence] Muted for {rem_m:02d}:{rem_s:02d} to let rower sleep... (Press 'r' to resume)")
                        await asyncio.sleep(1.0)
                else:
                    hud.log(f"! Rower disconnected at {disconnect_time}. Resuming search...")

        except asyncio.CancelledError:
            break
        except Exception as err:
            state.rower_connected = False
            state.active_rower_client = None
            if args.verbose:
                logger.warning(f"Rower connection notice: {err}. Retrying in 4 seconds...")
            await asyncio.sleep(3.5)


# ---------------------------------------------------------------------------
# Concurrent Task: Heart Rate BLE Loop
# ---------------------------------------------------------------------------
async def hr_loop(
    state: RelayState,
    coordinator: BLEDiscoveryCoordinator,
    publisher: RelayPublisher,
    hud: ConsoleHUD,
    args
):
    from bleak import BleakClient

    def hr_notification_handler(sender, data: bytearray):
        parsed = parse_hr_measurement(data)
        if "hr" in parsed:
            bpm = parsed["hr"]
            state.composite_metrics["hr"] = bpm
            state.composite_metrics["heart_rate"] = bpm
            state.composite_metrics["hr_device_name"] = state.hr_name
            state.composite_metrics["source"] = "ble-relay"
            state.composite_metrics["timestamp"] = time.time()

            publisher.publish({
                "heartRate": bpm,
                "hr": bpm,
                "hr_device_name": state.hr_name,
                "device_type": "hr",
                "source": "ble-relay",
                "timestamp": time.time()
            })

            if not state.interactive_mode:
                hud.update(format_telemetry_summary(
                    state.rower_name if state.rower_connected else state.rower_status_line,
                    state.hr_name,
                    state.composite_metrics,
                    interactive=not args.no_interactive and sys.stdin.isatty()
                ))

    while not state.stop_event.is_set():
        if not state.hr_enabled:
            await state.hr_enable_event.wait()
            state.hr_enable_event.clear()
            if state.stop_event.is_set():
                break

        if state.hr_paused:
            state.hr_status_line = "HR Disconnected"
            await asyncio.sleep(1.0)
            continue

        target_device = None
        state.hr_status_line = "HR Scanning"

        try:
            if state.hr_target_address:
                target_device = await coordinator.find_by_address(state.hr_target_address, timeout=4.0)
            else:
                items = await coordinator.discover(timeout=4.0)
                for d, adv in items:
                    name, uuids = extract_device_info(d, adv)
                    name_lower = name.lower()

                    if state.hr_target_name and state.hr_target_name.lower() in name_lower:
                        target_device = d
                        break

                    # Match 0x180D or common HR monitor brand names
                    if any("180d" in u for u in uuids) or any(k in name_lower for k in [
                        "hr", "polar", "garmin", "wahoo", "heart", "tickr", "coospo", "hrm", "scosche"
                    ]):
                        target_device = d
                        break

            if not target_device:
                await asyncio.sleep(2.5)
                continue

            state.hr_name = target_device.name or "HR Monitor"
            save_saved_device("hr", state.hr_name, target_device.address)

            hud.log(f"-> Discovered HR Monitor {state.hr_name} ({target_device.address})! Connecting...")

            async with BleakClient(target_device) as client:
                state.active_hr_client = client
                state.hr_connected = True
                hud.log(f"[OK] Connected to HR Monitor {state.hr_name}! Streaming heart rate...")

                publisher.publish({
                    "event": "hr_connected",
                    "device_name": state.hr_name,
                    "device_type": "hr",
                    "source": "ble-relay",
                    "timestamp": time.time()
                })

                await client.start_notify(HR_MEASUREMENT_CHAR_UUID, hr_notification_handler)

                while client.is_connected and not state.hr_paused and not state.stop_event.is_set():
                    await asyncio.sleep(0.5)

                state.hr_connected = False
                state.active_hr_client = None
                hud.log(f"! HR monitor {state.hr_name} disconnected. Re-scanning...")

                publisher.publish({
                    "event": "hr_disconnected",
                    "device_name": state.hr_name,
                    "device_type": "hr",
                    "source": "ble-relay",
                    "timestamp": time.time()
                })

        except asyncio.CancelledError:
            break
        except Exception as err:
            state.hr_connected = False
            state.active_hr_client = None
            if args.verbose:
                logger.warning(f"HR monitor connection notice: {err}. Retrying in 4 seconds...")
            await asyncio.sleep(3.5)


# ---------------------------------------------------------------------------
# Interactive Terminal Controls (Cross-Platform)
# ---------------------------------------------------------------------------
async def handle_interactive_scan_rower(state: RelayState, coordinator: BLEDiscoveryCoordinator, hud: ConsoleHUD):
    """Interactively scans for rowers, presents a numbered menu, and allows picking or rescanning."""
    show_all = False
    saved = load_saved_devices().get("rower", {})
    loop = asyncio.get_running_loop()

    while not state.stop_event.is_set():
        hud.clear()
        scan_label = "All Bluetooth Devices" if show_all else "Rowing Machines (FTMS)"
        print("\n-------------------------------------------------------")
        print(f" Scanning for {scan_label} (6s)...")
        print("-------------------------------------------------------")

        items = await coordinator.discover(timeout=6.0, force_refresh=True)
        candidates = []

        for d, adv in items:
            name, uuids = extract_device_info(d, adv)
            name_lower = name.lower()
            is_ftms = any("1826" in u for u in uuids) or any(k in name_lower for k in [
                "merach", "mr-", "mrk", "q1", "rower", "pm5", "concept2", "waterrower", "iconsole", "ftms", "hydrow", "erg"
            ])
            if show_all:
                if name and name != "Unknown":
                    candidates.append((d, name, uuids, is_ftms))
            else:
                if is_ftms:
                    candidates.append((d, name, uuids, True))

        if not candidates:
            if not show_all:
                print(" [!] No rowing machines detected advertising FTMS service (0x1826).")
                print(" Tips:")
                print("   1. Pull the rower handle or tap the monitor to wake it up.")
                print("   2. Disconnect/close any phone apps paired to the rower.")
                print("\n  [r] Rescan nearby devices")
                print("  [a] Show all nearby Bluetooth devices anyway")
                print("  [c] Cancel")
                prompt_str = "\nChoice [r, a, c]: "
            else:
                print(" [!] No Bluetooth devices with names were found nearby.")
                print("\n  [r] Rescan nearby devices")
                print("  [a] Switch back to FTMS rower filter")
                print("  [c] Cancel")
                prompt_str = "\nChoice [r, a, c]: "

            try:
                choice = await loop.run_in_executor(None, input, prompt_str)
                choice = choice.strip().lower()
            except (EOFError, KeyboardInterrupt):
                return

            if choice in ("r", "s"):
                continue
            elif choice == "a":
                show_all = not show_all
                continue
            else:
                print("Cancelled.")
                return

        # Candidates found
        title = "All Discovered Bluetooth Devices" if show_all else "Discovered Rowing Machines"
        print(f"\n{title}:")
        for idx, (dev, name, uuids, is_ftms) in enumerate(candidates, 1):
            prev = " [Previously Paired]" if saved.get("address") == dev.address else ""
            ftms_tag = " [FTMS]" if is_ftms and show_all else ""
            print(f"  [{idx}] {name:<26} ({dev.address}){ftms_tag}{prev}")

        toggle_label = "Filter FTMS rowers only" if show_all else "Show all nearby Bluetooth devices"
        print("  [r] Rescan nearby devices")
        print(f"  [a] {toggle_label}")
        print("  [c] Cancel")

        try:
            choice = await loop.run_in_executor(None, input, f"\nSelect rower [1-{len(candidates)}, r, a, c]: ")
            choice = choice.strip().lower()
        except (EOFError, KeyboardInterrupt):
            return

        if choice in ("r", "s"):
            continue
        elif choice == "a":
            show_all = not show_all
            continue
        elif choice == "c" or not choice:
            print("Cancelled.")
            return

        selected_dev = None
        if choice.isdigit() and 1 <= int(choice) <= len(candidates):
            idx = int(choice) - 1
            selected_dev = candidates[idx][0]
            selected_name = candidates[idx][1]
        else:
            print("Invalid selection.")
            continue

        print(f"[OK] Selected Rower: {selected_name} ({selected_dev.address})")
        state.rower_target_address = selected_dev.address
        state.rower_target_name = selected_name
        state.rower_enabled = True
        state.rower_paused = False
        state.rower_enable_event.set()
        save_saved_device("rower", selected_name, selected_dev.address)

        await state.disconnect_rower()
        state.rower_reconnect_event.set()
        break


async def handle_interactive_scan_hr(state: RelayState, coordinator: BLEDiscoveryCoordinator, hud: ConsoleHUD):
    """Interactively scans for HR monitors, presents a numbered menu, and enables HR pairing."""
    show_all = False
    saved = load_saved_devices().get("hr", {})
    loop = asyncio.get_running_loop()

    while not state.stop_event.is_set():
        hud.clear()
        scan_label = "All Bluetooth Devices" if show_all else "Heart Rate Monitors (0x180D)"
        print("\n-------------------------------------------------------")
        print(f" Scanning for {scan_label} (6s)...")
        print("-------------------------------------------------------")

        items = await coordinator.discover(timeout=6.0, force_refresh=True)
        candidates = []

        for d, adv in items:
            name, uuids = extract_device_info(d, adv)
            name_lower = name.lower()
            is_hr = any("180d" in u for u in uuids) or any(k in name_lower for k in [
                "hr", "polar", "garmin", "wahoo", "heart", "tickr", "coospo", "hrm", "scosche"
            ])
            if show_all:
                if name and name != "Unknown":
                    candidates.append((d, name, uuids, is_hr))
            else:
                if is_hr:
                    candidates.append((d, name, uuids, True))

        if not candidates:
            if not show_all:
                print(" [!] No BLE heart rate monitors detected advertising HR service (0x180D).")
                print(" Tips: Ensure the strap/armband is turned on and moist/worn.")
                print("\n  [r] Rescan nearby devices")
                print("  [a] Show all nearby Bluetooth devices anyway")
                print("  [c] Cancel")
                prompt_str = "\nChoice [r, a, c]: "
            else:
                print(" [!] No Bluetooth devices with names were found nearby.")
                print("\n  [r] Rescan nearby devices")
                print("  [a] Switch back to Heart Rate filter")
                print("  [c] Cancel")
                prompt_str = "\nChoice [r, a, c]: "

            try:
                choice = await loop.run_in_executor(None, input, prompt_str)
                choice = choice.strip().lower()
            except (EOFError, KeyboardInterrupt):
                return

            if choice in ("r", "s"):
                continue
            elif choice == "a":
                show_all = not show_all
                continue
            else:
                print("Cancelled.")
                return

        # Candidates found
        title = "All Discovered Bluetooth Devices" if show_all else "Discovered Heart Rate Monitors"
        print(f"\n{title}:")
        for idx, (dev, name, uuids, is_hr) in enumerate(candidates, 1):
            prev = " [Previously Paired]" if saved.get("address") == dev.address else ""
            hr_tag = " [HR Monitor]" if is_hr and show_all else ""
            print(f"  [{idx}] {name:<26} ({dev.address}){hr_tag}{prev}")

        toggle_label = "Filter Heart Rate monitors only" if show_all else "Show all nearby Bluetooth devices"
        print("  [r] Rescan nearby devices")
        print(f"  [a] {toggle_label}")
        print("  [c] Cancel")

        try:
            choice = await loop.run_in_executor(None, input, f"\nSelect HR monitor [1-{len(candidates)}, r, a, c]: ")
            choice = choice.strip().lower()
        except (EOFError, KeyboardInterrupt):
            return

        if choice in ("r", "s"):
            continue
        elif choice == "a":
            show_all = not show_all
            continue
        elif choice == "c" or not choice:
            print("Cancelled.")
            return

        selected_dev = None
        if choice.isdigit() and 1 <= int(choice) <= len(candidates):
            idx = int(choice) - 1
            selected_dev = candidates[idx][0]
            selected_name = candidates[idx][1]
        else:
            print("Invalid selection.")
            continue

        print(f"[OK] Selected HR Monitor: {selected_name} ({selected_dev.address})")
        state.hr_target_address = selected_dev.address
        state.hr_target_name = selected_name
        state.hr_enabled = True
        state.hr_paused = False
        state.hr_enable_event.set()
        save_saved_device("hr", selected_name, selected_dev.address)

        await state.disconnect_hr()
        state.hr_reconnect_event.set()
        break


async def handle_interactive_disconnect(state: RelayState, publisher: RelayPublisher, hud: ConsoleHUD):
    """Presents menu to disconnect Rower, HR Monitor, or Both."""
    hud.clear()
    print("\n-------------------------------------------------------")
    print(" Disconnect Devices")
    print("-------------------------------------------------------")
    r_stat = state.rower_name if state.rower_connected else "Disconnected"
    h_stat = state.hr_name if state.hr_connected else "Disconnected"
    print(f"  [1] Disconnect Rower (Currently: {r_stat})")
    print(f"  [2] Disconnect Heart Rate Monitor (Currently: {h_stat})")
    print("  [3] Disconnect Both")
    print("  [c] Cancel")

    loop = asyncio.get_running_loop()
    try:
        choice = await loop.run_in_executor(None, input, "\nChoice [1-3, c]: ")
        choice = choice.strip().lower()
    except (EOFError, KeyboardInterrupt):
        return

    if choice == "1":
        state.rower_paused = True
        await state.disconnect_rower()
        publisher.publish({"event": "disconnected", "device_name": state.rower_name, "device_type": "rower", "source": "ble-relay", "timestamp": time.time()})
        print(f"[OK] Disconnected rower {state.rower_name}.")
    elif choice == "2":
        state.hr_paused = True
        await state.disconnect_hr()
        publisher.publish({"event": "hr_disconnected", "device_name": state.hr_name, "device_type": "hr", "source": "ble-relay", "timestamp": time.time()})
        print(f"[OK] Disconnected HR monitor {state.hr_name}.")
    elif choice == "3":
        state.rower_paused = True
        state.hr_paused = True
        await state.disconnect_rower()
        await state.disconnect_hr()
        publisher.publish({"event": "disconnected", "device_name": state.rower_name, "device_type": "rower", "source": "ble-relay", "timestamp": time.time()})
        publisher.publish({"event": "hr_disconnected", "device_name": state.hr_name, "device_type": "hr", "source": "ble-relay", "timestamp": time.time()})
        print("[OK] Disconnected both devices.")
    else:
        print("Cancelled.")


def print_interactive_help():
    print("\n-------------------------------------------------------")
    print(" FTMS-Rower Bluetooth Relay Bridge - Hotkey Commands")
    print("-------------------------------------------------------")
    print("  [r]  Scan & select rowing machine from list")
    print("  [h]  Scan & select heart rate monitor from list")
    print("  [d]  Disconnect device (Rower / HR Monitor / Both)")
    print("  [c]  Clear remembered devices from disk")
    print("  [m]  Show this command menu")
    print("  [q]  Quit relay bridge cleanly")
    print("-------------------------------------------------------\n")


class TerminalHotkeys:
    """Manages terminal modes (cbreak/no-echo for hotkeys vs cooked/echo for input prompts)."""
    def __init__(self):
        self.is_tty = sys.stdin.isatty() and sys.platform != "win32"
        self.original_settings = None
        if self.is_tty:
            try:
                import termios
                self.original_settings = termios.tcgetattr(sys.stdin.fileno())
            except Exception:
                self.is_tty = False

    def enable_hotkeys(self):
        """Sets terminal to non-canonical, no-echo mode for single-keystroke reading."""
        if not self.is_tty or not self.original_settings:
            return
        try:
            import termios
            fd = sys.stdin.fileno()
            new_settings = termios.tcgetattr(fd)
            # Disable ICANON (line buffering) and ECHO (terminal character echo)
            # Keep ISIG enabled so Ctrl+C (SIGINT) works normally
            new_settings[3] &= ~(termios.ICANON | termios.ECHO)
            new_settings[6][termios.VMIN] = 1
            new_settings[6][termios.VTIME] = 0
            termios.tcsetattr(fd, termios.TCSANOW, new_settings)
        except Exception:
            pass

    def restore_cooked(self):
        """Restores standard cooked mode for normal line-buffered input() with echo."""
        if not self.is_tty or not self.original_settings:
            return
        try:
            import termios
            fd = sys.stdin.fileno()
            termios.tcflush(fd, termios.TCIFLUSH)
            termios.tcsetattr(fd, termios.TCSANOW, self.original_settings)
        except Exception:
            pass

    def flush_input(self):
        """Discards any unread typed characters sitting in the input buffer."""
        if not self.is_tty:
            return
        try:
            import termios
            fd = sys.stdin.fileno()
            termios.tcflush(fd, termios.TCIFLUSH)
        except Exception:
            pass


async def interactive_terminal_task(
    state: RelayState,
    coordinator: BLEDiscoveryCoordinator,
    publisher: RelayPublisher,
    hud: ConsoleHUD,
    cmd_queue: asyncio.Queue,
    terminal_mgr: TerminalHotkeys = None
):
    """Processes interactive commands dispatched from the background keyboard listener."""
    while not state.stop_event.is_set():
        cmd = await cmd_queue.get()
        state.interactive_mode = True
        state.keyboard_pause_event.set()
        hud.paused = True
        hud.clear()
        if terminal_mgr:
            terminal_mgr.restore_cooked()
        await asyncio.sleep(0.05)

        try:
            if cmd == "r":
                await handle_interactive_scan_rower(state, coordinator, hud)
            elif cmd == "h":
                await handle_interactive_scan_hr(state, coordinator, hud)
            elif cmd == "d":
                await handle_interactive_disconnect(state, publisher, hud)
            elif cmd == "c":
                clear_saved_devices()
                state.rower_target_address = None
                state.rower_target_name = None
                state.rower_enabled = False
                state.hr_target_address = None
                state.hr_target_name = None
                state.hr_enabled = False
                hud.log("[OK] Cleared remembered devices configuration.")
            elif cmd in ("m", "?"):
                print_interactive_help()
            elif cmd == "q":
                hud.log("\n[Quit] Exiting relay bridge...")
                await state.disconnect_rower()
                await state.disconnect_hr()
                state.stop()
                break
        except Exception as e:
            logger.debug(f"Interactive command exception: {e}")
        finally:
            if terminal_mgr:
                terminal_mgr.flush_input()
                terminal_mgr.enable_hotkeys()
            state.interactive_mode = False
            state.keyboard_pause_event.clear()
            hud.paused = False
            if not state.rower_connected and not state.hr_connected:
                hud.update(format_idle_status(state, sys.stdin.isatty()))


def start_keyboard_thread(loop: asyncio.AbstractEventLoop, cmd_queue: asyncio.Queue, state: RelayState, terminal_mgr: TerminalHotkeys = None):
    """Starts cross-platform background thread listening for single keystrokes without blocking."""
    if terminal_mgr:
        terminal_mgr.enable_hotkeys()

    def listener():
        is_windows = sys.platform == "win32"
        while not state.stop_event.is_set():
            if state.keyboard_pause_event.is_set():
                time.sleep(0.05)
                continue
            try:
                ch = None
                if is_windows:
                    import msvcrt
                    if msvcrt.kbhit():
                        ch = msvcrt.getwch()
                    else:
                        time.sleep(0.05)
                        continue
                else:
                    import select

                    dr, _, _ = select.select([sys.stdin], [], [], 0.15)
                    if dr:
                        if state.keyboard_pause_event.is_set():
                            time.sleep(0.05)
                            continue
                        ch = sys.stdin.read(1)
                        if not ch:
                            time.sleep(0.2)
                            continue
                    else:
                        continue

                if ch and not state.keyboard_pause_event.is_set():
                    c = ch.lower()
                    if c in ("r", "h", "d", "c", "m", "?", "q"):
                        loop.call_soon_threadsafe(cmd_queue.put_nowait, c)
            except Exception:
                time.sleep(0.2)

    th = threading.Thread(target=listener, daemon=True)
    th.start()
    return th


# ---------------------------------------------------------------------------
# Standalone Scanner Mode (--scan)
# ---------------------------------------------------------------------------
async def run_scanner():
    """Scans and displays available Bluetooth fitness devices (both rowers and HR straps)."""
    try:
        from bleak import BleakScanner
    except ImportError:
        logger.error("Please install bleak: pip install bleak")
        sys.exit(1)

    print("\nScanning for Bluetooth fitness devices (6 seconds)...")
    try:
        devices_dict = await BleakScanner.discover(timeout=6.0, return_adv=True)
        items = list(devices_dict.values())
    except TypeError:
        devices = await BleakScanner.discover(timeout=6.0)
        items = [(d, None) for d in devices]

    saved = load_saved_devices()
    found_any = False

    print("\n--- Available Bluetooth Fitness Devices ---")
    for d, adv in items:
        name, uuids = extract_device_info(d, adv)
        name_lower = name.lower()

        is_ftms = (
            any("1826" in u for u in uuids)
            or any(k in name_lower for k in ["merach", "mr-", "mrk", "q1", "rower", "pm5", "concept2", "waterrower", "iconsole", "ftms"])
        )
        is_hr = (
            any("180d" in u for u in uuids)
            or any(k in name_lower for k in ["hr", "polar", "garmin", "wahoo", "heart", "tickr", "coospo", "hrm", "scosche"])
        )

        tags = []
        if is_ftms:
            tags.append("FTMS Rower")
            found_any = True
        if is_hr:
            tags.append("Heart Rate")
            found_any = True

        tag_str = f" [{' | '.join(tags)}]" if tags else ""
        prev = ""
        if saved.get("rower", {}).get("address") == d.address:
            prev = " [Saved Rower]"
        elif saved.get("hr", {}).get("address") == d.address:
            prev = " [Saved HR Monitor]"

        print(f"  * {name:<26} Address: {d.address}{tag_str}{prev}")

    if not found_any:
        print("  (No devices advertising FTMS or HR service were detected.)")
        print("  Tips:")
        print("   1. Pull the rower handle or tap the console to wake it up.")
        print("   2. Turn on your heart rate strap or armband.")
        print("   3. Ensure Bluetooth is enabled on this computer.")
    else:
        print("\nQuick Launch Examples:")
        print("  Auto-connect rower:                  python scripts/bluetooth_relay.py")
        print("  Auto-connect rower + HR monitor:     python scripts/bluetooth_relay.py --hr")
        print("  Filter by device name:               python scripts/bluetooth_relay.py --name 'Merach' --hr-name 'Polar'")
    print("-------------------------------------------\n")


# ---------------------------------------------------------------------------
# Main Relay Execution
# ---------------------------------------------------------------------------
async def run_relay(args):
    """Manages concurrent Rower, Heart Rate, and interactive terminal loops."""
    try:
        import bleak
    except ImportError:
        print("[ERROR] Please install bleak: pip install bleak")
        sys.exit(1)

    publisher = RelayPublisher(args.server)
    hud = ConsoleHUD(verbose=args.verbose)
    coordinator = BLEDiscoveryCoordinator()
    state = RelayState(args)

    print("\n=======================================================")
    print(" FTMS-Rower: Dual-Device Bluetooth Relay Bridge")
    print(f" Target Server: {publisher.endpoint}")
    if state.rower_target_address or state.rower_target_name:
        r_target = state.rower_target_name or state.rower_target_address
        print(f" Preferred Rower: {r_target}")
    else:
        print(" Rowing Machine: Press [r] in terminal to scan & connect")
    if state.hr_enabled:
        h_target = state.hr_target_name or state.hr_target_address or "Auto-First"
        print(f" Heart Rate Monitor: Enabled ({h_target})")
    else:
        print(" Heart Rate Monitor: Press [h] in terminal to scan & connect")

    if args.verbose:
        print(" Mode: Verbose Multi-line Scrolling Logs")
    else:
        print(" Mode: Real-time Live Console HUD (single-line updates)")

    is_interactive = not args.no_interactive and sys.stdin.isatty()
    if is_interactive:
        print(" Interactive Controls: [r] Rower | [h] HR Monitor | [d] Disconnect | [?] Help")
    if args.idle_timeout > 0:
        idle_m = round(args.idle_timeout / 60, 1)
        m_str = f"{int(idle_m)}" if idle_m.is_integer() else f"{idle_m}"
        print(f" Battery Guard: Auto-disconnects rower after {m_str}m idle")
    print(" Press Ctrl+C or [q] to stop.")
    print("=======================================================")

    if not args.verbose:
        hud.update(format_idle_status(state, is_interactive))

    loop = asyncio.get_running_loop()
    cmd_queue = asyncio.Queue()

    tasks = [
        asyncio.create_task(rower_loop(state, coordinator, publisher, hud, args)),
        asyncio.create_task(hr_loop(state, coordinator, publisher, hud, args))
    ]

    async def stop_watcher():
        await state.stop_event.wait()
        for t in tasks:
            if not t.done():
                t.cancel()

    tasks.append(asyncio.create_task(stop_watcher()))

    terminal_mgr = TerminalHotkeys()
    if is_interactive:
        import atexit
        atexit.register(terminal_mgr.restore_cooked)
        start_keyboard_thread(loop, cmd_queue, state, terminal_mgr)
        tasks.append(asyncio.create_task(interactive_terminal_task(state, coordinator, publisher, hud, cmd_queue, terminal_mgr)))

    try:
        await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        state.stop()
        terminal_mgr.restore_cooked()
        hud.clear()


def main():
    parser = argparse.ArgumentParser(description="FTMS-Rower Dual-Device Bluetooth Relay Gateway")
    parser.add_argument("--server", default="http://localhost:8000", help="FTMS-Rower server URL (e.g. http://192.168.1.100:8000)")
    parser.add_argument("--scan", action="store_true", help="Scan and list nearby fitness Bluetooth devices (rowers & HR monitors)")
    parser.add_argument("--name", help="Rower device name filter (e.g. Merach, Concept2, PM5)")
    parser.add_argument("--address", help="Exact Bluetooth MAC address / UUID of the rower")
    parser.add_argument("--auto", action="store_true", help="Auto-connect first discovered FTMS rower without requiring saved configuration or manual selection")
    parser.add_argument("--hr", action="store_true", help="Auto-pair first discovered BLE Heart Rate monitor (0x180D)")
    parser.add_argument("--hr-name", help="Heart Rate monitor device name filter (e.g. Polar, Garmin, Wahoo, TICKR)")
    parser.add_argument("--hr-address", help="Exact Bluetooth MAC address / UUID of the HR monitor")
    parser.add_argument("--forget", action="store_true", help="Clear remembered devices from previous sessions")
    parser.add_argument("--no-interactive", action="store_true", help="Disable interactive terminal hotkeys (for headless/docker/daemon execution)")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable verbose multi-line scrolling logs instead of single-line HUD")
    parser.add_argument("--idle-timeout", type=int, default=300, help="Inactivity timeout in seconds before disconnecting rower (default: 300 / 5 min; 0 to disable)")
    parser.add_argument("--silence-window", type=int, default=480, help="Duration in seconds of radio silence allowing rower to power off (default: 480 / 8 min)")

    args = parser.parse_args()

    if args.forget:
        clear_saved_devices()

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
