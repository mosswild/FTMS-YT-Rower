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
import json
import logging
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

    # Bit 7: Resistance Level present
    if (flags & (1 << 7)) and idx + 2 <= len(data):
        idx += 2

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


async def run_scanner():
    """Scans and displays available Bluetooth fitness devices."""
    try:
        from bleak import BleakScanner
    except ImportError:
        logger.error("Please install bleak: pip install bleak")
        sys.exit(1)

    logger.info("Scanning for Bluetooth devices (5 seconds)...")
    devices = await BleakScanner.discover(timeout=5.0)
    found_any = False

    print("\n--- Available Bluetooth Devices ---")
    for d in devices:
        name = d.name or "Unknown"
        uuids = d.metadata.get("uuids", [])
        is_ftms = any("1826" in str(u).lower() for u in uuids) or "rower" in name.lower() or "pm5" in name.lower() or "merach" in name.lower()
        is_hr = any("180d" in str(u).lower() for u in uuids) or "hr" in name.lower() or "polar" in name.lower() or "garmin" in name.lower()

        tag = ""
        if is_ftms:
            tag += " [FTMS Rower]"
            found_any = True
        if is_hr:
            tag += " [Heart Rate]"
            found_any = True

        print(f"  • {name:<25} Address: {d.address} {tag}")

    if not found_any:
        print("  (No devices advertising FTMS or HR service were detected. Ensure your machine console is on.)")
    print("-----------------------------------\n")


async def run_relay(args):
    """Connects to rower via Bleak and streams packets to server."""
    try:
        from bleak import BleakClient, BleakScanner
    except ImportError:
        logger.error("Please install bleak: pip install bleak")
        sys.exit(1)

    publisher = RelayPublisher(args.server)

    target_device = None
    if args.address:
        logger.info(f"Targeting device by address: {args.address}")
        target_device = await BleakScanner.find_device_by_address(args.address, timeout=10.0)
    else:
        logger.info("Scanning for FTMS Rower...")
        devices = await BleakScanner.discover(timeout=6.0)
        for d in devices:
            name = (d.name or "").lower()
            uuids = [str(u).lower() for u in d.metadata.get("uuids", [])]
            if args.name and args.name.lower() in name:
                target_device = d
                break
            if any("1826" in u for u in uuids) or "rower" in name or "merach" in name or "pm5" in name:
                target_device = d
                break

    if not target_device:
        logger.error("No FTMS Rower device found. Check that your rower monitor is awake and within range.")
        return

    logger.info(f"Connecting to {target_device.name or 'Rower'} ({target_device.address})...")

    def notification_handler(sender, data: bytearray):
        parsed = parse_ftms_rower_data(data)
        if parsed.get("stroke_rate") is not None or parsed.get("watts") is not None:
            spm = parsed.get("stroke_rate", "--")
            watts = parsed.get("watts", "--")
            split = parsed.get("split_seconds", "--")
            logger.info(f"Live Metric -> SPM: {spm:<3} | Watts: {watts:<4} | 500m Split: {split}s")
            publisher.publish(parsed)

    while True:
        try:
            async with BleakClient(target_device) as client:
                logger.info("Connected to Rower! Subscribing to FTMS telemetry notifications...")
                await client.start_notify(ROWER_DATA_CHAR_UUID, notification_handler)

                print("\n=======================================================")
                print(f" Relay Active: Streaming metrics from {target_device.name} -> {publisher.endpoint}")
                print(" Open your browser (Safari on iPhone, TV, or laptop) to view the live HUD.")
                print(" Press Ctrl+C to stop.")
                print("=======================================================\n")

                while client.is_connected:
                    await asyncio.sleep(1.0)

        except asyncio.CancelledError:
            break
        except Exception as err:
            logger.warning(f"Connection lost ({err}). Reconnecting in 5 seconds...")
            await asyncio.sleep(5.0)


def main():
    parser = argparse.ArgumentParser(description="FTMS-Rower Bluetooth Relay Gateway")
    parser.add_argument("--server", default="http://localhost:8000", help="FTMS-Rower server URL (e.g. http://192.168.1.100:8000)")
    parser.add_argument("--scan", action="store_true", help="Scan and list nearby fitness Bluetooth devices")
    parser.add_argument("--name", help="Device name filter (e.g. Merach, Concept2, PM5)")
    parser.add_argument("--address", help="Exact Bluetooth MAC address / UUID to connect to")

    args = parser.parse_args()

    if args.scan:
        asyncio.run(run_scanner())
    else:
        try:
            asyncio.run(run_relay(args))
        except KeyboardInterrupt:
            print("\nRelay stopped.")


if __name__ == "__main__":
    main()
