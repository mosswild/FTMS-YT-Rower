import asyncio
import json
import base64
import os
import httpx
import websockets

SCREENSHOT_DIR = "/Users/cfaber/repos/FTMS-rower/docs/screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

LIVE_COCKPIT_JS = """
function applyLiveCockpitState(showWorkoutBar) {
    // Hide all floating prompts and alerts
    ['#audio-unmute-banner', '#hud-autopause-badge', '#workout-cue-toast', '.pm5-notice'].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.style.setProperty('display', 'none', 'important'));
    });

    // Populate realistic rowing telemetry
    const spm = document.getElementById('hud-spm');
    if (spm) spm.textContent = '24';
    const split = document.getElementById('hud-split');
    if (split) split.textContent = '1:56.4';
    const watts = document.getElementById('hud-watts');
    if (watts) watts.textContent = '228';
    const dist = document.getElementById('hud-distance');
    if (dist) dist.textContent = '1,280';
    const time = document.getElementById('hud-elapsed');
    if (time) time.textContent = '05:14';
    const hr = document.getElementById('hud-hr');
    if (hr) hr.textContent = '148';
    
    const hrPill = document.getElementById('hud-hr-zone-pill');
    if (hrPill) hrPill.textContent = 'Z4 86%';
    const hrBar = document.getElementById('hud-hr-zone-bar');
    if (hrBar) hrBar.style.width = '86%';

    // Activate connection badges with glowing pulse
    const rBtn = document.getElementById('status-rower');
    if (rBtn) {
        rBtn.className = 'status-pill status-btn connected telemetry-pulse';
        const rTxt = document.getElementById('status-rower-text');
        if (rTxt) rTxt.textContent = 'Rower: Connected';
    }
    const hBtn = document.getElementById('status-hr');
    if (hBtn) {
        hBtn.className = 'status-pill status-btn connected telemetry-pulse';
        const hTxt = document.getElementById('status-hr-text');
        if (hTxt) hTxt.textContent = 'HR: Polar H10';
    }

    // Workout bar
    const wb = document.getElementById('hud-workout-bar');
    if (wb) {
        wb.style.display = showWorkoutBar ? 'block' : 'none';
        if (showWorkoutBar) {
            const fill = document.getElementById('workout-progress-fill');
            if (fill) fill.style.width = '42%';
            const badge = document.getElementById('workout-step-badge');
            if (badge) { badge.textContent = 'WORK'; badge.className = 'workout-type-badge work'; }
            const title = document.getElementById('workout-step-title');
            if (title) title.textContent = 'Interval 2/5 • 500m Power';
            const summary = document.getElementById('workout-target-summary');
            if (summary) summary.textContent = 'Target: 26-30 SPM • Zone 4';
            const cd = document.getElementById('workout-step-countdown');
            if (cd) cd.textContent = '01:24 left';

            const tSpm = document.getElementById('hud-target-spm');
            if (tSpm) { tSpm.style.display = 'inline-flex'; tSpm.textContent = '● 28'; tSpm.className = 'pm5-target-chip target-on'; }
            const tWatts = document.getElementById('hud-target-watts');
            if (tWatts) { tWatts.style.display = 'inline-flex'; tWatts.textContent = '▲ 240W'; tWatts.className = 'pm5-target-chip target-low'; }
            const tSplit = document.getElementById('hud-target-split');
            if (tSplit) { tSplit.style.display = 'inline-flex'; tSplit.textContent = '● 1:52'; tSplit.className = 'pm5-target-chip target-on'; }
        } else {
            // Hide targets in free row
            ['#hud-target-spm', '#hud-target-watts', '#hud-target-split'].forEach(sel => {
                const el = document.querySelector(sel);
                if (el) el.style.display = 'none';
            });
        }
    }
}
"""

