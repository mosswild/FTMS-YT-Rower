# Bluetooth Relay Bridge Setup & Auto-Start Guide

The **FTMS-Rower Bluetooth Relay Bridge** connects directly to your rowing machine (or Heart Rate monitor) using the host machine's Bluetooth hardware, and broadcasts live telemetry to the FTMS-Rower server over your local Wi-Fi network via WebSockets.

---

## 🚀 Why Use the Relay Bridge?

| Feature | Direct Web Bluetooth in Browser | Wi-Fi Relay Bridge |
| :--- | :---: | :---: |
| **Compatible with iPhone / iPad Safari** | ❌ No (Apple blocks Web Bluetooth) | ✅ **Yes** |
| **Compatible with Apple TV Mirroring** | ❌ No | ✅ **Yes** |
| **Compatible with Mozilla Firefox** | ❌ No | ✅ **Yes** |
| **Compatible with Smart TVs & Tablets** | ❌ Limited | ✅ **Yes** |
| **Needs HTTPS / SSL Certificates** | ⚠️ Required on LAN IPs | 🟢 **Not Needed** (Runs over plain HTTP) |
| **Needs Special Browser Flags** | ⚠️ Required on Android Chrome | 🟢 **Not Needed** |

---

## ⚡ How It Works (Dual-Device Concurrency & Live Console HUD)

The relay script ([scripts/bluetooth_relay.py](../scripts/bluetooth_relay.py)) includes **concurrent dual-device connection loops (Rower + Heart Rate strap), collision-free discovery coordination, device memory with auto-reconnect, interactive terminal controls, and a single-line real-time terminal HUD**:

1. **Dual-Device Concurrency:** Simultaneously manages independent BLE connections to:
   - **FTMS Rower (`0x1826` / `0x2AD1`):** Cadence, power, 500m split, distance, resistance, and elapsed time with automatic stroke wakeups and battery conservation.
   - **Heart Rate Monitor (`0x180D` / `0x2A37`):** Polar H10/H9, Garmin HRM-Dual, Wahoo TICKR, CooSpo, Apple Watch BLE broadcast, chest straps, or armbands.
2. **Device Memory & Auto-Reconnect:** Remembers your previously connected rower and heart rate monitor (`~/.ftms_relay_devices.json`). On subsequent launches, it automatically reconnects to your preferred devices without requiring flags or manual selection.
3. **Interactive Terminal Controls:** Press hotkeys directly in your terminal while the relay is running:
   - **`[r]`** - **Scan & Select Rower:** Scans nearby devices for 4 seconds, presents a numbered list, and connects to your choice.
   - **`[h]`** - **Scan & Select HR Monitor:** Scans for heart rate monitors, presents a numbered list, and enables concurrent HR telemetry.
   - **`[d]`** - **Disconnect Device:** Disconnect Rower, HR monitor, or Both on demand.
   - **`[s]`** - **Cycle SPM Multiplier:** Instant toggle between standard 0.5× resolution, 0.25× quarter resolution (for rowers reporting doubled cadence/half-strokes), and 1.0× direct integer resolution.
   - **`[c]`** - **Clear Saved Devices:** Clears remembered device memory.
   - **`[m]` / `[?]`** - **Help:** Prints the interactive hotkey reference guide.
   - **`[q]`** - **Quit:** Cleanly disconnects all active BLE sessions and exits.
4. **Live Single-Line HUD:** Merges telemetry from both devices into a single compact status line:
   ```text
   [09:35:14 PM] [MRK-2CEE | Polar H10] 24 SPM | 185W | 2:05/500m | 142bpm | 1,240m | 05:42 (r:rower h:hr d:disc)
   ```
5. **Inactivity & Battery Conservation Sleep:** If you step away from the rower for 5 minutes (`--idle-timeout 300`), the relay automatically disconnects the rower and enters an 8-minute radio silence window (`--silence-window 480`) allowing the rower's screen and console to shut down. Connected heart rate monitors remain active while the athlete rests. Pressing `[r]` resumes active scanning at any time.
6. **Decoupled Mixed-Mode Web App Support:** In the web cockpit (`js/app.js`), relay-delivered HR packets update the PM5 HUD and session metrics even if you connect your rower directly via browser Web Bluetooth, allowing flexible mix-and-match setups.

---

## 🪟 Windows Setup & Automatic Startup

### 1. Manual Launch
Double-click `run_relay_windows.bat` in the repository root. It will automatically check for Python, install `bleak` if missing, and connect to `http://localhost:8000`.

### 2. Auto-Start with Windows (Set-and-Forget)
To have the relay start automatically whenever your Windows PC boots up:

