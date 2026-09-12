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

## ⚡ How It Works (Persistent Daemon & Live Console HUD)

The relay script ([scripts/bluetooth_relay.py](../scripts/bluetooth_relay.py)) includes **continuous auto-discovery, persistent reconnection loops, and a single-line real-time terminal HUD**:

1. **Rower Asleep / Scanning:** The script updates a single line in place without flooding your terminal:
   ```text
   [Scanning] Searching for FTMS rower... (Last connected: 09:12:15 PM - Pull handle to wake)
   ```
2. **Workout Starts:** The moment you pull the handle or tap the monitor, the script detects it within seconds, establishes a BLE connection, merges alternating FTMS packets into a unified composite state, and streams telemetry with a live timestamp:
   ```text
   [09:35:14 PM] [MRK-CRYDN-2CEE] 24 SPM | 145W | 2:12/500m | 1,240m | 05:42
   ```
3. **Inactivity & Battery Conservation Sleep:** If you step away for 5 minutes (`--idle-timeout 300`), the relay automatically disconnects and enters an 8-minute radio silence window (`--silence-window 480`). During this window, active BLE scanning is completely silenced so the rower's internal hardware timer (physically verified at 5–6 minutes on Merach Q1 hardware) can shut down the console and LCD screen without interference. Once the rower powers down, the relay quietly returns to passive scanning for your next session.

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
| `--scan` | Scans and lists all nearby Bluetooth fitness devices | `python scripts/bluetooth_relay.py --scan` |
| `--name <NAME>` | Filter connection to a specific machine name | `--name "PM5"` or `--name "Merach"` |
| `--address <MAC>`| Target an exact Bluetooth MAC or UUID | `--address "D4:22:CD:00:1A:2B"` |
| `-v`, `--verbose`| Enable verbose multi-line scrolling logs instead of single-line HUD | `python scripts/bluetooth_relay.py -v` |
| `--idle-timeout <SEC>`| Inactivity timeout in seconds before auto-disconnecting to conserve battery (default: 300 / 5 min; 0 to disable) | `python scripts/bluetooth_relay.py --idle-timeout 600` |
| `--silence-window <SEC>`| Radio silence window in seconds after idle disconnect allowing rower to sleep (default: 480 / 8 min) | `python scripts/bluetooth_relay.py --silence-window 600` |
