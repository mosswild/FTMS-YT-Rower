# FTMS-Rower: Scenic Indoor Rowing Dashboard & Telemetry HUD

A modernized, full-stack scenic indoor rowing application and simulator for Bluetooth FTMS rowing machines. Forked and reimagined from [manuelkamp/FTMS-rower](https://github.com/manuelkamp/FTMS-rower).

FTMS-Rower transforms indoor rowing into an immersive outdoor experience. As you row, your stroke cadence dynamically modulates video playback speed ($0.3\times \dots 2.5\times$), while soundtrack audio remains crystal-clear and locked at a steady $1.0\times$.

---

## Key Features

### 1. Decoupled Audio Pipeline
- **Muted Scenic Video:** The scenic video element is strictly muted so its playback rate can fluctuate freely between $0.3\times$ (paddle) and $2.5\times$ (all-out sprint) without audio pitch distortion or chipmunk effects.
- **Fixed-Rate Soundtrack:** A decoupled HTML5 `<audio>` element streams the extracted soundtrack or custom playlist at native $1.0\times$ speed.
- **Dynamic Auto-Pause:** When rowing halts or pauses, the audio gently pauses alongside the video and resumes seamlessly when rowing restarts.
- **Autoplay Handling:** Includes one-click un-mute prompt complying with modern browser autoplay policies.

### 2. YouTube Ingestion & Range-Streaming Engine
- Integrated backend powered by **FastAPI**, **`yt-dlp`**, and **`ffmpeg`**.
- Dual-stream extraction: Ingests 1080p/4K H.264 video and extracts separate high-quality M4A audio tracks.
- **RFC 7233 Range Streaming:** Supports HTTP 206 partial content streaming for instant, smooth video scrubbing and track looping.

### 3. Scenic "Tracks" Feature & Cockpit Transport
- **Custom Track Segments:** Define and save segments within videos with specified `start_time` and `end_time` (e.g., a pristine 5K river loop).
- **Loop Boundary Enforcement:** Videos loop smoothly within the track's configured start and end timestamps.
- **Audio Association & Live Preview Player:** Assign default audio soundtracks and curate allowed playlists with an in-modal audio preview player and timeline scrubber to audition tracks before saving.
- **Edit Existing Tracks & Video Thumbnails:** Edit any existing track at any time with live video thumbnail previews displaying duration and file sizes.
- **Cockpit Transport Bar:**
  - **Restart Track (`⏮`):** Immediately jumps back to the track's start position.
  - **Pan Back 10s (`⏪ 10s`):** Steps backward within the track bounds.
  - **Pan Forward 10s (`⏩ 10s`):** Steps forward within the track bounds.
  - **Track Scrubber:** Responsive timeline slider bounded specifically to the active track duration.

### 4. Concept2 PM5-Style Telemetry HUD
- **Real-time Glassmorphism Cockpit:**
  - **Pace / 500m:** Instantaneous pace computed from power/stroke rate.
  - **Cadence (SPM):** Stroke rate with boat glide deceleration and 3.5s inactivity auto-pause watchdog.
  - **Power (Watts):** Concept2 non-linear formula: $\text{Watts} = 2.80 / (P_{500}/500)^3$.
  - **Heart Rate (BPM):** BLE Heart Rate monitor integration with color-coded training zones.
  - **Distance & Time:** Distance rowed, elapsed time, and total stroke count.
- **Auto-Hide:** Automatically fades out controls after 4 seconds of inactivity for a cinematic fullscreen view.

### 5. Dual-Source Telemetry & Virtual Simulator
- **Web Bluetooth FTMS:** Connects to standard FTMS rowing machines (`0x2AD1`) including Merach Q1S, Concept2 PM5, WaterRower ComModule, and standard BLE Heart Rate monitors (`0x180D`).
- **Dynamic Workout Simulator:** Built-in rowing simulator with two operating modes:
  - **Dynamic Program:** Automatically cycles through structured interval training phases:
    1. *Warmup / Cruise* (22 SPM, 2:05 split)
    2. *Surge Phase* (29 SPM, 1:48 split)
    3. *Sprint All-Out* (34 SPM, 1:35 split)
    4. *Paddle Down* (17 SPM, 2:18 split)
    5. *Rest & Auto-Pause* (0 SPM — tests auto-pause watchdog)
    6. *Catch & Recover* (25 SPM, 1:58 split)
  - **Manual Slider:** Fine-tune target SPM ($14 \dots 38$) with live split and watt calculations.
  - **Instant Pause / Resume:** "Pause Pulling" button to immediately halt stroke production and test boat glide and auto-pause.

### 6. Session Persistence & Garmin TCX Export
- Workouts and per-second trackpoint telemetry are stored locally in SQLite (`data/sessions.db`).
- Export complete workout history to standard **Garmin Training Center XML (`.TCX`)** format compatible with Strava, Garmin Connect, and TrainingPeaks.

---

## Installation & Quick Start

### Prerequisites
- Python 3.10+
- `ffmpeg` installed on your system (`brew install ffmpeg` on macOS or `sudo apt install ffmpeg` on Ubuntu)
- Google Chrome, Microsoft Edge, or any Chromium browser supporting Web Bluetooth

### Option A: Docker Container Deployment (Recommended)
Following the standard LinuxServer/self-hosting container pattern, persistent database (`sessions.db`) and downloaded media are mapped to `./config`:

```bash
# 1. Clone the repository
git clone https://github.com/mosswild/FTMS-YT-Rower.git
cd FTMS-YT-Rower

# 2. Build and launch container
docker compose up -d
```

Open `http://localhost:8000` in Google Chrome or Edge.

#### Customizing the Port:
To run on a different port (e.g. `9000`):
- **Via `.env` file:** Copy `.env.example` to `.env` and set `PORT=9000`.
- **Or via command line:**
  ```bash
  PORT=9000 docker compose up -d
  ```
  The app will immediately bind to `http://localhost:9000`.

#### Container Configuration (`docker-compose.yml`):
- **Port:** `${PORT:-8000}:${PORT:-8000}`
- **Volume:** `./config:/config` (persists SQLite database under `/config/data` and scenic videos/audio under `/config/media`)
- **User Permissions:** Supports `PUID` and `PGID` environment variables (default: `1000:1000`) for seamless non-root host file ownership.

---

### Option B: Local Python Setup
```bash
# Clone the repository
git clone https://github.com/mosswild/FTMS-YT-Rower.git
cd FTMS-YT-Rower

# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Running Locally
Start the FastAPI server:
```bash
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```
Open your browser to:
```
http://127.0.0.1:8000
```

---

## Running Automated Tests
Run the backend unit test suite:
```bash
PYTHONPATH=. .venv/bin/python tests/test_backend.py
```
Tests cover:
- Concept2 pace-to-watts physics formula
- SQLite workout session CRUD
- Garmin TCX XML schema and trackpoint generation
- HTTP 206 Partial Content range requests
- FastAPI REST endpoints
- Scenic Tracks configuration and retrieval

---

## Supported Browsers
| Chrome (Desktop/Android) | Edge | Opera | Safari | Firefox |
|:------------------------:|:----:|:-----:|:------:|:-------:|
| Yes                      | Yes  | Yes   | No     | No      |

*Note: Web Bluetooth requires Chrome, Edge, or Opera with HTTPS or `localhost`/`127.0.0.1`.*

---

## Upstream Base & License
Original proof-of-concept created by [Manuel Kamp](https://github.com/manuelkamp/FTMS-rower).  
Modernized and expanded with decoupled audio, YouTube ingestion, PM5 HUD, Scenic Tracks, and session persistence.
Released under the MIT License.