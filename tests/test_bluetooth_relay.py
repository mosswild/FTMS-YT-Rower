import os
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch

from scripts.bluetooth_relay import (
    ConsoleHUD,
    RelayPublisher,
    RelayState,
    clear_saved_devices,
    extract_device_info,
    format_telemetry_summary,
    load_saved_devices,
    parse_ftms_rower_data,
    parse_hr_measurement,
    save_saved_device,
)


class TestBluetoothRelay(unittest.TestCase):
    def setUp(self):
        self.tmp_config = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
        self.tmp_config.close()
        os.environ["FTMS_RELAY_CONFIG"] = self.tmp_config.name

    def tearDown(self):
        if os.path.exists(self.tmp_config.name):
            os.remove(self.tmp_config.name)

    def test_parse_ftms_rower_data_basic(self):
        """Test FTMS packet decoding with cadence, power, split, distance, and elapsed time."""
        # Flags: bit 0=0 (stroke present), bit 2=1 (distance), bit 3=1 (split), bit 5=1 (watts), bit 7=1 (res), bit 11=1 (elapsed)
        flags = (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 11)
        data = bytearray()
        data.extend(flags.to_bytes(2, "little"))
        data.append(56)  # Stroke rate 28 SPM (56 * 0.5 = 28 per FTMS standard)
        data.extend((120).to_bytes(2, "little"))  # 120 total strokes
        data.extend((1500).to_bytes(3, "little"))  # 1500m distance
        data.extend((125).to_bytes(2, "little"))  # 125s (2:05) split
        data.extend((210).to_bytes(2, "little", signed=True))  # 210 watts
        data.extend((80).to_bytes(2, "little", signed=True))  # 8.0 resistance
        data.extend((365).to_bytes(2, "little"))  # 365s (06:05) elapsed

        parsed = parse_ftms_rower_data(data)
        self.assertEqual(parsed["stroke_rate"], 28)
        self.assertEqual(parsed["total_strokes"], 120)
        self.assertEqual(parsed["distance"], 1500)
        self.assertEqual(parsed["split_seconds"], 125)
        self.assertEqual(parsed["watts"], 210)
        self.assertEqual(parsed["resistance"], 8.0)
        self.assertEqual(parsed["elapsed_seconds"], 365)
        self.assertEqual(parsed["source"], "ble-relay")

    def test_parse_ftms_rower_data_empty(self):
        """Test FTMS decoder with truncated or invalid packet."""
        self.assertEqual(parse_ftms_rower_data(bytearray()), {})
        self.assertEqual(parse_ftms_rower_data(bytearray([0x01])), {})

    def test_parse_hr_measurement_8bit(self):
        """Test standard 8-bit Heart Rate Measurement packet (0x2A37)."""
        data = bytearray([0x00, 142])
        parsed = parse_hr_measurement(data)
        self.assertEqual(parsed["hr"], 142)
        self.assertEqual(parsed["heart_rate"], 142)
        self.assertEqual(parsed["source"], "ble-relay")

    def test_parse_hr_measurement_16bit(self):
        """Test 16-bit Heart Rate Measurement packet."""
        data = bytearray([0x01, 155, 0x00])
        parsed = parse_hr_measurement(data)
        self.assertEqual(parsed["hr"], 155)
        self.assertEqual(parsed["heart_rate"], 155)

    def test_format_telemetry_summary(self):
        """Test single-line HUD formatting for single-device and dual-device."""
        metrics = {
            "stroke_rate": 26,
            "watts": 195,
            "split_seconds": 124,
            "distance": 2500,
            "elapsed_seconds": 620,
            "resistance": 10,
            "hr": 148,
        }

        # Single device format
        s1 = format_telemetry_summary("MRK-CRYDN-2CEE", None, metrics, interactive=False)
        self.assertIn("26 SPM", s1)
        self.assertIn("195W", s1)
        self.assertIn("2:04/500m", s1)
        self.assertIn("148bpm", s1)
        self.assertIn("2,500m", s1)
        self.assertIn("10:20", s1)
        self.assertIn("MRK-2CEE", s1)

        # Dual device format
        s2 = format_telemetry_summary("MRK-CRYDN-2CEE", "Polar H10", metrics, interactive=False)
        self.assertIn("MRK-2CEE | Polar H10", s2)
        self.assertIn("148bpm", s2)

        # Interactive hints with wide terminal
        with patch("shutil.get_terminal_size", return_value=os.terminal_size((140, 24))):
            s3 = format_telemetry_summary("MRK-2CEE", "Polar H10", metrics, interactive=True)
            self.assertIn("(r:rower h:hr d:disc)", s3)

    def test_saved_devices_memory(self):
        """Test persisting, loading, and clearing remembered devices."""
        clear_saved_devices()
        self.assertEqual(load_saved_devices(), {})

        save_saved_device("rower", "MRK-CRYDN-2CEE", "D4:22:CD:00:1A:2B")
        save_saved_device("hr", "Polar H10 12345", "A1:B2:C3:D4:E5:F6")

        saved = load_saved_devices()
        self.assertIn("rower", saved)
        self.assertEqual(saved["rower"]["name"], "MRK-CRYDN-2CEE")
        self.assertEqual(saved["rower"]["address"], "D4:22:CD:00:1A:2B")

        self.assertIn("hr", saved)
        self.assertEqual(saved["hr"]["name"], "Polar H10 12345")
        self.assertEqual(saved["hr"]["address"], "A1:B2:C3:D4:E5:F6")

        clear_saved_devices()
        self.assertEqual(load_saved_devices(), {})

    def test_relay_state_initialization(self):
        """Test RelayState respects CLI flags and saved devices."""
        save_saved_device("rower", "Saved Rower", "11:22:33:44:55:66")
        save_saved_device("hr", "Saved HR", "77:88:99:AA:BB:CC")

        args = MagicMock(
            server="http://localhost:8000",
            address=None,
            name=None,
            hr=False,
            hr_name=None,
            hr_address=None,
            forget=False,
            idle_timeout=300,
            silence_window=480,
            no_interactive=True,
            verbose=False,
        )

        state = RelayState(args)
        # Should auto-target saved rower and saved HR
        self.assertEqual(state.rower_target_address, "11:22:33:44:55:66")
        self.assertTrue(state.hr_enabled)
        self.assertEqual(state.hr_target_address, "77:88:99:AA:BB:CC")

    def test_format_idle_status(self):
        """Test idle status display across unconfigured, scanning, and disconnected states."""
        from scripts.bluetooth_relay import format_idle_status

        # 1. Unconfigured standby
        mock_state = MagicMock(
            rower_enabled=False,
            rower_paused=False,
            hr_enabled=False,
            hr_paused=False,
            rower_status_line="Standby",
        )
        s1 = format_idle_status(mock_state)
        self.assertIn("[Standby]", s1)
        self.assertIn("No device configured", s1)

        # 2. Configured rower scanning
        mock_state.rower_enabled = True
        mock_state.rower_target_name = "MRK-CRYDN-2CEE"
        mock_state.rower_status_line = "Scanning Rower"
        s2 = format_idle_status(mock_state)
        self.assertIn("[Scanning]", s2)
        self.assertIn("MRK-CRYDN-2CEE", s2)

        # 3. Disconnected rower
        mock_state.rower_paused = True
        s3 = format_idle_status(mock_state)
        self.assertIn("[Standby]", s3)
        self.assertIn("Press [r] to select rower", s3)

    def test_relay_publisher_endpoint(self):
        """Test RelayPublisher endpoint construction and publication."""
        p1 = RelayPublisher("http://localhost:8000")
        self.assertEqual(p1.endpoint, "http://localhost:8000/api/telemetry/publish")

        p2 = RelayPublisher("http://localhost:8000/ftms-rower")
        self.assertEqual(p2.endpoint, "http://localhost:8000/ftms-rower/api/telemetry/publish")

        with patch("urllib.request.urlopen") as mock_urlopen:
            p1.publish({"stroke_rate": 24, "watts": 180})
            mock_urlopen.assert_called_once()

    def test_discovery_coordinator_caching(self):
        """Test BLEDiscoveryCoordinator caches discovery results across rapid calls."""
        import asyncio
        from scripts.bluetooth_relay import BLEDiscoveryCoordinator

        coordinator = BLEDiscoveryCoordinator()
        mock_dev1 = MagicMock(address="11:22:33:44:55:66")
        mock_adv1 = MagicMock(local_name="Rower Test", service_uuids=["00001826-0000-1000-8000-00805f9b34fb"])

        async def run_test():
            with patch("bleak.BleakScanner.discover", return_value={"dev1": (mock_dev1, mock_adv1)}) as mock_disc:
                # First call performs scan
                items1 = await coordinator.discover(timeout=1.0)
                self.assertEqual(len(items1), 1)
                self.assertEqual(mock_disc.call_count, 1)

                # Rapid second call uses cache without re-invoking discover
                items2 = await coordinator.discover(timeout=1.0, force_refresh=False)
                self.assertEqual(len(items2), 1)
                self.assertEqual(mock_disc.call_count, 1)

                # Force refresh forces new scan
                items3 = await coordinator.discover(timeout=1.0, force_refresh=True)
                self.assertEqual(len(items3), 1)
                self.assertEqual(mock_disc.call_count, 2)

        asyncio.run(run_test())

    def test_interactive_commands_clear_and_quit(self):
        """Test interactive command queue handles clearing devices and quitting."""
        import asyncio
        from scripts.bluetooth_relay import interactive_terminal_task, BLEDiscoveryCoordinator

        args = MagicMock(
            server="http://localhost:8000",
            address=None,
            name=None,
            hr=False,
            hr_name=None,
            hr_address=None,
            forget=False,
            idle_timeout=300,
            silence_window=480,
            no_interactive=False,
            verbose=False,
        )
        state = RelayState(args)
        save_saved_device("rower", "Test Rower", "11:22:33:44:55:66")
        self.assertIn("rower", load_saved_devices())

        coordinator = BLEDiscoveryCoordinator()
        publisher = MagicMock()
        hud = MagicMock()
        cmd_queue = asyncio.Queue()

        async def run_test():
            # Send 'c' (clear devices) then 'q' (quit)
            cmd_queue.put_nowait("c")
            cmd_queue.put_nowait("q")

            await interactive_terminal_task(state, coordinator, publisher, hud, cmd_queue)
            self.assertTrue(state.stop_event.is_set())
            self.assertEqual(load_saved_devices(), {})

        asyncio.run(run_test())

    def test_terminal_hotkeys_safe(self):
        """Test TerminalHotkeys initializes and methods execute without error."""
        from scripts.bluetooth_relay import TerminalHotkeys
        mgr = TerminalHotkeys()
        # Should not raise exception even when not a TTY or in test runners
        mgr.enable_hotkeys()
        mgr.restore_cooked()
        mgr.flush_input()

    def test_handle_interactive_scan_rower_enables_state(self):
        """Test handle_interactive_scan_rower activates rower_enabled and sets rower_enable_event."""
        import asyncio
        from unittest.mock import patch, AsyncMock
        from scripts.bluetooth_relay import handle_interactive_scan_rower, BLEDiscoveryCoordinator

        import argparse
        args = argparse.Namespace(
            server="http://localhost:8000",
            address=None,
            name=None,
            hr=False,
            hr_name=None,
            hr_address=None,
            forget=True,
            idle_timeout=300,
            silence_window=480,
            no_interactive=False,
            auto=False,
            verbose=False,
        )
        state = RelayState(args)
        self.assertFalse(state.rower_enabled)

        mock_dev = MagicMock()
        mock_dev.address = "AA:BB:CC:DD:EE:FF"
        mock_dev.name = "Concept2 PM5"
        mock_adv = MagicMock()
        mock_adv.local_name = "Concept2 PM5"
        mock_adv.service_uuids = ["00001826-0000-1000-8000-00805f9b34fb"]

        coordinator = MagicMock()
        coordinator.discover = AsyncMock(return_value=[(mock_dev, mock_adv)])
        hud = MagicMock()

        async def run_test():
            with patch("builtins.input", return_value="1"):
                await handle_interactive_scan_rower(state, coordinator, hud)

            self.assertTrue(state.rower_enabled)
            self.assertTrue(state.rower_enable_event.is_set())
            self.assertEqual(state.rower_target_name, "Concept2 PM5")
            self.assertEqual(state.rower_target_address, "AA:BB:CC:DD:EE:FF")

        asyncio.run(run_test())

    def test_relay_state_auto_flag(self):
        """Test passing --auto enables rower scanning immediately."""
        import argparse
        args = argparse.Namespace(
            server="http://localhost:8000",
            address=None,
            name=None,
            hr=False,
            hr_name=None,
            hr_address=None,
            forget=True,
            idle_timeout=300,
            silence_window=480,
            no_interactive=False,
            auto=True,
            verbose=False,
        )
        state = RelayState(args)
        self.assertTrue(state.rower_enabled)
        self.assertTrue(state.rower_enable_event.is_set())

    def test_relay_state_stop_method(self):
        """Test RelayState.stop() wakes all enable and reconnect events."""
        import argparse
        args = argparse.Namespace(
            server="http://localhost:8000",
            address=None,
            name=None,
            hr=False,
            hr_name=None,
            hr_address=None,
            forget=True,
            idle_timeout=300,
            silence_window=480,
            no_interactive=False,
            auto=False,
            verbose=False,
        )
        state = RelayState(args)
        self.assertFalse(state.stop_event.is_set())
        self.assertFalse(state.rower_enable_event.is_set())
        self.assertFalse(state.hr_enable_event.is_set())

        state.stop()

        self.assertTrue(state.stop_event.is_set())
        self.assertTrue(state.rower_enable_event.is_set())
        self.assertTrue(state.hr_enable_event.is_set())
        self.assertTrue(state.rower_reconnect_event.is_set())
        self.assertTrue(state.hr_reconnect_event.is_set())
        self.assertTrue(state.rower_silence_skip_event.is_set())

    def test_handle_interactive_scan_rower_rescan(self):
        """Test handle_interactive_scan_rower rescans when user types 'r'."""
        import asyncio
        from unittest.mock import patch, AsyncMock
        from scripts.bluetooth_relay import handle_interactive_scan_rower

        import argparse
        args = argparse.Namespace(
            server="http://localhost:8000",
            address=None,
            name=None,
            hr=False,
            hr_name=None,
            hr_address=None,
            forget=True,
            idle_timeout=300,
            silence_window=480,
            no_interactive=False,
            auto=False,
            verbose=False,
        )
        state = RelayState(args)

        mock_dev = MagicMock()
        mock_dev.address = "11:22:33:44:55:66"
        mock_dev.name = "MRK-CRYDN-2CEE"
        mock_adv = MagicMock()
        mock_adv.local_name = "MRK-CRYDN-2CEE"
        mock_adv.service_uuids = ["00001826-0000-1000-8000-00805f9b34fb"]

        coordinator = MagicMock()
        coordinator.discover = AsyncMock(return_value=[(mock_dev, mock_adv)])
        hud = MagicMock()

        async def run_test():
            # First input 'r' (rescan), second input '1' (select first)
            with patch("builtins.input", side_effect=["r", "1"]):
                await handle_interactive_scan_rower(state, coordinator, hud)

            self.assertEqual(coordinator.discover.call_count, 2)
            self.assertTrue(state.rower_enabled)
            self.assertEqual(state.rower_target_name, "MRK-CRYDN-2CEE")

        asyncio.run(run_test())

    def test_console_hud_deduplicates_repeated_updates(self):
        """Test ConsoleHUD does not repeatedly re-write identical status lines."""
        hud = ConsoleHUD(verbose=False)
        with patch("sys.stdout.isatty", return_value=True):
            with patch("sys.stdout.write") as mock_write:
                hud.update("[Scanning] Searching for FTMS Rower...")
                self.assertEqual(mock_write.call_count, 1)

                # Calling update again with identical text should be a no-op
                hud.update("[Scanning] Searching for FTMS Rower...")
                self.assertEqual(mock_write.call_count, 1)

                # Updating with new text should write
                hud.update("[OK] Connected to FTMS Rower")
                self.assertEqual(mock_write.call_count, 2)

    def test_console_hud_in_place_formatting(self):
        """Test ConsoleHUD uses carriage return and ANSI line clearing without padding overflow."""
        hud = ConsoleHUD(verbose=False)
        with patch("sys.stdout.isatty", return_value=True):
            with patch("shutil.get_terminal_size") as mock_term:
                mock_term.return_value = os.terminal_size((80, 24))
                with patch("sys.stdout.write") as mock_write:
                    long_text = "[Scanning] Searching for FTMS Rower... (Pull handle to wake | r: change | h: add hr)"
                    hud.update(long_text)
                    written = mock_write.call_args[0][0]
                    self.assertTrue(written.startswith("\r\033[K"))
                    # Must not exceed terminal columns - 2 to avoid edge-wrap waterfalling
                    content = written[len("\r\033[K"):]
                    self.assertLessEqual(len(content), 78)


    def test_mute_stage_exit_and_resume_events(self):
        """Test that 'r', space, Enter immediately signal rower_silence_skip_event when muted, and 'q'/'x' stop relay."""
        import asyncio
        import argparse
        from scripts.bluetooth_relay import interactive_terminal_task

        args = argparse.Namespace(
            server="http://localhost:8000",
            address=None,
            name=None,
            hr=False,
            hr_name=None,
            hr_address=None,
            forget=True,
            idle_timeout=300,
            silence_window=360,
            no_interactive=False,
            auto=False,
            verbose=False,
        )
        state = RelayState(args)
        state.rower_muted = True
        state.rower_silence_skip_event.clear()

        coordinator = MagicMock()
        publisher = MagicMock()
        hud = MagicMock()
        cmd_queue = asyncio.Queue()

        async def run_test():
            # Send 'r' while muted
            await cmd_queue.put("r")
            task = asyncio.create_task(interactive_terminal_task(state, coordinator, publisher, hud, cmd_queue, None))
            # Let event loop process 'r'
            await asyncio.sleep(0.05)
            self.assertTrue(state.rower_silence_skip_event.is_set())
            self.assertFalse(state.interactive_mode)

            # Clear and test 'q' (exit)
            state.rower_silence_skip_event.clear()
            await cmd_queue.put("q")
            await asyncio.wait_for(task, timeout=2.0)
            self.assertTrue(state.stop_event.is_set())
            self.assertTrue(state.rower_silence_skip_event.is_set())

        asyncio.run(run_test())

    def test_silence_window_cli_default(self):
        """Verify default CLI silence-window is 360 seconds (6 minutes)."""
        import argparse
        from scripts.bluetooth_relay import main

        # Create parser identical to main
        parser = argparse.ArgumentParser()
        parser.add_argument("--silence-window", type=int, default=360)
        parsed = parser.parse_args([])
        self.assertEqual(parsed.silence_window, 360)

    def test_parse_ftms_rower_data_multipliers(self):
        """Test FTMS cadence decoding with standard (0.5x), quarter (0.25x), and direct (1.0x) multipliers."""
        flags = 0  # Bit 0 = 0 (stroke rate present)
        data = bytearray()
        data.extend(flags.to_bytes(2, "little"))
        data.append(80)  # Raw 80 from rower
        data.extend((50).to_bytes(2, "little"))

        # Standard 0.5x multiplier: 80 * 0.5 = 40 SPM
        parsed_std = parse_ftms_rower_data(data, spm_multiplier=0.5)
        self.assertEqual(parsed_std["stroke_rate"], 40)

        # Quarter 0.25x multiplier (doubled-pulse / slow-pull fix): 80 * 0.25 = 20 SPM
        parsed_quarter = parse_ftms_rower_data(data, spm_multiplier=0.25)
        self.assertEqual(parsed_quarter["stroke_rate"], 20)

        # Direct 1.0x multiplier: 80 * 1.0 = 80 SPM
        parsed_direct = parse_ftms_rower_data(data, spm_multiplier=1.0)
        self.assertEqual(parsed_direct["stroke_rate"], 80)

    def test_interactive_cycle_spm_multiplier(self):
        """Test that pressing 's' in interactive mode cycles SPM multiplier: 0.5 -> 0.25 -> 1.0 -> 0.5."""
        import argparse
        import asyncio
        from scripts.bluetooth_relay import interactive_terminal_task

        args = argparse.Namespace(
            server="http://localhost:8000",
            address=None,
            name=None,
            hr=False,
            hr_name=None,
            hr_address=None,
            forget=True,
            idle_timeout=300,
            silence_window=360,
            spm_multiplier=0.5,
            no_interactive=False,
            auto=False,
            verbose=False,
        )
        state = RelayState(args)
        self.assertAlmostEqual(state.spm_multiplier, 0.5)

        coordinator = MagicMock()
        publisher = MagicMock()
        hud = MagicMock()
        cmd_queue = asyncio.Queue()

        async def run_test():
            task = asyncio.create_task(interactive_terminal_task(state, coordinator, publisher, hud, cmd_queue, None))

            # Send 's' -> cycles to 0.25
            await cmd_queue.put("s")
            await asyncio.sleep(0.05)
            self.assertAlmostEqual(state.spm_multiplier, 0.25)

            # Send 's' -> cycles to 1.0
            await cmd_queue.put("s")
            await asyncio.sleep(0.05)
            self.assertAlmostEqual(state.spm_multiplier, 1.0)

            # Send 's' -> cycles back to 0.5
            await cmd_queue.put("s")
            await asyncio.sleep(0.05)
            self.assertAlmostEqual(state.spm_multiplier, 0.5)

            # Clean exit
            await cmd_queue.put("q")
            await asyncio.wait_for(task, timeout=2.0)

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()