1. Press **`Win + R`**, type **`shell:startup`**, and hit **Enter** (this opens your personal Windows Startup folder).
2. **Right-click** inside the folder → **New** → **Shortcut**.
3. Click **Browse...** and select `run_relay_windows.bat` from your cloned `FTMS-rower` folder.
4. Name the shortcut `FTMS Rower Relay` and click **Finish**.
5. *(Recommended)* Right-click your new shortcut → **Properties**:
   - Change the **Run** dropdown from *Normal window* to **Minimized**.
   - Click **OK**.

Now, whenever you log into Windows, the relay bridge runs minimized in the background. You never have to touch it again—just sit on your rower and open Safari on your phone!

---

## 🍎 macOS Setup & Background Service

### 1. Manual Launch
```bash
# 1. Install bleak
pip install bleak

# 2. Start relay
python scripts/bluetooth_relay.py --server http://localhost:8000
```

### 2. Auto-Start via macOS `launchd` (Optional)
Create a file at `~/Library/LaunchAgents/com.ftmsrower.relay.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ftmsrower.relay</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/Users/YOUR_USERNAME/repos/FTMS-rower/scripts/bluetooth_relay.py</string>
        <string>--server</string>
        <string>http://localhost:8000</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```
Load the service:
```bash
launchctl load ~/Library/LaunchAgents/com.ftmsrower.relay.plist
```

---

## 🐧 Linux Setup & Background Service (`systemd`)

### 1. Manual Launch
```bash
pip install bleak
python3 scripts/bluetooth_relay.py --server http://localhost:8000
```

### 2. Auto-Start via `systemd` User Service
Create `~/.config/systemd/user/ftms-relay.service`:

```ini
[Unit]
Description=FTMS-Rower Bluetooth Relay Bridge
After=network.target bluetooth.target

[Service]
ExecStart=/usr/bin/python3 /opt/FTMS-rower/scripts/bluetooth_relay.py --server http://localhost:8000
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Enable and start:
```bash
systemctl --user daemon-reload
systemctl --user enable --now ftms-relay.service
```

---

## 🐳 Embedded Docker Relay (Linux Hosts)

If your Linux host has native Bluetooth hardware and BlueZ installed, the container itself can run the relay bridge without any host scripts:

1. In `docker-compose.yml`, uncomment:
   ```yaml
   network_mode: host
   environment:
     - ENABLE_BLUETOOTH_RELAY=true
     - BLE_DEVICE_NAME=Concept2   # optional name filter
   volumes:
     - /var/run/dbus:/var/run/dbus:ro
   ```
2. Restart the container:
   ```bash
   docker compose up -d --build
   ```

---

## 🛠️ CLI Options & Diagnostics

| Flag | Description | Example |
| :--- | :--- | :--- |
| `--server <URL>` | Target FTMS-Rower server address | `--server http://192.168.1.50:8000` |
| `--scan` | Scans and lists all nearby Bluetooth fitness devices (rowers & HR straps) | `python scripts/bluetooth_relay.py --scan` |
| `--name <NAME>` | Filter rower connection to a specific machine name | `--name "PM5"` or `--name "Merach"` |
| `--address <MAC>`| Target an exact Bluetooth MAC or UUID for the rower | `--address "D4:22:CD:00:1A:2B"` |
| `--hr` | Auto-pair first discovered BLE Heart Rate monitor (`0x180D`) | `python scripts/bluetooth_relay.py --hr` |
| `--hr-name <NAME>`| Filter Heart Rate monitor by device name | `--hr-name "Polar"` or `--hr-name "Garmin"` |
| `--hr-address <MAC>`| Target an exact Bluetooth MAC or UUID for the HR monitor | `--hr-address "A1:B2:C3:D4:E5:F6"` |
| `--forget` | Clear remembered devices from disk and discover fresh | `python scripts/bluetooth_relay.py --forget` |
| `--no-interactive` | Disable interactive terminal hotkeys (for headless/docker/daemon execution) | `python scripts/bluetooth_relay.py --no-interactive` |
| `-v`, `--verbose`| Enable verbose multi-line scrolling logs instead of single-line HUD | `python scripts/bluetooth_relay.py -v` |
| `--idle-timeout <SEC>`| Inactivity timeout in seconds before auto-disconnecting rower (default: 300 / 5 min; 0 to disable) | `python scripts/bluetooth_relay.py --idle-timeout 600` |
| `--silence-window <SEC>`| Radio silence window in seconds after idle disconnect allowing rower to sleep (default: 360 / 6 min) | `python scripts/bluetooth_relay.py --silence-window 360` |
| `--spm-multiplier <FLOAT>`| FTMS Stroke Rate resolution multiplier (default: 0.5; 0.25 for rowers with doubled pulses; 1.0 direct) | `python scripts/bluetooth_relay.py --spm-multiplier 0.25` |
