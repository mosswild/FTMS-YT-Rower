# 🐳 Synology NAS & Docker Container Setup Guide

This guide explains how to host **FTMS-Rower** in a Docker container on a **Synology NAS** (or any Linux/Unraid/TrueNAS server running Docker) with external volume mounts for your session history database and downloaded scenic media files.

Following the [LinuxServer container design pattern](https://docs.linuxserver.io/general/docker-compose/), this setup supports `PUID` and `PGID` environment variables to ensure container file permissions match your Synology NAS host user permissions.

---

## 📁 Directory & Storage Structure

When mounted to the container, all persistent application data is stored under the `/config` path on the host system:

```text
/volume1/docker/ftms-rower/
└── config/
    ├── data/
    │   └── sessions.db       <-- Workout history, per-second trackpoints, and custom tracks
    └── media/
        ├── videos/           <-- Downloaded YouTube & device-uploaded scenic videos
        └── audio/            <-- Extracted and uploaded soundtrack audio
```

You can view, edit, or back up `sessions.db` and video files directly via **Synology File Station** or standard network file shares (SMB/NFS).

---

## 👤 Finding your PUID and PGID

To prevent permission issues when writing media files or database entries to host folders on Synology NAS, set the container's `PUID` (User ID) and `PGID` (Group ID) to match your Synology user account.

1. SSH into your Synology NAS:
   ```bash
   ssh your_synology_user@<SYNOLOGY-IP>
   ```
2. Run the `id` command:
   ```bash
   id
   ```
3. Note your `uid` (e.g. `1026`) and `gid` (e.g. `100`). Use these values for `PUID` and `PGID` in your configuration.

---

## 🚀 Deployment Methods

### Option A: Deploying via Synology Container Manager (Recommended GUI)

1. Open **Container Manager** in DSM (DSM 7.2+).
2. Go to the **Project** tab and click **Create**.
3. Configure the project:
   * **Project Name:** `ftms-rower`
   * **Path:** Choose or create `/docker/ftms-rower` (e.g., `/volume1/docker/ftms-rower`).
   * **Source:** Select **Create docker-compose.yml**.
4. Paste the following configuration:

```yaml
version: '3.8'

services:
  ftms-rower:
    build: https://github.com/mosswild/FTMS-YT-Rower.git#main
    # Or use local path / custom image if building manually:
    # image: ftms-rower:latest
    container_name: ftms-rower
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - PUID=1026              # Replace with your Synology UID
      - PGID=100               # Replace with your Synology GID
      - TZ=America/New_York
      - PORT=8000
      - DATA_DIR=/config/data
      - MEDIA_DIR=/config/media
    volumes:
      - /volume1/docker/ftms-rower/config:/config
```

5. Click **Next** and finish setup. Container Manager will build/download the container, mount the `/config` directory, and start the service.

---

### Option B: Deploying via Docker Compose (SSH / CLI)

1. SSH into your Synology NAS:
   ```bash
   ssh your_user@<SYNOLOGY-IP>
   ```
2. Navigate to your Docker shared folder and clone the repository:
   ```bash
   cd /volume1/docker
   git clone https://github.com/mosswild/FTMS-YT-Rower.git ftms-rower
   cd ftms-rower
   ```
3. Copy `.env.example` to `.env` and set your `PUID` and `PGID`:
   ```bash
   cp .env.example .env
   nano .env
   ```
4. Build and start the container in detached mode:
   ```bash
   docker compose up -d --build
   ```

---

## 🌐 Accessing FTMS-Rower Across Your Home Network

Once the container is running, access FTMS-Rower in your web browser at:

```text
http://<YOUR-SYNOLOGY-IP>:8000/ftms-rower
```
*(Example: `http://192.168.1.100:8000/ftms-rower`)*

---

## 📶 Web Bluetooth & Mobile Devices (iPad, Tablet, Phone)

Browsers (Google Chrome, Edge) require a **Secure Context (HTTPS or localhost)** to allow the Web Bluetooth API (`navigator.bluetooth`) to scan and connect to your rowing machine or heart rate strap.

When hosting FTMS-Rower on a home server or NAS over plain `http://`:

### Option 1: Synology Reverse Proxy with HTTPS (Recommended)
You can set up a clean, secure address like `https://rower.local` or `https://rower.myhome.nas`:

1. In DSM, open **Control Panel** > **Login Portal** > **Advanced** tab > **Reverse Proxy**.
2. Click **Create**:
   * **General**:
     * **Source:**
       * Protocol: `HTTPS`
       * Hostname: `rower.local` (or your domain)
       * Port: `443`
       * Enable HSTS: Checked
     * **Destination:**
       * Protocol: `HTTP`
       * Hostname: `localhost`
       * Port: `8000`
3. Click **Save**.
4. In **Control Panel** > **Security** > **Certificate**, assign a certificate (such as Synology Let's Encrypt or a local self-signed certificate) to your reverse proxy entry.
5. On your phone or tablet, navigate to `https://rower.local/ftms-rower`. Web Bluetooth will be fully active!

### Option 2: Standalone Bluetooth Relay Bridge (Standard Safari over Wi-Fi)
If you have a computer, Mac, or Raspberry Pi near your rowing machine:
1. Run the included standalone relay bridge:
   ```bash
   pip install bleak
   python scripts/bluetooth_relay.py --server http://<YOUR-SYNOLOGY-IP>:8000
   ```
2. The relay pairs with your rower and broadcasts metrics to the server via WebSockets.
3. You can now use **standard iOS Safari** (including a Safari Home Screen bookmark) or any TV web browser to view live metrics over Wi-Fi!

### Option 3: Chrome Insecure Origin Flag (Android / Windows)
If accessing via plain HTTP (`http://192.168.1.100:8000/ftms-rower`) on Android Chrome:
1. In Chrome, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
2. Add your server's address: `http://192.168.1.100:8000`
3. Set to **Enabled** and click **Relaunch**.

### Option 5: Virtual Simulator Mode (No Bluetooth Needed)
If you are using a phone or tablet merely as an ambient scenic display on your rower's tablet mount without Bluetooth, the built-in **Dynamic Program Simulator** allows you to test workouts, intervals, and pace-synced video streaming without needing a Bluetooth connection.

---

## 🔒 Backups & Restores

Since database and scenic media files are stored in the external mount (`/config`):
* **Backup:** Copy the `/volume1/docker/ftms-rower/config` folder using **Synology Hyper Backup**, **Cloud Sync**, or File Station.
* **Restore:** Place your backed-up `config` folder into `/volume1/docker/ftms-rower/` before launching the container.