async def main():
    async with httpx.AsyncClient() as client:
        # Clean up any leftover localhost tabs
        try:
            tabs = (await client.get("http://127.0.0.1:9222/json/list")).json()
            for t in tabs:
                if "localhost:8000" in t.get("url", ""):
                    await client.get(f"http://127.0.0.1:9222/json/close/{t['id']}")
        except Exception as e:
            print("Cleanup error:", e)

        # Open ONE fresh tab
        resp = await client.put("http://127.0.0.1:9222/json/new?http://localhost:8000")
        target = resp.json()
        target_id = target["id"]
        ws_url = target["webSocketDebuggerUrl"]
        print(f"Opened single tab {target_id}", flush=True)

    try:
        async with websockets.connect(ws_url, max_size=50_000_000) as ws:
            msg_id = 1
            async def send(method, params=None):
                nonlocal msg_id
                m_id = msg_id
                msg_id += 1
                await ws.send(json.dumps({"id": m_id, "method": method, "params": params or {}}))
                while True:
                    raw = await ws.recv()
                    res = json.loads(raw)
                    if res.get("id") == m_id:
                        return res.get("result", {})

            await send("Page.enable")
            await send("Runtime.enable")
            print("CDP connected, loading scripts...", flush=True)
            await asyncio.sleep(2.5)

            async def capture_to(filename):
                ss = await send("Page.captureScreenshot", {"format": "png"})
                img_data = base64.b64decode(ss["data"])
                out_path = os.path.join(SCREENSHOT_DIR, filename)
                with open(out_path, "wb") as f:
                    f.write(img_data)
                print(f"[OK] Saved {filename} ({len(img_data)} bytes)", flush=True)

            # Inject helper
            await send("Runtime.evaluate", {"expression": LIVE_COCKPIT_JS})

            # ----------------------------------------------------
            # 1. Athlete Home Page (Landscape)
            # ----------------------------------------------------
            print("Capturing 1. home-quick-workouts.png...", flush=True)
            await send("Emulation.setDeviceMetricsOverride", {
                "width": 1440, "height": 900, "deviceScaleFactor": 2, "mobile": False
            })
            await send("Runtime.evaluate", {
                "expression": """
                    document.documentElement.removeAttribute('data-theme');
                    localStorage.setItem('ftms_hud_theme', 'default');
                    const homeBtn = document.querySelector('[data-view="home"]');
                    if (homeBtn) homeBtn.click();
                    window.scrollTo(0, 0);
                """
            })
            await asyncio.sleep(1.5)
            await capture_to("home-quick-workouts.png")

            # ----------------------------------------------------
            # 2. Mobile Portrait Home Page
            # ----------------------------------------------------
            print("Capturing 2. mobile-portrait-home.png...", flush=True)
            await send("Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True
            })
            await send("Runtime.evaluate", {
                "expression": "window.scrollTo(0, 0);"
            })
            await asyncio.sleep(1)
            await capture_to("mobile-portrait-home.png")

            # ----------------------------------------------------
            # 3. Mobile Portrait Cockpit HUD (2x3 Grid with Live Row)
            # ----------------------------------------------------
            print("Capturing 3. mobile-portrait-cockpit.png...", flush=True)
            await send("Runtime.evaluate", {
                "expression": """
                    const quickCard = document.querySelector(".btn-start-quick-card");
                    if (quickCard) quickCard.click();
                """
            })
            await asyncio.sleep(2.5)
            await send("Runtime.evaluate", {
                "expression": "applyLiveCockpitState(true);"
            })
            await asyncio.sleep(1)
            await capture_to("mobile-portrait-cockpit.png")

            # ----------------------------------------------------
            # 4. Cockpit HUD - Modern Slate (Landscape Hero)
            # ----------------------------------------------------
            print("Capturing 4. cockpit-modern-slate.png (Landscape Hero)...", flush=True)
            await send("Emulation.setDeviceMetricsOverride", {
                "width": 1440, "height": 900, "deviceScaleFactor": 2, "mobile": False
            })
            await send("Runtime.evaluate", {
                "expression": """
                    document.documentElement.removeAttribute('data-theme');
                    localStorage.setItem('ftms_hud_theme', 'default');
                    applyLiveCockpitState(false);
                """
            })
            await asyncio.sleep(1.5)
            await capture_to("cockpit-modern-slate.png")

            # ----------------------------------------------------
            # 5. Cockpit HUD - Structured Program Workout Bar
            # ----------------------------------------------------
            print("Capturing 5. cockpit-workout-bar.png...", flush=True)
            await send("Runtime.evaluate", {
                "expression": "applyLiveCockpitState(true);"
            })
            await asyncio.sleep(1.5)
            await capture_to("cockpit-workout-bar.png")

            # ----------------------------------------------------
            # 6. Themes Showcase in Cockpit
            # ----------------------------------------------------
            # (a) Nordic Minimalist
            print("Capturing 6a. cockpit-nordic-minimalist.png...", flush=True)
            await send("Runtime.evaluate", {
                "expression": """
                    document.documentElement.setAttribute('data-theme', 'nordic');
                    localStorage.setItem('ftms_hud_theme', 'nordic');
                    applyLiveCockpitState(true);
                """
            })
            await asyncio.sleep(1.5)
            await capture_to("cockpit-nordic-minimalist.png")

            # (b) Neon Cyberpunk
            print("Capturing 6b. cockpit-neon-cyberpunk.png...", flush=True)
            await send("Runtime.evaluate", {
                "expression": """
                    document.documentElement.setAttribute('data-theme', 'cyberpunk');
                    localStorage.setItem('ftms_hud_theme', 'cyberpunk');
                    applyLiveCockpitState(true);
                """
            })
            await asyncio.sleep(1.5)
            await capture_to("cockpit-neon-cyberpunk.png")

            # (c) Concept2 PM5 LCD
            print("Capturing 6c. cockpit-concept2-pm5.png...", flush=True)
            await send("Runtime.evaluate", {
                "expression": """
                    document.documentElement.setAttribute('data-theme', 'retro-pm5');
                    localStorage.setItem('ftms_hud_theme', 'retro-pm5');
                    applyLiveCockpitState(true);
                """
            })
            await asyncio.sleep(1.5)
            await capture_to("cockpit-concept2-pm5.png")

            # Reset theme to default slate & pause video before leaving cockpit
            await send("Runtime.evaluate", {
                "expression": """
                    document.documentElement.removeAttribute('data-theme');
                    localStorage.setItem('ftms_hud_theme', 'default');
                    const videoEl = document.getElementById("scenic-video");
                    if (videoEl) videoEl.pause();
                """
            })
            await asyncio.sleep(1)

            # ----------------------------------------------------
            # 7. Programs Library
            # ----------------------------------------------------
            print("Capturing 7. programs-library.png...", flush=True)
            await send("Runtime.evaluate", {
                "expression": """
                    const progBtn = document.querySelector('[data-view="workouts"]');
                    if (progBtn) progBtn.click();
                    window.scrollTo(0, 0);
                """
            })
            await asyncio.sleep(2)
            await capture_to("programs-library.png")

            # ----------------------------------------------------
            # 8. Media Center & Tracks
            # ----------------------------------------------------
            print("Capturing 8. media-center-tracks.png...", flush=True)
            await send("Runtime.evaluate", {
                "expression": """
                    const mediaBtn = document.querySelector('[data-view="media"]');
                    if (mediaBtn) mediaBtn.click();
                    window.scrollTo(0, 0);
                """
            })
            await asyncio.sleep(2)
            await capture_to("media-center-tracks.png")

            print("All captures completed successfully!", flush=True)

    finally:
        # Close tab immediately to free resources
        print("Closing tab and releasing resources...", flush=True)
        async with httpx.AsyncClient() as client:
            try:
                await client.get(f"http://127.0.0.1:9222/json/close/{target_id}")
                print(f"Tab {target_id} closed successfully.", flush=True)
            except Exception as e:
                print("Error closing tab:", e)

asyncio.run(main())
