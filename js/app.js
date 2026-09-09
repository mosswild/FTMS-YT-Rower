import { RowerBLE } from "./modules/ble-rower.js";
import { HeartRateBLE } from "./modules/ble-heartrate.js";
import { RateController } from "./modules/rate-controller.js";
import { AudioEngine } from "./modules/audio-engine.js";
import { PM5Hud } from "./modules/hud.js";
import { SessionTracker } from "./modules/session-tracker.js";
import { VirtualRowerSimulator } from "./modules/simulator.js";
import { MediaManager } from "./modules/media-manager.js";
import { TrackController } from "./modules/track-controller.js";

// DOM Elements
const videoEl = document.getElementById("scenic-video");
const audioEl = document.getElementById("soundtrack");
const viewportContainer = document.getElementById("viewport-container");
const audioToggleBtn = document.getElementById("btn-toggle-audio");
const audioLabel = document.getElementById("btn-audio-label");
const audioTrackSelect = document.getElementById("audio-track-select");
const audioVolumeSlider = document.getElementById("audio-volume-slider");
const audioUnmuteBanner = document.getElementById("audio-unmute-banner");

// Simulator DOM Elements
const simBtn = document.getElementById("btn-toggle-sim");
const simModeBtn = document.getElementById("btn-toggle-sim-mode");
const simPhaseBadge = document.getElementById("sim-phase-badge");
const simRowToggleBtn = document.getElementById("btn-sim-pause-rowing");
const simManualControls = document.getElementById("sim-manual-controls");
const simSpmRange = document.getElementById("sim-spm-range");
const simSpmVal = document.getElementById("sim-spm-val");

// Track Transport DOM Elements
const trackActiveBadge = document.getElementById("track-active-badge");
const btnTrackRestart = document.getElementById("btn-track-restart");
const btnTrackBack10 = document.getElementById("btn-track-back10");
const btnTrackFwd10 = document.getElementById("btn-track-fwd10");
const trackScrubber = document.getElementById("track-scrubber");
const trackTimeDisplay = document.getElementById("track-time-display");

// Initialize PM5 HUD
const pm5Hud = new PM5Hud(viewportContainer);

// Initialize Audio Engine with status callback
const audioEngine = new AudioEngine(videoEl, audioEl, {
  onStatusChange: (status) => {
    updateAudioUI(status);
  }
});

function updateAudioUI(status) {
  if (status.mode === "mute") {
    pm5Hud.setAudioMode("mute");
    if (audioToggleBtn) {
      audioToggleBtn.className = "btn btn-audio paused";
      audioLabel.textContent = "Muted";
    }
    if (audioUnmuteBanner) audioUnmuteBanner.style.display = "none";
    return;
  }

  pm5Hud.setAudioMode(status.mode, status.title);

  if (audioToggleBtn) {
    if (status.playing) {
      audioToggleBtn.className = "btn btn-audio";
      audioLabel.textContent = "Pause Audio";
    } else {
      audioToggleBtn.className = "btn btn-audio paused";
      audioLabel.textContent = "Play Audio";
    }
  }

  if (audioUnmuteBanner) {
    audioUnmuteBanner.style.display = status.blocked ? "flex" : "none";
  }
}

// Initialize Rate Controller
const rateController = new RateController(videoEl, {
  baselineSpm: 20,
  alpha: 0.25,
  autoPauseTimeoutMs: 3500,
  onRateChange: (rate) => {
    pm5Hud.updateSpeedMultiplier(rate, rateController ? rateController.isFixedSpeed : false);
  },
  onAutoPauseState: (isPaused) => {
    pm5Hud.setAutoPause(isPaused);
    audioEngine.handleAutoPause(isPaused);
    if (isPaused) {
      sessionTracker.pause();
    } else {
      sessionTracker.resume();
    }
  }
});

const mediaManager = new MediaManager();

// Initialize Scenic Track Controller
let isUserScrubbing = false;
const trackController = new TrackController(videoEl, {
  onProgress: (data) => {
    if (trackScrubber && !isUserScrubbing) {
      trackScrubber.value = data.progressPercent;
    }
    if (trackTimeDisplay) {
      trackTimeDisplay.textContent = `${pm5Hud.formatTime(data.trackElapsed)} / ${pm5Hud.formatTime(data.trackDuration)}`;
    }
  },
  onTrackChange: (track) => {
    if (trackActiveBadge) trackActiveBadge.textContent = track.name;
    pm5Hud.setVideoTitle(track.name);
  }
});

// Initialize Session Tracker
const sessionTracker = new SessionTracker({
  onTick: (summary) => {},
  onStateChange: (state) => {
    const workoutBtn = document.getElementById("btn-toggle-workout");
    if (workoutBtn) {
      if (state === "active" || state === "paused") {
        workoutBtn.textContent = "Finish Workout";
        workoutBtn.className = "btn btn-danger";
        pm5Hud.setActiveSession(true);
        rateController.setWorkoutLive(true);
        if (state === "active" && videoEl && videoEl.paused && (rateController.isFixedSpeed || rateController.smoothedRate > 0)) {
          rateController.resumeVideo();
          audioEngine.play();
        }
      } else {
        workoutBtn.textContent = "Start Workout";
        workoutBtn.className = "btn btn-success";
        pm5Hud.setActiveSession(false);
        rateController.setWorkoutLive(false);
        if (videoEl) videoEl.pause();
        audioEngine.pause();
      }
    }
  }
});

// Telemetry Dispatcher (handles both BLE Rower and Simulator)
function handleTelemetryPacket(data) {
  pm5Hud.updateMetrics(data);
  if (data.strokeRate !== undefined) {
    rateController.updateCadence(data.strokeRate);
  }
  sessionTracker.updateTelemetry(data);

  // Auto-sync: ensure soundtrack plays if video is actively playing and audio is not muted
  if (videoEl && !videoEl.paused && !audioEngine.isPlaying && audioEngine.mode !== "mute") {
    audioEngine.play();
  }
}

// Virtual Rower Simulator with Dynamic Program
const simulator = new VirtualRowerSimulator((data) => {
  handleTelemetryPacket(data);
}, {
  onPhaseChange: (phaseName, targetSpm) => {
    if (simPhaseBadge) {
      simPhaseBadge.textContent = `Phase: ${phaseName} (${targetSpm} SPM)`;
      if (targetSpm === 0 || phaseName.includes("Pause") || phaseName.includes("Rest")) {
        simPhaseBadge.className = "sim-phase-badge rest";
      } else if (targetSpm >= 30) {
        simPhaseBadge.className = "sim-phase-badge sprint";
      } else {
        simPhaseBadge.className = "sim-phase-badge";
      }
    }
  }
});

// Bluetooth Instances
const rowerBle = new RowerBLE(
  (data) => handleTelemetryPacket(data),
  () => {
    updateRowerStatus(false, "Disconnected");
  }
);

const hrBle = new HeartRateBLE(
  (bpm) => {
    handleTelemetryPacket({ heartRate: bpm });
  },
  () => {
    updateHrStatus(false, "Disconnected");
  }
);

// UI Status Helpers
function updateRowerStatus(connected, text) {
  const pill = document.getElementById("status-rower");
  if (pill) {
    pill.className = connected ? "status-pill connected" : "status-pill";
    pill.querySelector(".status-text").textContent = text || (connected ? "Rower Connected" : "Rower Disconnected");
  }
}

function updateHrStatus(connected, text) {
  const pill = document.getElementById("status-hr");
  if (pill) {
    pill.className = connected ? "status-pill connected" : "status-pill";
    pill.querySelector(".status-text").textContent = text || (connected ? "HR Connected" : "HR Disconnected");
  }
}

// ----------------- View Navigation -----------------
const views = {
  cockpit: document.getElementById("view-cockpit"),
  media: document.getElementById("view-media"),
  history: document.getElementById("view-history"),
};

function switchView(viewName) {
  Object.keys(views).forEach(key => {
    if (views[key]) {
      views[key].style.display = (key === viewName) ? "block" : "none";
    }
  });

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });

  if (viewName === "media") {
    loadLibraryUI();
    loadTracksUI();
  } else if (viewName === "history") {
    loadHistoryUI();
  }
}

document.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ----------------- Confirmation Modal Helper -----------------
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showConfirmDialog({ title = "Confirm Deletion", message = "Are you sure you want to delete this item?", confirmBtnText = "Delete", isDanger = true }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("modal-confirm-delete");
    const titleEl = document.getElementById("modal-confirm-title");
    const msgEl = document.getElementById("modal-confirm-message");
    const btnAction = document.getElementById("btn-action-confirm-delete");
    const btnCancel = document.getElementById("btn-cancel-confirm-delete");
    const btnClose = document.getElementById("btn-close-confirm-delete");

    if (!modal || !btnAction || !btnCancel) {
      resolve(true);
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.innerHTML = message;
    if (btnAction) {
      btnAction.textContent = confirmBtnText;
      btnAction.className = isDanger ? "btn btn-danger" : "btn btn-primary";
    }

    modal.classList.add("open");

    const cleanup = () => {
      modal.classList.remove("open");
      btnAction.removeEventListener("click", onConfirm);
      btnCancel.removeEventListener("click", onCancel);
      if (btnClose) btnClose.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeyDown);
    };

    const onConfirm = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      cleanup();
      resolve(true);
    };

    const onCancel = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      cleanup();
      resolve(false);
    };

    const onOverlayClick = (e) => {
      if (e.target === modal) onCancel(e);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        onCancel(e);
      } else if (e.key === "Enter") {
        onConfirm(e);
      }
    };

    btnAction.addEventListener("click", onConfirm);
    btnCancel.addEventListener("click", onCancel);
    if (btnClose) btnClose.addEventListener("click", onCancel);
    modal.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeyDown);
  });
}

// ----------------- Media Loading & Library -----------------
let cachedLibrary = { videos: [], audio: [] };
let cachedTracks = [];

async function loadLibraryUI() {
  cachedLibrary = await mediaManager.fetchLibrary();
  const videosContainer = document.getElementById("library-videos");
  const audioContainer = document.getElementById("library-audio");

  updateAudioTrackDropdown();

  if (videosContainer) {
    if (!cachedLibrary.videos || cachedLibrary.videos.length === 0) {
      videosContainer.innerHTML = `<div style="grid-column: 1/-1; color: var(--text-dim); text-align: center; padding: 2rem;">No scenic videos downloaded yet. Submit a YouTube link above!</div>`;
    } else {
      videosContainer.innerHTML = cachedLibrary.videos.map(v => {
        const isTrimmed = (v.start_time > 0) || (v.end_time > 0 && v.end_time < (v.duration || 999999));
        const trimBadge = isTrimmed
          ? ` • <span style="color: var(--accent-emerald); font-weight: 600;">Trim: ${pm5Hud.formatTime(v.start_time)} → ${v.end_time > 0 ? pm5Hud.formatTime(v.end_time) : 'End'}</span>`
          : "";

        return `
        <div class="media-card">
          <div class="media-thumb-box" data-id="${v.id}" title="Click to preview & trim video">
            <img src="/api/media/thumbnail/${v.id}" alt="${v.title}" class="media-thumb" onerror="this.src='/api/placeholder/320/180'">
            <div class="media-thumb-play-overlay">
              <div class="media-thumb-play-btn">▶</div>
            </div>
          </div>
          <div class="media-card-body">
            <div>
              <div class="media-title" title="${v.title}">${v.title}</div>
              <div class="media-meta-line">${v.duration ? `${Math.floor(v.duration / 60)}m ${v.duration % 60}s` : ""} • ${(v.size_bytes / (1024*1024)).toFixed(1)} MB${trimBadge}</div>
            </div>
            <div class="media-actions">
              <button class="btn btn-primary btn-sm btn-action-main btn-create-track-from-video" data-id="${v.id}" data-title="${v.title.replace(/"/g, '&quot;')}" data-duration="${v.duration || 0}">+ Create Track</button>
              <div class="media-actions-row">
                <button class="btn btn-secondary btn-sm btn-trim-media" data-type="video" data-id="${v.id}">✂ Preview & Trim</button>
                <button class="btn btn-secondary btn-sm btn-rename-media" data-type="video" data-id="${v.id}" data-title="${v.title.replace(/"/g, '&quot;')}">Rename</button>
                <button class="btn btn-secondary btn-sm btn-delete-media btn-danger-hover" data-type="video" data-id="${v.id}" title="Delete Video">Delete</button>
              </div>
            </div>
          </div>
        </div>
      `;
      }).join("");

      videosContainer.querySelectorAll(".media-thumb-box").forEach(box => {
        box.addEventListener("click", () => {
          openTrimMediaModal("video", box.dataset.id);
        });
      });

      videosContainer.querySelectorAll(".btn-create-track-from-video").forEach(btn => {
        btn.addEventListener("click", () => {
          openCreateTrackFromVideo(btn.dataset.id, btn.dataset.title);
        });
      });

      videosContainer.querySelectorAll(".btn-trim-media").forEach(btn => {
        btn.addEventListener("click", () => {
          openTrimMediaModal("video", btn.dataset.id);
        });
      });

      videosContainer.querySelectorAll(".btn-rename-media").forEach(btn => {
        btn.addEventListener("click", () => {
          openRenameMediaModal("video", btn.dataset.id, btn.dataset.title);
        });
      });

      videosContainer.querySelectorAll(".btn-delete-media").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.dataset.id;
          const video = cachedLibrary.videos ? cachedLibrary.videos.find(v => v.id === id) : null;
          const title = video ? video.title : "this video";

          const confirmed = await showConfirmDialog({
            title: "Delete Scenic Video",
            message: `Are you sure you want to delete <strong>${escapeHtml(title)}</strong>?`,
            confirmBtnText: "Delete Video",
            isDanger: true
          });

          if (confirmed) {
            btn.disabled = true;
            await mediaManager.deleteMedia("video", id);
            showHudToast(`Deleted video: ${title}`);
            await loadLibraryUI();
            await loadTracksUI();
          }
        });
      });
    }
  }

  if (audioContainer) {
    if (!cachedLibrary.audio || cachedLibrary.audio.length === 0) {
      audioContainer.innerHTML = `<div style="grid-column: 1/-1; color: var(--text-dim); text-align: center; padding: 2rem;">No custom soundtracks downloaded yet.</div>`;
    } else {
      audioContainer.innerHTML = cachedLibrary.audio.map(a => {
        const isTrimmed = (a.start_time > 0) || (a.end_time > 0 && a.end_time < (a.duration || 999999));
        const trimBadge = isTrimmed
          ? ` • <span style="color: var(--accent-emerald); font-weight: 600;">Trim: ${pm5Hud.formatTime(a.start_time)} → ${a.end_time > 0 ? pm5Hud.formatTime(a.end_time) : 'End'}</span>`
          : "";

        return `
        <div class="media-card">
          <div class="media-thumb-box media-audio-box" data-id="${a.id}" style="height: 52px; aspect-ratio: unset; background: linear-gradient(135deg, rgba(168,85,247,0.15), rgba(59,130,246,0.12)); display: flex; align-items: center; justify-content: center; cursor: pointer; border-bottom: 1px solid var(--surface-border);" title="Click to preview & trim soundtrack">
            <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--accent-purple, #a855f7); pointer-events: none;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
              <span style="font-size: 0.8rem; font-weight: 600;">Soundtrack Audio</span>
            </div>
            <div class="media-thumb-play-overlay">
              <div class="media-thumb-play-btn" style="background: var(--accent-purple, #9333ea); width: 34px; height: 34px; font-size: 0.85rem;">▶</div>
            </div>
          </div>
          <div class="media-card-body">
            <div>
              <div class="media-title" title="${a.title}">${a.title}</div>
              <div class="media-meta-line">${a.duration ? `${Math.floor(a.duration / 60)}m ${a.duration % 60}s` : ""} • ${(a.size_bytes / (1024*1024)).toFixed(1)} MB${trimBadge}</div>
            </div>
            <div class="media-actions">
              <button class="btn btn-primary btn-sm btn-add-audio-to-track" data-id="${a.id}" data-title="${a.title.replace(/"/g, '&quot;')}">+ Add to Track</button>
              <div class="media-actions-row">
                <button class="btn btn-secondary btn-sm btn-trim-media" data-type="audio" data-id="${a.id}">✂ Preview & Trim</button>
                <button class="btn btn-secondary btn-sm btn-rename-media" data-type="audio" data-id="${a.id}" data-title="${a.title.replace(/"/g, '&quot;')}">Rename</button>
                <button class="btn btn-secondary btn-sm btn-delete-media btn-danger-hover" data-type="audio" data-id="${a.id}" title="Delete Audio">Delete</button>
              </div>
            </div>
          </div>
        </div>
      `;
      }).join("");

      audioContainer.querySelectorAll(".media-audio-box").forEach(box => {
        box.addEventListener("click", () => {
          openTrimMediaModal("audio", box.dataset.id);
        });
      });

      audioContainer.querySelectorAll(".btn-add-audio-to-track").forEach(btn => {
        btn.addEventListener("click", () => {
          openAddAudioToTrackModal(btn.dataset.id, btn.dataset.title);
        });
      });

      audioContainer.querySelectorAll(".btn-trim-media").forEach(btn => {
        btn.addEventListener("click", () => {
          openTrimMediaModal("audio", btn.dataset.id);
        });
      });

      audioContainer.querySelectorAll(".btn-rename-media").forEach(btn => {
        btn.addEventListener("click", () => {
          openRenameMediaModal("audio", btn.dataset.id, btn.dataset.title);
        });
      });

      audioContainer.querySelectorAll(".btn-delete-media").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.dataset.id;
          const audio = cachedLibrary.audio ? cachedLibrary.audio.find(a => a.id === id) : null;
          const title = audio ? audio.title : "this soundtrack";

          const confirmed = await showConfirmDialog({
            title: "Delete Soundtrack",
            message: `Are you sure you want to delete <strong>${escapeHtml(title)}</strong>?`,
            confirmBtnText: "Delete Soundtrack",
            isDanger: true
          });

          if (confirmed) {
            btn.disabled = true;
            await mediaManager.deleteMedia("audio", id);
            showHudToast(`Deleted soundtrack: ${title}`);
            await loadLibraryUI();
            await loadTracksUI();
          }
        });
      });
    }
  }
}

function updateAudioTrackDropdown(selectedVal = null, allowedAudioIds = null) {
  if (!audioTrackSelect) return;
  const currentVal = selectedVal || audioTrackSelect.value || "original";

  // Determine allowed audio list
  let allowedList = null;
  if (Array.isArray(allowedAudioIds)) {
    allowedList = [...allowedAudioIds];
  } else if (trackController && trackController.activeTrack && trackController.activeTrack.id) {
    allowedList = [...(trackController.activeTrack.allowedAudios || [])];
    if (trackController.activeTrack.defaultAudio && 
        trackController.activeTrack.defaultAudio !== "original" && 
        trackController.activeTrack.defaultAudio !== "mute" &&
        !allowedList.includes(trackController.activeTrack.defaultAudio)) {
      allowedList.push(trackController.activeTrack.defaultAudio);
    }
  }

  let optionsHtml = `
    <option value="original">Original Video Audio (1.0×)</option>
  `;

  if (cachedLibrary.audio && cachedLibrary.audio.length > 0) {
    cachedLibrary.audio.forEach(a => {
      // When an allowedList is active (even if empty array []), only include if in allowedList!
      if (allowedList !== null && !allowedList.includes(a.id)) {
        return;
      }
      const val = `/api/media/audio/${a.id}`;
      optionsHtml += `<option value="${val}">${a.title.slice(0, 24)} (1.0×)</option>`;
    });
  }

  optionsHtml += `<option value="mute">Mute</option>`;
  audioTrackSelect.innerHTML = optionsHtml;

  if ([...audioTrackSelect.options].some(o => o.value === currentVal)) {
    audioTrackSelect.value = currentVal;
  } else {
    audioTrackSelect.value = audioTrackSelect.options[0].value;
  }
}

let currentCockpitVideoId = null;

function loadVideoIntoCockpit(videoId, title, autoPlay = false, isTrack = false) {
  currentCockpitVideoId = videoId;
  videoEl.src = `/api/media/video/${videoId}`;
  videoEl.load();
  pm5Hud.setVideoTitle(title);
  audioEngine.setScenicVideo(videoId, title);
  sessionTracker.setMeta(videoId, audioEngine.mode);
  if (!isTrack) {
    trackController.clearTrack();
    rateController.setFixedSpeed(false);
    updateAudioTrackDropdown("original", null);
  }

  if (autoPlay) {
    videoEl.play().catch(e => console.warn(e));
    audioEngine.play();
  }
}

// ----------------- Scenic Tracks Management -----------------
async function loadTracksUI() {
  try {
    const res = await fetch("/api/tracks");
    const data = await res.json();
    cachedTracks = data.tracks || [];

    const tracksContainer = document.getElementById("library-tracks");
    if (!tracksContainer) return;

    if (cachedTracks.length === 0) {
      tracksContainer.innerHTML = `<div style="grid-column: 1/-1; color: var(--text-dim); text-align: center; padding: 2rem;">No custom tracks configured yet. Click "+ Create New Track" to trim start/end positions and set default audio!</div>`;
    } else {
      tracksContainer.innerHTML = cachedTracks.map(t => {
        const startStr = pm5Hud.formatTime(t.start_time);
        const endStr = t.end_time > 0 ? pm5Hud.formatTime(t.end_time) : "End";
        const durationStr = t.end_time > t.start_time ? `(${pm5Hud.formatTime(t.end_time - t.start_time)})` : "";
        const defaultAudioLabel = t.default_audio === "original" ? "Original Audio" : (t.default_audio === "mute" ? "Muted" : "Custom Soundtrack");
        const speedBadge = t.fixed_speed
          ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: var(--accent-emerald); border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.72rem; padding: 2px 7px; border-radius: 4px; font-weight: 600;">Fixed 1.0× Ambient</span>`
          : `<span class="badge" style="background: rgba(59, 130, 246, 0.12); color: var(--accent-blue); border: 1px solid rgba(59, 130, 246, 0.25); font-size: 0.72rem; padding: 2px 7px; border-radius: 4px; font-weight: 500;">Cadence Synced</span>`;

        return `
          <div class="track-card">
            <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
              <img src="/api/media/thumbnail/${t.video_id}" alt="${t.name}" style="width: 100px; height: 56px; object-fit: cover; border-radius: 6px; background: #000; flex-shrink: 0; border: 1px solid var(--surface-border);">
              <div style="flex: 1; min-width: 0;">
                <div class="track-card-title" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
                  <span>${t.name}</span>
                  ${speedBadge}
                </div>
                <div class="track-card-meta">
                  <span><strong>Segment:</strong> ${startStr} → ${endStr} ${durationStr}</span>
                  <span><strong>Default Audio:</strong> ${defaultAudioLabel}</span>
                  ${t.allowed_audios && t.allowed_audios.length ? `<span><strong>Alt Soundtracks:</strong> ${t.allowed_audios.length} options</span>` : ""}
                </div>
              </div>
            </div>
            <div class="media-actions" style="margin-top: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <button class="btn btn-primary btn-sm btn-row-track" data-id="${t.id}">Row This Track</button>
              <button class="btn btn-secondary btn-sm btn-edit-track" data-id="${t.id}">Edit</button>
              <button class="btn btn-secondary btn-sm btn-delete-track" data-id="${t.id}">Delete</button>
            </div>
          </div>
        `;
      }).join("");

      tracksContainer.querySelectorAll(".btn-row-track").forEach(btn => {
        btn.addEventListener("click", () => {
          const track = cachedTracks.find(t => t.id === btn.dataset.id);
          if (track) {
            loadTrackIntoCockpit(track, false);
            switchView("cockpit");
          }
        });
      });

      tracksContainer.querySelectorAll(".btn-edit-track").forEach(btn => {
        btn.addEventListener("click", () => {
          const track = cachedTracks.find(t => t.id === btn.dataset.id);
          if (track) {
            openEditTrackModal(track);
          }
        });
      });

      tracksContainer.querySelectorAll(".btn-delete-track").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.dataset.id;
          const track = cachedTracks ? cachedTracks.find(t => t.id === id) : null;
          const title = track ? track.name : "this track";

          const confirmed = await showConfirmDialog({
            title: "Delete Scenic Track",
            message: `Are you sure you want to delete track <strong>${escapeHtml(title)}</strong>?`,
            confirmBtnText: "Delete Track",
            isDanger: true
          });

          if (confirmed) {
            btn.disabled = true;
            await fetch(`/api/tracks/${id}`, { method: "DELETE" });
            showHudToast(`Deleted track: ${title}`);
            await loadTracksUI();
          }
        });
      });
    }
  } catch (err) {
    console.error("[Tracks] Error loading tracks:", err);
  }
}

function loadTrackIntoCockpit(track, autoPlay = false) {
  loadVideoIntoCockpit(track.video_id, track.name, false, true);
  trackController.loadTrack(track);
  rateController.setFixedSpeed(!!track.fixed_speed);

  // Set audio based on track default
  if (track.default_audio === "original") {
    const videoObj = cachedLibrary.videos ? cachedLibrary.videos.find(v => v.id === track.video_id) : null;
    const vStart = track.start_time !== undefined ? track.start_time : (videoObj ? videoObj.start_time : 0);
    const vEnd = track.end_time !== undefined ? track.end_time : (videoObj ? videoObj.end_time : 0);
    audioEngine.setScenicVideo(track.video_id, track.name, vStart, vEnd);
    audioEngine.setMode("original");
    updateAudioTrackDropdown("original", track.allowed_audios);
  } else if (track.default_audio === "mute") {
    audioEngine.setMode("mute");
    updateAudioTrackDropdown("mute", track.allowed_audios);
  } else {
    const audioUrl = `/api/media/audio/${track.default_audio}`;
    const audioObj = cachedLibrary.audio ? cachedLibrary.audio.find(a => a.id === track.default_audio) : null;
    const startT = audioObj ? (audioObj.start_time || 0) : 0;
    const endT = audioObj ? (audioObj.end_time || 0) : 0;
    audioEngine.setCustomAudio(audioUrl, audioObj ? audioObj.title : "Track Soundtrack", startT, endT);
    updateAudioTrackDropdown(audioUrl, track.allowed_audios);
  }

  const isWorkoutLive = (sessionTracker.state === "active" || sessionTracker.state === "paused") || (simulator && simulator.isRunning);
  rateController.setWorkoutLive(isWorkoutLive);

  if (track.fixed_speed) {
    // Ambient video mode: plays steadily at 1.0x without pausing when rower pauses, but ONLY when workout is live
    pm5Hud.updateSpeedMultiplier(1.0, true);
    if (isWorkoutLive || autoPlay) {
      rateController.setWorkoutLive(true);
      rateController.resumeVideo();
      pm5Hud.setAutoPause(false);
      audioEngine.play();
    } else {
      rateController.pauseVideo(true);
      pm5Hud.setAutoPause(true);
      audioEngine.pause();
    }
  } else {
    // Cadence dynamic mode: start paused waiting for strokes
    rateController.pauseVideo(true);
    rateController.smoothedRate = rateController.minRate;
    pm5Hud.updateSpeedMultiplier(0, false);
    pm5Hud.setAutoPause(true);
    audioEngine.pause();

    if (isWorkoutLive && autoPlay) {
      rateController.resumeVideo();
      audioEngine.play();
    }
  }
}

// Track Transport Controls in Cockpit
if (btnTrackRestart) {
  btnTrackRestart.addEventListener("click", () => {
    trackController.restart();
    audioEngine.restart();
  });
}

if (btnTrackBack10) {
  btnTrackBack10.addEventListener("click", () => {
    trackController.seekRelative(-10);
  });
}

if (btnTrackFwd10) {
  btnTrackFwd10.addEventListener("click", () => {
    trackController.seekRelative(10);
  });
}

if (trackScrubber) {
  trackScrubber.addEventListener("mousedown", () => { isUserScrubbing = true; });
  trackScrubber.addEventListener("touchstart", () => { isUserScrubbing = true; });
  trackScrubber.addEventListener("input", () => {
    isUserScrubbing = true;
  });
  trackScrubber.addEventListener("change", () => {
    trackController.seekFraction(parseFloat(trackScrubber.value) / 100);
    isUserScrubbing = false;
  });
}

// Track Creation Modal Form
const modalCreateTrack = document.getElementById("modal-create-track");
const btnOpenCreateTrack = document.getElementById("btn-open-create-track");
const btnCloseCreateTrack = document.getElementById("btn-close-create-track");
const btnCancelCreateTrack = document.getElementById("btn-cancel-create-track");
const formCreateTrack = document.getElementById("form-create-track");
const selectTrackVideo = document.getElementById("select-track-video");
const selectTrackDefaultAudio = document.getElementById("select-track-default-audio");
const containerTrackAllowedAudios = document.getElementById("container-track-allowed-audios");

function parseTimeSeconds(val) {
  if (!val) return 0;
  const s = String(val).trim();
  if (s.includes(":")) {
    const parts = s.split(":").map(Number);
    if (parts.length === 2) return (parts[0] * 60) + (parts[1] || 0);
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + (parts[2] || 0);
  }
  const num = parseFloat(s);
  return isNaN(num) ? 0 : Math.max(0, num);
}

function populateTrackModalDropdowns() {
  if (selectTrackVideo) {
    selectTrackVideo.innerHTML = (cachedLibrary.videos || []).map(v => {
      const isTrimmed = (v.start_time > 0) || (v.end_time > 0 && v.end_time < (v.duration || 999999));
      const trimTag = isTrimmed ? ` [Trimmed: ${pm5Hud.formatTime(v.start_time)} → ${pm5Hud.formatTime(v.end_time || v.duration)}]` : "";
      return `<option value="${v.id}">${v.title}${trimTag}</option>`;
    }).join("");
  }

  if (selectTrackDefaultAudio) {
    let opts = `
      <option value="original">Original Video Audio</option>
      <option value="mute">Muted</option>
    `;
    (cachedLibrary.audio || []).forEach(a => {
      const isTrimmed = (a.start_time > 0) || (a.end_time > 0 && a.end_time < (a.duration || 999999));
      const trimTag = isTrimmed ? ` [Trim: ${pm5Hud.formatTime(a.start_time)} → ${a.end_time > 0 ? pm5Hud.formatTime(a.end_time) : 'End'}]` : "";
      opts += `<option value="${a.id}">${a.title}${trimTag}</option>`;
    });
    selectTrackDefaultAudio.innerHTML = opts;
  }

  if (containerTrackAllowedAudios) {
    if (!cachedLibrary.audio || cachedLibrary.audio.length === 0) {
      containerTrackAllowedAudios.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-dim);">No standalone soundtracks downloaded yet.</span>`;
    } else {
      containerTrackAllowedAudios.innerHTML = cachedLibrary.audio.map(a => {
        const isTrimmed = (a.start_time > 0) || (a.end_time > 0 && a.end_time < (a.duration || 999999));
        const trimTag = isTrimmed ? ` <span style="color: var(--accent-emerald); font-size: 0.74rem;">[${pm5Hud.formatTime(a.start_time)} → ${a.end_time > 0 ? pm5Hud.formatTime(a.end_time) : 'End'}]</span>` : "";
        return `
        <label style="display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem; color: var(--text-main); cursor: pointer; padding: 0.25rem 0.4rem; border-radius: 4px; background: rgba(255,255,255,0.03);">
          <span style="display: flex; align-items: center; gap: 0.5rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <input type="checkbox" name="allowed_audio" value="${a.id}" checked style="accent-color: var(--accent-blue);">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${a.title}${trimTag}</span>
          </span>
          <button type="button" class="btn btn-secondary btn-sm btn-sample-audio" data-id="${a.id}" style="padding: 0.15rem 0.5rem; font-size: 0.72rem; line-height: 1.2; flex-shrink: 0; margin-left: 0.5rem;">▶ Sample</button>
        </label>
      `;
      }).join("");

      containerTrackAllowedAudios.querySelectorAll(".btn-sample-audio").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (selectTrackDefaultAudio) {
            selectTrackDefaultAudio.value = btn.dataset.id;
          }
          updateModalAudioSource(true);
        });
      });
    }
  }
}

// ----------------- Modal Audio Preview Player -----------------
const modalPreviewAudio = document.getElementById("modal-preview-audio");
const btnModalAudioPlay = document.getElementById("btn-modal-audio-play");
const modalAudioPlayIcon = document.getElementById("modal-audio-play-icon");
const modalAudioPlayText = document.getElementById("modal-audio-play-text");
const modalAudioScrubber = document.getElementById("modal-audio-scrubber");
const modalAudioTime = document.getElementById("modal-audio-time");
const modalAudioPreviewBar = document.getElementById("modal-audio-preview-bar");
let isModalAudioScrubbing = false;

let modalAudioTrimStart = 0;
let modalAudioTrimEnd = 0;

function getAudioTrimBounds(audioVal, videoId) {
  if (!audioVal || audioVal === "mute") return { start: 0, end: 0 };
  if (audioVal === "original") {
    const v = (cachedLibrary.videos || []).find(item => item.id === videoId);
    return { start: v ? (v.start_time || 0) : 0, end: v ? (v.end_time || 0) : 0 };
  }
  const a = (cachedLibrary.audio || []).find(item => item.id === audioVal);
  return { start: a ? (a.start_time || 0) : 0, end: a ? (a.end_time || 0) : 0 };
}

function setModalAudioPlayState(isPlaying) {
  if (modalAudioPlayIcon) modalAudioPlayIcon.textContent = isPlaying ? "⏸" : "▶";
  if (modalAudioPlayText) modalAudioPlayText.textContent = isPlaying ? "Pause" : "Preview";
  if (btnModalAudioPlay) {
    btnModalAudioPlay.className = isPlaying ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm";
  }
}

function stopModalAudio() {
  if (modalPreviewAudio) {
    modalPreviewAudio.pause();
    modalPreviewAudio.currentTime = modalAudioTrimStart || 0;
  }
  setModalAudioPlayState(false);
  if (modalAudioScrubber) modalAudioScrubber.value = 0;
  if (modalAudioTime) modalAudioTime.textContent = "0:00 / 0:00";
}

function getAudioUrlForSelection(audioVal, videoId) {
  if (!audioVal || audioVal === "mute") return null;
  if (audioVal === "original") {
    return videoId ? `/api/media/audio/${videoId}` : null;
  }
  return `/api/media/audio/${audioVal}`;
}

function updateModalAudioSource(autoPlay = false) {
  if (!modalPreviewAudio || !selectTrackDefaultAudio) return;
  const audioVal = selectTrackDefaultAudio.value;
  const videoId = selectTrackVideo ? selectTrackVideo.value : null;
  const url = getAudioUrlForSelection(audioVal, videoId);
  const bounds = getAudioTrimBounds(audioVal, videoId);
  modalAudioTrimStart = bounds.start;
  modalAudioTrimEnd = bounds.end;

  if (!url) {
    if (modalAudioPreviewBar) {
      modalAudioPreviewBar.style.opacity = "0.45";
      modalAudioPreviewBar.style.pointerEvents = "none";
    }
    stopModalAudio();
    return;
  }

  if (modalAudioPreviewBar) {
    modalAudioPreviewBar.style.opacity = "1";
    modalAudioPreviewBar.style.pointerEvents = "auto";
  }

  const currentSrc = modalPreviewAudio.getAttribute("src");
  const isNewSrc = (currentSrc !== url);
  if (isNewSrc) {
    modalPreviewAudio.src = url;
    modalPreviewAudio.load();
    if (modalAudioScrubber) modalAudioScrubber.value = 0;
    if (modalAudioTime) modalAudioTime.textContent = "0:00 / 0:00";
  }

  const seekToTrimStart = () => {
    if (modalAudioTrimStart > 0) {
      try {
        modalPreviewAudio.currentTime = modalAudioTrimStart;
      } catch (err) {
        // ignore if not ready
      }
    }
  };

  if (isNewSrc) {
    modalPreviewAudio.addEventListener("loadedmetadata", seekToTrimStart, { once: true });
  } else {
    seekToTrimStart();
  }

  if (autoPlay) {
    modalPreviewAudio.play()
      .then(() => {
        setModalAudioPlayState(true);
        seekToTrimStart();
      })
      .catch(e => {
        console.warn("[ModalAudio] Preview autoplay error:", e);
        setModalAudioPlayState(false);
      });
  }
}

if (btnModalAudioPlay) {
  btnModalAudioPlay.addEventListener("click", () => {
    if (!modalPreviewAudio) return;
    if (modalPreviewAudio.paused) {
      const audioVal = selectTrackDefaultAudio ? selectTrackDefaultAudio.value : null;
      const videoId = selectTrackVideo ? selectTrackVideo.value : null;
      const url = getAudioUrlForSelection(audioVal, videoId);
      if (!url) return;
      if (!modalPreviewAudio.src || !modalPreviewAudio.src.includes(url)) {
        updateModalAudioSource(true);
      } else {
        const cur = modalPreviewAudio.currentTime;
        const start = modalAudioTrimStart || 0;
        const rawEnd = modalAudioTrimEnd || 0;
        const dur = modalPreviewAudio.duration || 0;
        const end = (rawEnd > 0 && rawEnd <= dur) ? rawEnd : dur;
        if (cur < start || (end > start && cur >= end)) {
          modalPreviewAudio.currentTime = start;
        }
        modalPreviewAudio.play()
          .then(() => setModalAudioPlayState(true))
          .catch(e => console.warn(e));
      }
    } else {
      modalPreviewAudio.pause();
      setModalAudioPlayState(false);
    }
  });
}

if (modalPreviewAudio) {
  modalPreviewAudio.addEventListener("timeupdate", () => {
    const cur = modalPreviewAudio.currentTime;
    const start = modalAudioTrimStart || 0;
    const rawEnd = modalAudioTrimEnd || 0;
    const dur = modalPreviewAudio.duration || 0;
    const end = (rawEnd > 0 && rawEnd <= dur) ? rawEnd : dur;

    // Enforce trim end boundary: loop back to trim start!
    if (end > start && cur >= end) {
      modalPreviewAudio.currentTime = start;
      return;
    }
    if (cur < start && start > 0) {
      modalPreviewAudio.currentTime = start;
      return;
    }

    const segLength = Math.max(0.1, end - start);
    if (!isModalAudioScrubbing && modalAudioScrubber) {
      const frac = Math.max(0, Math.min(1, (cur - start) / segLength));
      modalAudioScrubber.value = frac * 100;
    }
    if (modalAudioTime) {
      const currentPos = Math.max(0, cur - start);
      modalAudioTime.textContent = `${pm5Hud.formatTime(currentPos)} / ${pm5Hud.formatTime(segLength)}`;
    }
  });

  modalPreviewAudio.addEventListener("ended", () => {
    modalPreviewAudio.currentTime = modalAudioTrimStart || 0;
    setModalAudioPlayState(false);
  });
}

if (modalAudioScrubber) {
  modalAudioScrubber.addEventListener("mousedown", () => { isModalAudioScrubbing = true; });
  modalAudioScrubber.addEventListener("touchstart", () => { isModalAudioScrubbing = true; });
  modalAudioScrubber.addEventListener("input", (e) => {
    isModalAudioScrubbing = true;
    const start = modalAudioTrimStart || 0;
    const rawEnd = modalAudioTrimEnd || 0;
    const dur = modalPreviewAudio ? modalPreviewAudio.duration : 0;
    const end = (rawEnd > 0 && rawEnd <= dur) ? rawEnd : dur;
    const segLength = Math.max(0.1, end - start);
    const targetOffset = (parseFloat(e.target.value) / 100) * segLength;
    if (modalAudioTime) {
      modalAudioTime.textContent = `${pm5Hud.formatTime(targetOffset)} / ${pm5Hud.formatTime(segLength)}`;
    }
  });
  modalAudioScrubber.addEventListener("change", (e) => {
    const start = modalAudioTrimStart || 0;
    const rawEnd = modalAudioTrimEnd || 0;
    const dur = modalPreviewAudio ? modalPreviewAudio.duration : 0;
    const end = (rawEnd > 0 && rawEnd <= dur) ? rawEnd : dur;
    const segLength = Math.max(0.1, end - start);
    if (modalPreviewAudio) {
      modalPreviewAudio.currentTime = start + (parseFloat(e.target.value) / 100) * segLength;
    }
    isModalAudioScrubbing = false;
  });
}

if (selectTrackDefaultAudio) {
  selectTrackDefaultAudio.addEventListener("change", () => {
    const wasPlaying = modalPreviewAudio && !modalPreviewAudio.paused;
    updateModalAudioSource(wasPlaying);
  });
}

function updateTrackVideoPreview(videoId) {
  const previewBox = document.getElementById("track-video-preview");
  const thumbEl = document.getElementById("track-video-preview-thumb");
  const titleEl = document.getElementById("track-video-preview-title");
  const durEl = document.getElementById("track-video-preview-duration");
  const sizeEl = document.getElementById("track-video-preview-size");
  const segmentText = document.getElementById("track-modal-segment-text");
  const segmentSub = document.getElementById("track-modal-segment-sub");
  const inputStart = document.getElementById("input-track-start");
  const inputEnd = document.getElementById("input-track-end");

  if (!previewBox) return;

  const video = (cachedLibrary.videos || []).find(v => v.id === videoId);
  if (!video) {
    previewBox.style.display = "none";
    return;
  }

  previewBox.style.display = "flex";
  if (thumbEl) thumbEl.src = `/api/media/thumbnail/${video.id}`;
  if (titleEl) titleEl.textContent = video.title;
  if (durEl) durEl.textContent = `Duration: ${pm5Hud.formatTime(video.duration)}`;
  if (sizeEl) {
    const mb = video.size_bytes ? (video.size_bytes / (1024 * 1024)).toFixed(1) : 0;
    sizeEl.textContent = `${mb} MB`;
  }

  const startVal = parseFloat(video.start_time || 0);
  const endVal = parseFloat(video.end_time || 0);
  const isTrimmed = (startVal > 0) || (endVal > 0 && endVal < video.duration);

  if (inputStart) inputStart.value = startVal;
  if (inputEnd) inputEnd.value = endVal;

  if (segmentText) {
    if (isTrimmed) {
      const segDuration = (endVal > startVal) ? endVal - startVal : (video.duration - startVal);
      segmentText.textContent = `Trimmed: ${pm5Hud.formatTime(startVal)} → ${endVal > 0 ? pm5Hud.formatTime(endVal) : 'End'} (${pm5Hud.formatTime(segDuration)})`;
    } else {
      segmentText.textContent = `Full Video (0:00 → ${pm5Hud.formatTime(video.duration || 0)})`;
    }
  }
  if (segmentSub) {
    segmentSub.textContent = isTrimmed ? "Using pre-configured trim points from Media Center" : "Full video playback (can be trimmed in Media Center)";
  }
}

const btnTrackModalEditTrim = document.getElementById("btn-track-modal-edit-trim");
if (btnTrackModalEditTrim) {
  btnTrackModalEditTrim.addEventListener("click", () => {
    const videoId = selectTrackVideo ? selectTrackVideo.value : null;
    if (videoId) {
      closeTrackModal();
      openTrimMediaModal("video", videoId);
    }
  });
}

if (selectTrackVideo) {
  selectTrackVideo.addEventListener("change", () => {
    updateTrackVideoPreview(selectTrackVideo.value);
    // If default audio is original, update preview audio source too
    if (selectTrackDefaultAudio && selectTrackDefaultAudio.value === "original") {
      const wasPlaying = modalPreviewAudio && !modalPreviewAudio.paused;
      updateModalAudioSource(wasPlaying);
    }
  });
}

function openTrackModal() {
  if (!modalCreateTrack) return;
  stopModalAudio();

  const modalTitle = modalCreateTrack.querySelector(".modal-title");
  if (modalTitle) modalTitle.textContent = "Configure Scenic Track";
  const submitBtn = modalCreateTrack.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = "Save Track";

  if (formCreateTrack) formCreateTrack.reset();
  const idInput = document.getElementById("input-track-id");
  if (idInput) idInput.value = "";
  document.getElementById("input-track-start").value = "0";
  document.getElementById("input-track-end").value = "0";
  const cbFixedSpeed = document.getElementById("input-track-fixed-speed");
  if (cbFixedSpeed) cbFixedSpeed.checked = false;

  populateTrackModalDropdowns();
  updateTrackVideoPreview(selectTrackVideo ? selectTrackVideo.value : null);
  updateModalAudioSource(false);

  modalCreateTrack.classList.add("open");
}

function openCreateTrackFromVideo(videoId, videoTitle) {
  openTrackModal();
  if (selectTrackVideo && videoId) {
    selectTrackVideo.value = videoId;
    updateTrackVideoPreview(videoId);
  }
  const nameInput = document.getElementById("input-track-name");
  if (nameInput) {
    nameInput.value = videoTitle || "";
    nameInput.focus();
    nameInput.select();
  }
}

function openEditTrackModal(track) {
  if (!modalCreateTrack) return;
  stopModalAudio();

  const modalTitle = modalCreateTrack.querySelector(".modal-title");
  if (modalTitle) modalTitle.textContent = "Edit Scenic Track";
  const submitBtn = modalCreateTrack.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = "Save Changes";

  populateTrackModalDropdowns();

  const idInput = document.getElementById("input-track-id");
  if (idInput) idInput.value = track.id || "";
  document.getElementById("input-track-name").value = track.name || "";
  if (selectTrackVideo) selectTrackVideo.value = track.video_id;
  document.getElementById("input-track-start").value = pm5Hud.formatTime(track.start_time || 0);
  document.getElementById("input-track-end").value = track.end_time > 0 ? pm5Hud.formatTime(track.end_time) : "0";
  if (selectTrackDefaultAudio) selectTrackDefaultAudio.value = track.default_audio || "original";

  const cbFixedSpeed = document.getElementById("input-track-fixed-speed");
  if (cbFixedSpeed) cbFixedSpeed.checked = !!track.fixed_speed;

  if (containerTrackAllowedAudios) {
    const allowed = track.allowed_audios || [];
    containerTrackAllowedAudios.querySelectorAll('input[name="allowed_audio"]').forEach(cb => {
      cb.checked = allowed.includes(cb.value);
    });
  }

  updateTrackVideoPreview(track.video_id);
  updateModalAudioSource(false);
  modalCreateTrack.classList.add("open");
}

function closeTrackModal() {
  stopModalAudio();
  if (modalCreateTrack) modalCreateTrack.classList.remove("open");
}

if (btnOpenCreateTrack) btnOpenCreateTrack.addEventListener("click", openTrackModal);
if (btnCloseCreateTrack) btnCloseCreateTrack.addEventListener("click", closeTrackModal);
if (btnCancelCreateTrack) btnCancelCreateTrack.addEventListener("click", closeTrackModal);

if (formCreateTrack) {
  formCreateTrack.addEventListener("submit", async (e) => {
    e.preventDefault();
    const trackId = document.getElementById("input-track-id").value.trim() || undefined;
    const name = document.getElementById("input-track-name").value.trim();
    const videoId = selectTrackVideo.value;
    const startTime = parseTimeSeconds(document.getElementById("input-track-start").value);
    const endTime = parseTimeSeconds(document.getElementById("input-track-end").value);
    const defaultAudio = selectTrackDefaultAudio.value;

    const allowedAudios = [];
    containerTrackAllowedAudios.querySelectorAll('input[name="allowed_audio"]:checked').forEach(cb => {
      allowedAudios.push(cb.value);
    });

    const fixedSpeed = !!document.getElementById("input-track-fixed-speed")?.checked;

    const payload = {
      id: trackId,
      name,
      video_id: videoId,
      start_time: startTime,
      end_time: endTime,
      default_audio: defaultAudio,
      allowed_audios: allowedAudios,
      fixed_speed: fixedSpeed
    };

    try {
      const res = await fetch("/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Failed to save track");
      closeTrackModal();
      formCreateTrack.reset();
      loadTracksUI();

      // If this track is currently loaded in cockpit, update controller & audio dropdown
      if (trackController.activeTrack && trackController.activeTrack.id === trackId) {
        trackController.loadTrack(payload);
        rateController.setFixedSpeed(fixedSpeed);
        pm5Hud.updateSpeedMultiplier(rateController.smoothedRate, fixedSpeed);
        updateAudioTrackDropdown(null, payload.allowed_audios);
      }
    } catch (err) {
      alert("Error saving track: " + err.message);
    }
  });
}

// ----------------- Media Rename Modal -----------------
const modalRenameMedia = document.getElementById("modal-rename-media");
const btnCloseRenameMedia = document.getElementById("btn-close-rename-media");
const btnCancelRenameMedia = document.getElementById("btn-cancel-rename-media");
const formRenameMedia = document.getElementById("form-rename-media");
const inputRenameType = document.getElementById("input-rename-type");
const inputRenameId = document.getElementById("input-rename-id");
const inputRenameTitle = document.getElementById("input-rename-title");
const modalRenameHeading = document.getElementById("modal-rename-heading");
const labelRenameTitle = document.getElementById("label-rename-title");
const btnSubmitRenameMedia = document.getElementById("btn-submit-rename-media");

function openRenameMediaModal(type, id, currentTitle) {
  if (!modalRenameMedia) return;
  inputRenameType.value = type;
  inputRenameId.value = id;
  inputRenameTitle.value = currentTitle || "";

  if (modalRenameHeading) {
    modalRenameHeading.textContent = type === "video" ? "Rename Video" : "Rename Soundtrack";
  }
  if (labelRenameTitle) {
    labelRenameTitle.textContent = type === "video" ? "Video Title" : "Soundtrack Title";
  }

  modalRenameMedia.classList.add("open");
  setTimeout(() => {
    if (inputRenameTitle) {
      inputRenameTitle.focus();
      inputRenameTitle.select();
    }
  }, 50);
}

function closeRenameMediaModal() {
  if (modalRenameMedia) {
    modalRenameMedia.classList.remove("open");
  }
}

if (btnCloseRenameMedia) btnCloseRenameMedia.addEventListener("click", closeRenameMediaModal);
if (btnCancelRenameMedia) btnCancelRenameMedia.addEventListener("click", closeRenameMediaModal);
if (modalRenameMedia) {
  modalRenameMedia.addEventListener("click", (e) => {
    if (e.target === modalRenameMedia) closeRenameMediaModal();
  });
}

if (formRenameMedia) {
  formRenameMedia.addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = inputRenameType.value;
    const id = inputRenameId.value;
    const newTitle = inputRenameTitle.value.trim();
    if (!newTitle) return;

    if (btnSubmitRenameMedia) {
      btnSubmitRenameMedia.disabled = true;
      btnSubmitRenameMedia.textContent = "Saving...";
    }

    try {
      await mediaManager.renameMedia(type, id, newTitle);

      // If currently active video in cockpit was renamed, update HUD title
      if (type === "video" && currentCockpitVideoId === id) {
        if (!trackController.activeTrack) {
          pm5Hud.setVideoTitle(newTitle);
        }
      }

      // If currently active audio in cockpit was renamed, update title & HUD audio badges
      if (type === "audio") {
        const audioUrl = `/api/media/audio/${id}`;
        if (audioEngine.customAudioUrl === audioUrl) {
          audioEngine.customAudioTitle = newTitle;
          if (audioEngine.mode === "custom") {
            audioEngine.currentTitle = newTitle;
            audioEngine.emitStatus();
          }
        }
      }

      closeRenameMediaModal();
      await loadLibraryUI();
      await loadTracksUI();
      showHudToast(`Renamed to "${newTitle}"`);
    } catch (err) {
      alert("Error renaming media: " + (err.message || err));
    } finally {
      if (btnSubmitRenameMedia) {
        btnSubmitRenameMedia.disabled = false;
        btnSubmitRenameMedia.textContent = "Save Title";
      }
    }
  });
}

// ----------------- Add Music to Track Modal -----------------
const modalAddAudioToTrack = document.getElementById("modal-add-audio-to-track");
const btnCloseAddAudioTrack = document.getElementById("btn-close-add-audio-track");
const btnCancelAddAudioTrack = document.getElementById("btn-cancel-add-audio-track");
const formAddAudioToTrack = document.getElementById("form-add-audio-to-track");
const inputAddAudioId = document.getElementById("input-add-audio-id");
const addAudioTrackTitle = document.getElementById("add-audio-track-title");
const containerAudioTracksList = document.getElementById("container-audio-tracks-list");
const btnSaveAddAudioTrack = document.getElementById("btn-save-add-audio-track");

function openAddAudioToTrackModal(audioId, audioTitle) {
  if (!modalAddAudioToTrack) return;
  inputAddAudioId.value = audioId;
  if (addAudioTrackTitle) addAudioTrackTitle.textContent = audioTitle || "Selected Soundtrack";

  if (containerAudioTracksList) {
    if (!cachedTracks || cachedTracks.length === 0) {
      containerAudioTracksList.innerHTML = `
        <div style="padding: 1.25rem 1rem; text-align: center; color: var(--text-dim); background: rgba(255,255,255,0.02); border: 1px dashed var(--surface-border); border-radius: 6px;">
          <p style="margin-bottom: 0.75rem; font-size: 0.85rem;">No scenic tracks created yet. Create a track first to associate this soundtrack with it.</p>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-quick-create-track">Create New Track</button>
        </div>
      `;
      const quickBtn = containerAudioTracksList.querySelector("#btn-quick-create-track");
      if (quickBtn) {
        quickBtn.addEventListener("click", () => {
          closeAddAudioToTrackModal();
          openTrackModal();
        });
      }
    } else {
      containerAudioTracksList.innerHTML = cachedTracks.map(t => {
        const allowed = t.allowed_audios || [];
        const isAllowed = allowed.includes(audioId) || t.default_audio === audioId;
        const isDefault = t.default_audio === audioId;

        return `
          <label style="display: flex; align-items: center; justify-content: space-between; padding: 0.65rem 0.85rem; background: var(--surface-card); border: 1px solid var(--surface-border); border-radius: 6px; cursor: pointer;">
            <div style="display: flex; align-items: center; gap: 0.75rem; min-width: 0;">
              <input type="checkbox" name="track_assoc" value="${t.id}" ${isAllowed ? 'checked' : ''} style="accent-color: var(--accent-blue); width: 16px; height: 16px; flex-shrink: 0;">
              <div style="min-width: 0;">
                <div style="font-weight: 600; font-size: 0.88rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.name}</div>
                <div style="font-size: 0.74rem; color: var(--text-dim);">${isDefault ? "★ Default Soundtrack for this route" : "Available in cockpit audio selector"}</div>
              </div>
            </div>
            <span style="font-size: 0.75rem; color: var(--text-muted); flex-shrink: 0; margin-left: 0.5rem;">${pm5Hud.formatTime(t.start_time)} → ${t.end_time > 0 ? pm5Hud.formatTime(t.end_time) : "End"}</span>
          </label>
        `;
      }).join("");
    }
  }

  modalAddAudioToTrack.classList.add("open");
}

function closeAddAudioToTrackModal() {
  if (modalAddAudioToTrack) modalAddAudioToTrack.classList.remove("open");
}

if (btnCloseAddAudioTrack) btnCloseAddAudioTrack.addEventListener("click", closeAddAudioToTrackModal);
if (btnCancelAddAudioTrack) btnCancelAddAudioTrack.addEventListener("click", closeAddAudioToTrackModal);
if (modalAddAudioToTrack) {
  modalAddAudioToTrack.addEventListener("click", (e) => {
    if (e.target === modalAddAudioToTrack) closeAddAudioToTrackModal();
  });
}

if (formAddAudioToTrack) {
  formAddAudioToTrack.addEventListener("submit", async (e) => {
    e.preventDefault();
    const audioId = inputAddAudioId.value;
    if (!audioId || !cachedTracks || cachedTracks.length === 0) {
      closeAddAudioToTrackModal();
      return;
    }

    if (btnSaveAddAudioTrack) {
      btnSaveAddAudioTrack.disabled = true;
      btnSaveAddAudioTrack.textContent = "Saving...";
    }

    const checkedTrackIds = new Set();
    containerAudioTracksList.querySelectorAll('input[name="track_assoc"]:checked').forEach(cb => {
      checkedTrackIds.add(cb.value);
    });

    try {
      for (const track of cachedTracks) {
        let allowed = Array.isArray(track.allowed_audios) ? [...track.allowed_audios] : [];
        let modified = false;

        if (checkedTrackIds.has(track.id)) {
          if (!allowed.includes(audioId)) {
            allowed.push(audioId);
            modified = true;
          }
        } else {
          if (allowed.includes(audioId)) {
            allowed = allowed.filter(id => id !== audioId);
            modified = true;
          }
          if (track.default_audio === audioId) {
            track.default_audio = "original";
            modified = true;
          }
        }

        if (modified) {
          track.allowed_audios = allowed;
          await fetch("/api/tracks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(track)
          });
        }
      }

      closeAddAudioToTrackModal();
      await loadTracksUI();
      showHudToast("Updated track music associations");
    } catch (err) {
      alert("Error updating track associations: " + (err.message || err));
    } finally {
      if (btnSaveAddAudioTrack) {
        btnSaveAddAudioTrack.disabled = false;
        btnSaveAddAudioTrack.textContent = "Save Associations";
      }
    }
  });
}

// ----------------- Media Trim & Preview Modal -----------------
const modalTrimMedia = document.getElementById("modal-trim-media");
const btnCloseTrimMedia = document.getElementById("btn-close-trim-media");
const btnCancelTrimMedia = document.getElementById("btn-cancel-trim-media");
const formTrimMedia = document.getElementById("form-trim-media");
const inputTrimType = document.getElementById("input-trim-type");
const inputTrimId = document.getElementById("input-trim-id");
const inputTrimDuration = document.getElementById("input-trim-duration");
const inputTrimStart = document.getElementById("input-trim-start");
const inputTrimEnd = document.getElementById("input-trim-end");
const trimMediaTitle = document.getElementById("trim-media-title");
const trimMediaTypeBadge = document.getElementById("trim-media-type-badge");
const trimMediaMetaLine = document.getElementById("trim-media-meta-line");
const trimResultSummary = document.getElementById("trim-result-summary");
const trimVideoContainer = document.getElementById("trim-video-container");
const trimAudioContainer = document.getElementById("trim-audio-container");
const trimPreviewVideo = document.getElementById("trim-preview-video");
const trimPreviewAudio = document.getElementById("trim-preview-audio");
const btnUseCurrentAsStart = document.getElementById("btn-use-current-as-start");
const btnUseCurrentAsEnd = document.getElementById("btn-use-current-as-end");
const btnResetTrim = document.getElementById("btn-reset-trim");
const btnSaveTrimMedia = document.getElementById("btn-save-trim-media");

function updateTrimSummary() {
  const duration = parseFloat(inputTrimDuration?.value || 0);
  const start = parseTimeSeconds(inputTrimStart?.value);
  const rawEnd = parseTimeSeconds(inputTrimEnd?.value);
  const end = rawEnd > 0 ? rawEnd : duration;

  if (trimResultSummary) {
    if (start > 0 || (rawEnd > 0 && rawEnd < duration)) {
      const length = Math.max(0, end - start);
      trimResultSummary.textContent = `${pm5Hud.formatTime(start)} → ${pm5Hud.formatTime(end)} (Length: ${pm5Hud.formatTime(length)})`;
      trimResultSummary.style.color = "var(--accent-emerald)";
    } else {
      trimResultSummary.textContent = `0:00 → End (${pm5Hud.formatTime(duration)} Full Duration)`;
      trimResultSummary.style.color = "var(--text-main)";
    }
  }
}

function stopTrimPlayers() {
  if (trimPreviewVideo) {
    trimPreviewVideo.pause();
    trimPreviewVideo.removeAttribute("src");
    trimPreviewVideo.load();
  }
  if (trimPreviewAudio) {
    trimPreviewAudio.pause();
    trimPreviewAudio.removeAttribute("src");
    trimPreviewAudio.load();
  }
}

function openTrimMediaModal(type, id) {
  if (!modalTrimMedia) return;
  stopTrimPlayers();

  inputTrimType.value = type;
  inputTrimId.value = id;

  const item = (type === "video" ? cachedLibrary.videos : cachedLibrary.audio)?.find(m => m.id === id);
  if (!item) return;

  inputTrimDuration.value = item.duration || 0;
  if (trimMediaTitle) trimMediaTitle.textContent = item.title;
  if (trimMediaTypeBadge) {
    trimMediaTypeBadge.textContent = type === "video" ? "Scenic Video" : "Soundtrack";
    trimMediaTypeBadge.style.background = type === "video" ? "rgba(59,130,246,0.2)" : "rgba(168,85,247,0.2)";
    trimMediaTypeBadge.style.color = type === "video" ? "var(--accent-blue)" : "var(--accent-purple, #c084fc)";
  }
  if (trimMediaMetaLine) {
    const min = Math.floor((item.duration || 0) / 60);
    const sec = (item.duration || 0) % 60;
    trimMediaMetaLine.textContent = `Full File Duration: ${min}m ${sec}s (${pm5Hud.formatTime(item.duration || 0)}) • ${(item.size_bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const startVal = item.start_time || 0;
  const endVal = item.end_time || 0;
  inputTrimStart.value = pm5Hud.formatTime(startVal);
  inputTrimEnd.value = endVal > 0 ? pm5Hud.formatTime(endVal) : "0:00";
  updateTrimSummary();

  if (type === "video") {
    if (trimVideoContainer) trimVideoContainer.style.display = "block";
    if (trimAudioContainer) trimAudioContainer.style.display = "none";
    if (trimPreviewVideo) {
      trimPreviewVideo.src = `/api/media/video/${id}`;
      trimPreviewVideo.load();
      if (startVal > 0) {
        trimPreviewVideo.currentTime = startVal;
      }
      trimPreviewVideo.play().catch(() => {});
    }
  } else {
    if (trimVideoContainer) trimVideoContainer.style.display = "none";
    if (trimAudioContainer) trimAudioContainer.style.display = "block";
    if (trimPreviewAudio) {
      trimPreviewAudio.src = `/api/media/audio/${id}`;
      trimPreviewAudio.load();
      if (startVal > 0) {
        trimPreviewAudio.currentTime = startVal;
      }
      trimPreviewAudio.play().catch(() => {});
    }
  }

  modalTrimMedia.classList.add("open");
}

function closeTrimMediaModal() {
  stopTrimPlayers();
  if (modalTrimMedia) modalTrimMedia.classList.remove("open");
}

if (btnCloseTrimMedia) btnCloseTrimMedia.addEventListener("click", closeTrimMediaModal);
if (btnCancelTrimMedia) btnCancelTrimMedia.addEventListener("click", closeTrimMediaModal);
if (modalTrimMedia) {
  modalTrimMedia.addEventListener("click", (e) => {
    if (e.target === modalTrimMedia) closeTrimMediaModal();
  });
}

function getCurrentPlayerTime() {
  const type = inputTrimType.value;
  if (type === "video" && trimPreviewVideo) {
    return trimPreviewVideo.currentTime || 0;
  }
  if (type === "audio" && trimPreviewAudio) {
    return trimPreviewAudio.currentTime || 0;
  }
  return 0;
}

if (btnUseCurrentAsStart) {
  btnUseCurrentAsStart.addEventListener("click", () => {
    const cur = getCurrentPlayerTime();
    inputTrimStart.value = pm5Hud.formatTime(Math.floor(cur));
    updateTrimSummary();
  });
}

if (btnUseCurrentAsEnd) {
  btnUseCurrentAsEnd.addEventListener("click", () => {
    const cur = getCurrentPlayerTime();
    inputTrimEnd.value = pm5Hud.formatTime(Math.ceil(cur));
    updateTrimSummary();
  });
}

if (btnResetTrim) {
  btnResetTrim.addEventListener("click", () => {
    inputTrimStart.value = "0:00";
    inputTrimEnd.value = "0:00";
    updateTrimSummary();
  });
}

if (inputTrimStart) inputTrimStart.addEventListener("input", updateTrimSummary);
if (inputTrimEnd) inputTrimEnd.addEventListener("input", updateTrimSummary);

if (formTrimMedia) {
  formTrimMedia.addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = inputTrimType.value;
    const id = inputTrimId.value;
    const startTime = parseTimeSeconds(inputTrimStart.value);
    const endTime = parseTimeSeconds(inputTrimEnd.value);

    if (btnSaveTrimMedia) {
      btnSaveTrimMedia.disabled = true;
      btnSaveTrimMedia.textContent = "Saving...";
    }

    try {
      await mediaManager.updateMedia(type, id, {
        start_time: startTime,
        end_time: endTime
      });

      // Update cockpit track controller or audio engine if currently active
      if (type === "video" && trackController.activeTrack && trackController.activeTrack.videoId === id) {
        trackController.activeTrack.startTime = startTime;
        trackController.activeTrack.endTime = endTime;
        if (audioEngine.mode === "original") {
          audioEngine.videoStartTime = startTime;
          audioEngine.videoEndTime = endTime;
          audioEngine.activeStart = startTime;
          audioEngine.activeEnd = endTime;
        }
      } else if (type === "audio" && audioEngine.currentSrc && audioEngine.currentSrc.includes(id)) {
        audioEngine.startTime = startTime;
        audioEngine.endTime = endTime;
        audioEngine.activeStart = startTime;
        audioEngine.activeEnd = endTime;
      }

      closeTrimMediaModal();
      await loadLibraryUI();
      await loadTracksUI();
      showHudToast("Trim points updated");
    } catch (err) {
      alert("Error saving trim points: " + (err.message || err));
    } finally {
      if (btnSaveTrimMedia) {
        btnSaveTrimMedia.disabled = false;
        btnSaveTrimMedia.textContent = "Save Trim Points";
      }
    }
  });
}

// ----------------- YouTube Ingestion Form -----------------
const downloadForm = document.getElementById("form-download");
const tasksContainer = document.getElementById("download-tasks");

if (downloadForm) {
  downloadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const urlInput = document.getElementById("input-youtube-url");
    const typeSelect = document.getElementById("select-download-type");
    const url = urlInput.value.trim();
    const dlType = typeSelect.value;

    if (!url) return;
    try {
      await mediaManager.startDownload(url, dlType);
      urlInput.value = "";
      pollDownloads();
      const initialTasks = await mediaManager.getTasks();
      renderDownloadTasks(initialTasks);
    } catch (err) {
      alert("Error starting download: " + err.message);
    }
  });
}

function pollDownloads() {
  mediaManager.startPolling((tasks) => {
    renderDownloadTasks(tasks);
  });
}

let previouslyCompletedTasks = new Set();

function renderDownloadTasks(tasks) {
  if (!tasksContainer) return;
  if (!tasks || tasks.length === 0) {
    tasksContainer.innerHTML = "";
    previouslyCompletedTasks.clear();
    return;
  }

  const hasInactive = tasks.some(t => ["completed", "error", "cancelled"].includes(t.status));
  const hasActive = tasks.some(t => ["pending", "extracting_metadata", "downloading", "downloading_video", "downloading_audio", "processing"].includes(t.status));

  let headerButtons = "";
  if (hasInactive && hasActive) {
    headerButtons = `
      <button id="btn-clear-inactive-downloads" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.65rem;">Clear Finished</button>
      <button id="btn-clear-all-downloads" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.65rem;">Clear All</button>
    `;
  } else if (hasInactive) {
    headerButtons = `
      <button id="btn-clear-inactive-downloads" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.65rem;">Clear Finished / Failed</button>
    `;
  } else if (hasActive) {
    headerButtons = `
      <button id="btn-clear-all-downloads" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.65rem;">Cancel & Clear All</button>
    `;
  }

  const headerHtml = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
      <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em;">Ingestion Queue (${tasks.length})</span>
      <div style="display: flex; gap: 0.5rem;">
        ${headerButtons}
      </div>
    </div>
  `;

  const tasksHtml = tasks.map(t => {
    const isActive = ["pending", "extracting_metadata", "downloading", "downloading_video", "downloading_audio", "processing"].includes(t.status);
    const isError = t.status === "error";
    const isCancelled = t.status === "cancelled";
    const isCompleted = t.status === "completed";

    let statusLabel = t.status;
    if (t.status === "downloading" || t.status === "downloading_video") statusLabel = `Downloading Video (${t.progress}%)`;
    else if (t.status === "downloading_audio") statusLabel = `Extracting Audio (${t.progress}%)`;
    else if (t.status === "extracting_metadata") statusLabel = "Extracting Info...";
    else if (t.status === "processing") statusLabel = "Processing...";
    else if (t.status === "completed") statusLabel = "Completed";
    else if (t.status === "cancelled") statusLabel = "Cancelled";
    else if (t.status === "error") statusLabel = "Failed";

    let actionBtnHtml = "";
    if (isActive) {
      actionBtnHtml = `
        <button class="btn btn-danger btn-sm btn-cancel-download" data-id="${t.task_id}" title="Cancel download and delete from queue">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 3px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Cancel
        </button>
      `;
    } else if (isError) {
      actionBtnHtml = `
        <button class="btn btn-danger btn-sm btn-delete-task" data-id="${t.task_id}" title="Delete failed ingestion from queue">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 3px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          Delete
        </button>
      `;
    } else if (isCancelled) {
      actionBtnHtml = `
        <button class="btn btn-secondary btn-sm btn-delete-task" data-id="${t.task_id}" title="Remove cancelled task from queue">Remove</button>
      `;
    } else if (isCompleted) {
      actionBtnHtml = `
        <button class="btn btn-secondary btn-sm btn-delete-task" data-id="${t.task_id}" title="Clear completed task from queue">Clear</button>
      `;
    }

    return `
      <div class="download-task-card ${t.status}" id="task-card-${t.task_id}">
        <div class="task-info-line">
          <div style="flex: 1; min-width: 0; padding-right: 0.75rem;">
            <strong style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.88rem;">${t.title || t.url}</strong>
            <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 3px; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span class="task-status-badge ${t.status}">${statusLabel}</span>
              ${t.speed ? `<span>${t.speed}</span>` : ""}
              ${t.eta ? `<span>ETA: ${t.eta}</span>` : ""}
            </div>
          </div>
          <div class="task-actions" style="flex-shrink: 0;">
            ${actionBtnHtml}
          </div>
        </div>
        ${isActive ? `
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${Math.max(t.progress, 5)}%"></div>
          </div>
        ` : ""}
        ${t.error ? `<div style="color: var(--accent-rose); font-size: 0.78rem; margin-top: 0.4rem; word-break: break-word;">⚠️ ${t.error}</div>` : ""}
      </div>
    `;
  }).join("");

  tasksContainer.innerHTML = headerHtml + tasksHtml;

  // Refresh library and tracks only when new tasks complete
  let hasNewCompletion = false;
  tasks.forEach(t => {
    if (t.status === "completed" && !previouslyCompletedTasks.has(t.task_id)) {
      previouslyCompletedTasks.add(t.task_id);
      hasNewCompletion = true;
    }
  });
  if (hasNewCompletion) {
    loadLibraryUI();
    loadTracksUI();
  }
}

// Single delegated listener for tasksContainer to prevent missed clicks during poll cycles
if (tasksContainer) {
  tasksContainer.addEventListener("click", async (e) => {
    // 1. Cancel active download
    const cancelBtn = e.target.closest(".btn-cancel-download");
    if (cancelBtn) {
      e.preventDefault();
      e.stopPropagation();
      const taskId = cancelBtn.dataset.id;
      cancelBtn.disabled = true;
      cancelBtn.textContent = "Cancelling...";
      try {
        await mediaManager.deleteTask(taskId);
      } finally {
        const updated = await mediaManager.getTasks();
        renderDownloadTasks(updated);
        loadLibraryUI();
        loadTracksUI();
      }
      return;
    }

    // 2. Delete / Remove / Clear single task card
    const deleteBtn = e.target.closest(".btn-delete-task");
    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      const taskId = deleteBtn.dataset.id;
      deleteBtn.disabled = true;
      try {
        await mediaManager.deleteTask(taskId);
      } finally {
        const updated = await mediaManager.getTasks();
        renderDownloadTasks(updated);
        loadLibraryUI();
        loadTracksUI();
      }
      return;
    }

    // 3. Clear finished / inactive tasks
    const clearInactiveBtn = e.target.closest("#btn-clear-inactive-downloads");
    if (clearInactiveBtn) {
      e.preventDefault();
      e.stopPropagation();
      clearInactiveBtn.disabled = true;
      clearInactiveBtn.textContent = "Clearing...";
      try {
        await mediaManager.clearInactiveTasks(false);
      } finally {
        const updated = await mediaManager.getTasks();
        renderDownloadTasks(updated);
        loadLibraryUI();
        loadTracksUI();
      }
      return;
    }

    // 4. Clear all tasks
    const clearAllBtn = e.target.closest("#btn-clear-all-downloads");
    if (clearAllBtn) {
      e.preventDefault();
      e.stopPropagation();
      clearAllBtn.disabled = true;
      clearAllBtn.textContent = "Clearing...";
      try {
        await mediaManager.clearInactiveTasks(true);
      } finally {
        const updated = await mediaManager.getTasks();
        renderDownloadTasks(updated);
        loadLibraryUI();
        loadTracksUI();
      }
      return;
    }
  });
}

// ----------------- Direct Device Media Upload -----------------
const uploadDropzone = document.getElementById("upload-dropzone");
const uploadFileInput = document.getElementById("input-upload-file");
const uploadForm = document.getElementById("form-upload");
const uploadTitleInput = document.getElementById("input-upload-title");
const uploadTypeSelect = document.getElementById("select-upload-type");
const btnSubmitUpload = document.getElementById("btn-submit-upload");
const btnCancelUpload = document.getElementById("btn-cancel-upload");
const uploadProgressContainer = document.getElementById("upload-progress-container");
const uploadProgressFilename = document.getElementById("upload-progress-filename");
const uploadProgressPct = document.getElementById("upload-progress-pct");
const uploadProgressBar = document.getElementById("upload-progress-bar");
const uploadProgressStatus = document.getElementById("upload-progress-status");
const uploadSelectedFilename = document.getElementById("upload-selected-filename");

let pendingUploadFile = null;

function formatUploadFileSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function selectUploadFile(file) {
  if (!file) return;
  pendingUploadFile = file;

  // Auto-detect title from filename
  const lastDot = file.name.lastIndexOf(".");
  const rawBase = lastDot > 0 ? file.name.substring(0, lastDot) : file.name;
  const cleanTitle = rawBase.replace(/[-_]+/g, " ").trim();
  if (uploadTitleInput) {
    uploadTitleInput.value = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
  }

  // Auto-detect type
  const ext = (lastDot > 0 ? file.name.substring(lastDot).toLowerCase() : "");
  const isVideo = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"].includes(ext) || file.type.startsWith("video/");
  const isAudio = [".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"].includes(ext) || file.type.startsWith("audio/");

  if (uploadTypeSelect) {
    if (isVideo) uploadTypeSelect.value = "video";
    else if (isAudio) uploadTypeSelect.value = "audio";
    else uploadTypeSelect.value = "auto";
  }

  if (uploadSelectedFilename) {
    uploadSelectedFilename.innerHTML = `<strong style="color: var(--text-main);">Selected:</strong> ${file.name} (${formatUploadFileSize(file.size)})`;
  }

  if (uploadForm) {
    uploadForm.style.display = "block";
  }
}

function resetUploadForm() {
  pendingUploadFile = null;
  if (uploadFileInput) uploadFileInput.value = "";
  if (uploadTitleInput) uploadTitleInput.value = "";
  if (uploadTypeSelect) uploadTypeSelect.value = "auto";
  if (uploadForm) uploadForm.style.display = "none";
  if (uploadSelectedFilename) {
    uploadSelectedFilename.textContent = "MP4, MOV, WEBM, MP3, M4A, WAV, FLAC";
  }
}

if (uploadDropzone && uploadFileInput) {
  uploadDropzone.addEventListener("click", (e) => {
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select")) return;
    uploadFileInput.click();
  });

  uploadFileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      selectUploadFile(e.target.files[0]);
    }
  });

  // Drag & drop handlers
  ["dragenter", "dragover"].forEach(evt => {
    uploadDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadDropzone.classList.add("dragover");
    });
  });

  ["dragleave", "dragend"].forEach(evt => {
    uploadDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadDropzone.classList.remove("dragover");
    });
  });

  uploadDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadDropzone.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      selectUploadFile(e.dataTransfer.files[0]);
    }
  });
}

if (btnCancelUpload) {
  btnCancelUpload.addEventListener("click", () => {
    resetUploadForm();
  });
}

if (uploadForm) {
  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!pendingUploadFile) {
      alert("Please choose a file to upload.");
      return;
    }

    const file = pendingUploadFile;
    const mediaType = uploadTypeSelect ? uploadTypeSelect.value : "auto";
    const customTitle = uploadTitleInput ? uploadTitleInput.value.trim() : "";

    const formData = new FormData();
    formData.append("file", file);
    formData.append("media_type", mediaType);
    if (customTitle) {
      formData.append("title", customTitle);
    }

    // UI state: uploading
    if (btnSubmitUpload) {
      btnSubmitUpload.disabled = true;
      btnSubmitUpload.textContent = "Uploading...";
    }
    if (uploadProgressContainer) {
      uploadProgressContainer.style.display = "block";
    }
    if (uploadProgressFilename) {
      uploadProgressFilename.textContent = file.name;
    }
    if (uploadProgressPct) {
      uploadProgressPct.textContent = "0%";
    }
    if (uploadProgressBar) {
      uploadProgressBar.style.width = "0%";
    }
    if (uploadProgressStatus) {
      uploadProgressStatus.textContent = "Uploading file to server...";
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload");

    xhr.upload.addEventListener("progress", (evt) => {
      if (evt.lengthComputable) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        if (uploadProgressBar) uploadProgressBar.style.width = `${pct}%`;
        if (uploadProgressPct) uploadProgressPct.textContent = `${pct}%`;
        if (pct >= 100 && uploadProgressStatus) {
          uploadProgressStatus.textContent = "Processing and indexing media...";
        }
      }
    });

    xhr.addEventListener("load", async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let result = {};
        try {
          result = JSON.parse(xhr.responseText);
        } catch (_) {}

        if (uploadProgressStatus) {
          uploadProgressStatus.textContent = "Upload complete! Media added to library.";
        }
        showHudToast(`Uploaded: ${result.title || file.name}`);

        // Refresh library and tracks immediately
        await loadLibraryUI();
        await loadTracksUI();

        resetUploadForm();
        setTimeout(() => {
          if (uploadProgressContainer) uploadProgressContainer.style.display = "none";
        }, 2500);
      } else {
        let errDetail = xhr.statusText || "Upload failed";
        try {
          const errData = JSON.parse(xhr.responseText);
          if (errData.detail) errDetail = errData.detail;
        } catch (_) {}
        if (uploadProgressStatus) {
          uploadProgressStatus.textContent = `Upload failed: ${errDetail}`;
        }
        alert("Upload error: " + errDetail);
      }

      if (btnSubmitUpload) {
        btnSubmitUpload.disabled = false;
        btnSubmitUpload.textContent = "Upload File";
      }
    });

    xhr.addEventListener("error", () => {
      if (uploadProgressStatus) {
        uploadProgressStatus.textContent = "Network error during upload.";
      }
      alert("Network error occurred during file upload.");
      if (btnSubmitUpload) {
        btnSubmitUpload.disabled = false;
        btnSubmitUpload.textContent = "Upload File";
      }
    });

    xhr.send(formData);
  });
}

// ----------------- Workout History & TCX Export -----------------
async function loadHistoryUI() {
  const res = await fetch("/api/sessions");
  const data = await res.json();
  const sessions = data.sessions || [];

  const totalMeters = sessions.reduce((sum, s) => sum + (s.distance_meters || 0), 0);
  const totalDuration = sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
  const totalWatts = sessions.reduce((sum, s) => sum + (s.avg_watts || 0), 0);
  const avgWatts = sessions.length ? Math.round(totalWatts / sessions.length) : 0;

  document.getElementById("stat-total-meters").textContent = Math.round(totalMeters).toLocaleString() + " m";
  document.getElementById("stat-total-workouts").textContent = sessions.length;
  document.getElementById("stat-total-time").textContent = `${Math.floor(totalDuration / 3600)}h ${Math.floor((totalDuration % 3600) / 60)}m`;
  document.getElementById("stat-avg-watts").textContent = avgWatts + " W";

  const tbody = document.getElementById("history-table-body");
  if (tbody) {
    if (sessions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 2rem;">No recorded workouts yet. Start rowing to record a session!</td></tr>`;
    } else {
      tbody.innerHTML = sessions.map(s => {
        const dateStr = s.start_time ? new Date(s.start_time).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "--";
        const splitStr = s.avg_split > 0 ? pm5Hud.formatSplit(s.avg_split) : "--:--.-";
        const durationStr = pm5Hud.formatTime(s.duration_seconds);

        return `
          <tr>
            <td><strong>${dateStr}</strong></td>
            <td>${durationStr}</td>
            <td>${Math.round(s.distance_meters).toLocaleString()} m</td>
            <td>${splitStr}</td>
            <td>${Math.round(s.avg_watts)} W</td>
            <td>${Math.round(s.avg_spm)}</td>
            <td>${s.avg_hr > 0 ? Math.round(s.avg_hr) + " BPM" : "--"}</td>
            <td>
              <a href="/api/sessions/${s.id}/export/tcx" class="btn btn-secondary btn-sm" download>Export .TCX</a>
              <button class="btn btn-danger btn-sm btn-del-session" data-id="${s.id}">Delete</button>
            </td>
          </tr>
        `;
      }).join("");

      tbody.querySelectorAll(".btn-del-session").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.dataset.id;
          const confirmed = await showConfirmDialog({
            title: "Delete Workout Session",
            message: "Are you sure you want to delete this recorded workout session?",
            confirmBtnText: "Delete Session",
            isDanger: true
          });

          if (confirmed) {
            btn.disabled = true;
            await fetch(`/api/sessions/${id}`, { method: "DELETE" });
            showHudToast("Workout session deleted");
            await loadHistoryUI();
          }
        });
      });
    }
  }
}

// ----------------- Bluetooth Hardware Pairing -----------------
document.getElementById("btn-connect-rower").addEventListener("click", async () => {
  try {
    updateRowerStatus(false, "Connecting...");
    const name = await rowerBle.connect();
    updateRowerStatus(true, name);
    if (simulator.isRunning) {
      simulator.stop();
      simBtn.textContent = "Start Simulator";
      simBtn.className = "btn btn-secondary";
    }
  } catch (err) {
    console.error("[BLE Rower Error]", err);
    updateRowerStatus(false, "Connection Failed");
    alert("Could not connect to FTMS rower: " + err.message);
  }
});

document.getElementById("btn-connect-hr").addEventListener("click", async () => {
  try {
    updateHrStatus(false, "Connecting...");
    const name = await hrBle.connect();
    updateHrStatus(true, name);
  } catch (err) {
    console.error("[BLE HR Error]", err);
    updateHrStatus(false, "Connection Failed");
    alert("Could not connect to BLE Heart Rate monitor: " + err.message);
  }
});

// ----------------- Virtual Rower Simulator Controls -----------------
const btnOpenSimPanel = document.getElementById("btn-open-sim-panel");
const simControlsBar = document.getElementById("sim-controls-bar");
const btnCloseSimPanel = document.getElementById("btn-close-sim-panel");

if (btnOpenSimPanel && simControlsBar) {
  btnOpenSimPanel.addEventListener("click", () => {
    const isClosed = simControlsBar.style.display === "none";
    simControlsBar.style.display = isClosed ? "flex" : "none";
    btnOpenSimPanel.classList.toggle("active", isClosed);
  });
}

if (btnCloseSimPanel && simControlsBar) {
  btnCloseSimPanel.addEventListener("click", () => {
    simControlsBar.style.display = "none";
    if (btnOpenSimPanel) btnOpenSimPanel.classList.remove("active");
  });
}

if (simBtn) {
  simBtn.addEventListener("click", () => {
    if (simulator.isRunning) {
      simulator.stop();
      simBtn.textContent = "Start Simulator";
      simBtn.className = "btn btn-primary btn-sm";
      if (btnOpenSimPanel) {
        btnOpenSimPanel.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: -2px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Simulator';
      }
      updateRowerStatus(false, "Simulator Stopped");
      if (sessionTracker.state === "active") {
        sessionTracker.finish();
      }
      rateController.setWorkoutLive(false);
      if (videoEl) videoEl.pause();
      audioEngine.pause();
    } else {
      simulator.start();
      simBtn.textContent = "Stop Simulator";
      simBtn.className = "btn btn-secondary btn-sm";
      if (btnOpenSimPanel) {
        btnOpenSimPanel.innerHTML = '<span class="status-dot online" style="margin-right: 6px;"></span>Sim Running';
      }
      updateRowerStatus(true, `Sim: ${simulator.mode === "dynamic" ? "Dynamic Program" : "Manual"}`);

      if (sessionTracker.state !== "active") {
        sessionTracker.start();
      }
      rateController.setWorkoutLive(true);

      if (!videoEl.src || videoEl.src === "" || videoEl.src.endsWith("/")) {
        if (cachedLibrary.videos && cachedLibrary.videos.length > 0) {
          const first = cachedLibrary.videos[0];
          loadVideoIntoCockpit(first.id, first.title, true);
        }
      } else {
        rateController.resumeVideo();
        audioEngine.play();
      }
    }
  });
}

if (simModeBtn) {
  simModeBtn.addEventListener("click", () => {
    if (simulator.mode === "dynamic") {
      simulator.setMode("manual");
      simModeBtn.textContent = "Mode: Manual Slider";
      if (simManualControls) simManualControls.style.display = "flex";
      updateRowerStatus(true, "Sim: Manual");
    } else {
      simulator.setMode("dynamic");
      simModeBtn.textContent = "Mode: Dynamic Program";
      if (simManualControls) simManualControls.style.display = "none";
      updateRowerStatus(true, "Sim: Dynamic Program");
    }
  });
}

if (simRowToggleBtn) {
  simRowToggleBtn.addEventListener("click", () => {
    const isRowing = simulator.toggleRowing();
    simRowToggleBtn.textContent = isRowing ? "Pause Pulling" : "Resume Pulling";
    simRowToggleBtn.className = isRowing ? "btn btn-secondary btn-sm" : "btn btn-success btn-sm";
    if (!isRowing) {
      if (!rateController.isFixedSpeed) {
        rateController.pauseVideo();
      }
    } else {
      rateController.resumeVideo();
    }
  });
}

if (simSpmRange) {
  simSpmRange.addEventListener("input", (e) => {
    const spm = parseInt(e.target.value, 10);
    simSpmVal.textContent = spm;
    simulator.setSpm(spm);
  });
}

// ----------------- Audio & Workout Session Controls -----------------
if (audioToggleBtn) {
  audioToggleBtn.addEventListener("click", () => {
    audioEngine.togglePlay();
  });
}

if (audioUnmuteBanner) {
  audioUnmuteBanner.addEventListener("click", () => {
    audioEngine.play();
    audioUnmuteBanner.style.display = "none";
  });
}

if (audioTrackSelect) {
  audioTrackSelect.addEventListener("change", (e) => {
    const val = e.target.value;
    if (val === "original") {
      audioEngine.setMode("original");
    } else if (val === "mute") {
      audioEngine.setMode("mute");
    } else {
      const selectedOption = audioTrackSelect.options[audioTrackSelect.selectedIndex];
      const audioId = val.split("/").pop();
      const audioObj = cachedLibrary.audio ? cachedLibrary.audio.find(a => a.id === audioId) : null;
      const startT = audioObj ? (audioObj.start_time || 0) : 0;
      const endT = audioObj ? (audioObj.end_time || 0) : 0;
      audioEngine.setCustomAudio(val, selectedOption.textContent, startT, endT);
    }
    audioEngine.play();
  });
}

if (audioVolumeSlider) {
  audioVolumeSlider.addEventListener("input", (e) => {
    audioEngine.setVolume(parseFloat(e.target.value));
  });
}

const toggleWorkoutBtn = document.getElementById("btn-toggle-workout");
if (toggleWorkoutBtn) {
  toggleWorkoutBtn.addEventListener("click", async () => {
    if (sessionTracker.state === "active" || sessionTracker.state === "paused") {
      const id = await sessionTracker.finish();
      if (id) {
        alert("Workout saved successfully! View in History.");
      }
    } else {
      sessionTracker.start();
      if (videoEl && videoEl.src && videoEl.paused) {
        videoEl.play().catch(e => console.warn(e));
        audioEngine.play();
      }
    }
  });
}

// ----------------- Settings Modal & Config -----------------
const settingsModal = document.getElementById("modal-settings");
document.getElementById("btn-open-settings").addEventListener("click", () => {
  settingsModal.classList.add("open");
});
document.getElementById("btn-close-settings").addEventListener("click", () => {
  settingsModal.classList.remove("open");
});

const settingBaselineSpm = document.getElementById("setting-baseline-spm");
const settingBaselineSpmVal = document.getElementById("setting-baseline-spm-val");
if (settingBaselineSpm) {
  settingBaselineSpm.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    settingBaselineSpmVal.textContent = val;
    rateController.setBaselineSpm(val);
  });
}

const settingAlpha = document.getElementById("setting-alpha");
const settingAlphaVal = document.getElementById("setting-alpha-val");
if (settingAlpha) {
  settingAlpha.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    settingAlphaVal.textContent = val.toFixed(2);
    rateController.setAlpha(val);
  });
}

const settingPauseAudio = document.getElementById("setting-pause-audio-on-stop");
if (settingPauseAudio) {
  settingPauseAudio.addEventListener("change", (e) => {
    audioEngine.setPauseOnStrokeStop(e.target.checked);
  });
}

// ----------------- HUD Visual Theme Management -----------------
const THEMES = ["default", "cyberpunk", "retro-pm5", "nordic"];

function getActiveTheme() {
  return localStorage.getItem("ftms_hud_theme") || "default";
}

function applyTheme(themeId) {
  if (!THEMES.includes(themeId)) themeId = "default";

  if (themeId === "default") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", themeId);
  }

  localStorage.setItem("ftms_hud_theme", themeId);

  // Update active state in settings modal
  document.querySelectorAll(".theme-choice-card").forEach((card) => {
    if (card.getAttribute("data-theme-id") === themeId) {
      card.classList.add("active");
    } else {
      card.classList.remove("active");
    }
  });
}

// Theme cards click listener
document.querySelectorAll(".theme-choice-card").forEach((card) => {
  card.addEventListener("click", () => {
    const chosenTheme = card.getAttribute("data-theme-id");
    applyTheme(chosenTheme);
  });
});

const THEME_NAMES = {
  "default": "Modern Slate",
  "cyberpunk": "Neon Cyberpunk",
  "retro-pm5": "Concept2 PM5 LCD",
  "nordic": "Nordic Minimalist"
};

let hudToastTimeout = null;
function showHudToast(text, duration = 1800) {
  const toast = document.getElementById("hud-notice-toast");
  if (!toast) return;
  toast.textContent = text;
  toast.style.display = "block";
  clearTimeout(hudToastTimeout);
  hudToastTimeout = setTimeout(() => {
    toast.style.display = "none";
  }, duration);
}

function cycleTheme() {
  const current = getActiveTheme();
  const curIdx = THEMES.indexOf(current);
  const nextIdx = (curIdx + 1) % THEMES.length;
  const nextTheme = THEMES[nextIdx];
  applyTheme(nextTheme);
  showHudToast(`Theme: ${THEME_NAMES[nextTheme] || nextTheme}`);
}

// Quick cycle button listeners (both in header and within cockpit HUD)
const btnQuickTheme = document.getElementById("btn-quick-theme");
if (btnQuickTheme) {
  btnQuickTheme.addEventListener("click", cycleTheme);
}

const btnHudCycleTheme = document.getElementById("hud-cycle-theme-btn");
if (btnHudCycleTheme) {
  btnHudCycleTheme.addEventListener("click", cycleTheme);
}

// Cockpit Immersive Mode (Toggle HUD Visibility)
let isHudHidden = false;
function toggleHudVisibility() {
  closeHudDropdowns();
  isHudHidden = !isHudHidden;
  const viewport = document.getElementById("viewport-container");
  const eyeVisible = document.getElementById("hud-eye-icon-visible");
  const eyeHidden = document.getElementById("hud-eye-icon-hidden");
  const toggleBtn = document.getElementById("hud-toggle-visibility-btn");

  if (viewport) {
    viewport.classList.toggle("hud-hidden", isHudHidden);
  }
  if (eyeVisible && eyeHidden) {
    eyeVisible.style.display = isHudHidden ? "none" : "block";
    eyeHidden.style.display = isHudHidden ? "block" : "none";
  }
  if (toggleBtn) {
    toggleBtn.title = isHudHidden ? "Show HUD (H)" : "Hide HUD for Immersive View (H)";
    if (isHudHidden) {
      toggleBtn.classList.add("active-immersive");
    } else {
      toggleBtn.classList.remove("active-immersive");
    }
  }
  showHudToast(isHudHidden ? "Immersive View: HUD Hidden" : "HUD Restored");
}

const btnHudToggleVisibility = document.getElementById("hud-toggle-visibility-btn");
if (btnHudToggleVisibility) {
  btnHudToggleVisibility.addEventListener("click", toggleHudVisibility);
}

// ----------------- In-Cockpit Track & Audio Selectors -----------------
function closeHudDropdowns() {
  const trackMenu = document.getElementById("hud-track-dropdown-menu");
  const audioMenu = document.getElementById("hud-audio-dropdown-menu");
  const trackBtn = document.getElementById("btn-hud-track-picker");
  const audioBtn = document.getElementById("btn-hud-audio-picker");

  if (trackMenu) trackMenu.style.display = "none";
  if (audioMenu) audioMenu.style.display = "none";
  if (trackBtn) {
    trackBtn.classList.remove("active-dropdown");
    trackBtn.setAttribute("aria-expanded", "false");
  }
  if (audioBtn) {
    audioBtn.classList.remove("active-dropdown");
    audioBtn.setAttribute("aria-expanded", "false");
  }
}

function renderHudTrackDropdown() {
  const container = document.getElementById("hud-track-list-container");
  if (!container) return;

  const currentTrackId = trackController && trackController.activeTrack ? trackController.activeTrack.id : null;

  let html = "";

  // 1. Configured custom tracks only (Item 5: no raw video files in dropdown)
  if (cachedTracks && cachedTracks.length > 0) {
    cachedTracks.forEach(t => {
      const isActive = currentTrackId === t.id;
      const startStr = pm5Hud.formatTime(t.start_time);
      const endStr = t.end_time > 0 ? pm5Hud.formatTime(t.end_time) : "End";
      const durationStr = t.end_time > t.start_time ? ` · ${pm5Hud.formatTime(t.end_time - t.start_time)}` : "";

      html += `
        <button class="hud-dropdown-item hud-track-select-item ${isActive ? 'active' : ''}" data-type="track" data-id="${t.id}" title="${t.name}">
          <img src="/api/media/thumbnail/${t.video_id}" alt="" class="hud-dropdown-item-thumb" onerror="this.style.display='none'">
          <div class="hud-dropdown-item-info">
            <span class="hud-dropdown-item-title">${t.name}</span>
            <span class="hud-dropdown-item-sub">${startStr} → ${endStr}${durationStr}</span>
          </div>
          <svg class="hud-dropdown-item-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      `;
    });
  }

  if (!html) {
    html = `<div style="padding: 1.25rem 0.75rem; text-align: center; color: var(--text-muted); font-size: 0.8rem;">No scenic tracks created yet. Create your first track in the Media Center!</div>`;
  }

  container.innerHTML = html;

  // Attach click listeners to items
  container.querySelectorAll(".hud-track-select-item").forEach(item => {
    item.addEventListener("click", () => {
      const id = item.dataset.id;
      const track = cachedTracks ? cachedTracks.find(t => t.id === id) : null;
      if (track) {
        loadTrackIntoCockpit(track, false);
        showHudToast(`Track: ${track.name}`);
      }
      closeHudDropdowns();
    });
  });
}

function renderHudAudioDropdown() {
  const container = document.getElementById("hud-audio-list-container");
  if (!container) return;

  const currentMode = audioEngine.mode;
  const currentUrl = audioEngine.customAudioUrl;

  // Sync volume slider
  const slider = document.getElementById("hud-audio-volume-slider");
  const volVal = document.getElementById("hud-volume-val");
  if (slider) {
    slider.value = audioEngine.volume;
  }
  if (volVal) {
    volVal.textContent = `${Math.round(audioEngine.volume * 100)}%`;
  }

  let html = "";

  // 1. Original Video Audio
  const isOriginal = currentMode === "original";
  html += `
    <button class="hud-dropdown-item hud-audio-select-item ${isOriginal ? 'active' : ''}" data-mode="original">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
      <div class="hud-dropdown-item-info">
        <span class="hud-dropdown-item-title">Original Video Audio</span>
        <span class="hud-dropdown-item-sub">Fixed 1.0× native speed</span>
      </div>
      <svg class="hud-dropdown-item-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
    </button>
  `;

  // 2. Mute
  const isMuted = currentMode === "mute";
  html += `
    <button class="hud-dropdown-item hud-audio-select-item ${isMuted ? 'active' : ''}" data-mode="mute">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>
      <div class="hud-dropdown-item-info">
        <span class="hud-dropdown-item-title">Mute All Audio</span>
        <span class="hud-dropdown-item-sub">Silent rowing workout</span>
      </div>
      <svg class="hud-dropdown-item-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
    </button>
  `;

  // 3. Custom soundtracks associated with active track (Item 4)
  const activeTrack = trackController && trackController.activeTrack && trackController.activeTrack.id ? trackController.activeTrack : null;
  const allowedSet = new Set();

  if (activeTrack) {
    if (Array.isArray(activeTrack.allowedAudios)) {
      activeTrack.allowedAudios.forEach(id => allowedSet.add(id));
    }
    if (activeTrack.defaultAudio && activeTrack.defaultAudio !== "original" && activeTrack.defaultAudio !== "mute") {
      allowedSet.add(activeTrack.defaultAudio);
    }
    const fullTrack = (cachedTracks || []).find(t => t.id === activeTrack.id);
    if (fullTrack) {
      if (Array.isArray(fullTrack.allowed_audios)) {
        fullTrack.allowed_audios.forEach(id => allowedSet.add(id));
      }
      if (fullTrack.default_audio && fullTrack.default_audio !== "original" && fullTrack.default_audio !== "mute") {
        allowedSet.add(fullTrack.default_audio);
      }
    }
  }

  const associatedAudios = (cachedLibrary.audio || []).filter(a => allowedSet.has(a.id));

  if (associatedAudios.length > 0) {
    html += `<div class="hud-dropdown-section-title" style="margin-top: 0.35rem;">Track Soundtracks</div>`;
    associatedAudios.forEach(a => {
      const audioUrl = `/api/media/audio/${a.id}`;
      const isActive = currentMode === "custom" && currentUrl === audioUrl;

      html += `
        <button class="hud-dropdown-item hud-audio-select-item ${isActive ? 'active' : ''}" data-mode="custom" data-url="${audioUrl}" data-title="${a.title}" title="${a.title}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <div class="hud-dropdown-item-info">
            <span class="hud-dropdown-item-title">${a.title}</span>
            <span class="hud-dropdown-item-sub">Soundtrack · 1.0×</span>
          </div>
          <svg class="hud-dropdown-item-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      `;
    });
  } else if (activeTrack) {
    html += `<div style="padding: 0.85rem 0.75rem; text-align: center; color: var(--text-muted); font-size: 0.8rem; line-height: 1.4;">No soundtracks associated with this track.<br><span style="font-size: 0.75rem; opacity: 0.75;">Assign music in the Media Center</span></div>`;
  } else {
    html += `<div style="padding: 0.85rem 0.75rem; text-align: center; color: var(--text-muted); font-size: 0.8rem; line-height: 1.4;">Select a scenic track to enable custom soundtracks.</div>`;
  }

  container.innerHTML = html;

  // Attach click listeners to items
  container.querySelectorAll(".hud-audio-select-item").forEach(item => {
    item.addEventListener("click", () => {
      const mode = item.dataset.mode;
      if (mode === "original") {
        audioEngine.setMode("original");
        updateAudioTrackDropdown("original");
        showHudToast("Audio: Original 1.0×");
      } else if (mode === "mute") {
        audioEngine.setMode("mute");
        updateAudioTrackDropdown("mute");
        showHudToast("Audio: Muted");
      } else if (mode === "custom") {
        const url = item.dataset.url;
        const title = item.dataset.title;
        const audioId = url.split("/").pop();
        const audioObj = cachedLibrary.audio ? cachedLibrary.audio.find(a => a.id === audioId) : null;
        const startT = audioObj ? (audioObj.start_time || 0) : 0;
        const endT = audioObj ? (audioObj.end_time || 0) : 0;
        audioEngine.setCustomAudio(url, title, startT, endT);
        updateAudioTrackDropdown(url);
        showHudToast(`Audio: ${title}`);
      }
      audioEngine.play();
      closeHudDropdowns();
    });
  });
}

// In-cockpit picker buttons and volume slider listeners
const btnHudTrackPicker = document.getElementById("btn-hud-track-picker");
const hudTrackDropdownMenu = document.getElementById("hud-track-dropdown-menu");
if (btnHudTrackPicker && hudTrackDropdownMenu) {
  btnHudTrackPicker.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = hudTrackDropdownMenu.style.display === "flex";
    closeHudDropdowns();
    if (!isOpen) {
      renderHudTrackDropdown();
      hudTrackDropdownMenu.style.display = "flex";
      btnHudTrackPicker.classList.add("active-dropdown");
      btnHudTrackPicker.setAttribute("aria-expanded", "true");
    }
  });
}

const btnHudAudioPicker = document.getElementById("btn-hud-audio-picker");
const hudAudioDropdownMenu = document.getElementById("hud-audio-dropdown-menu");
if (btnHudAudioPicker && hudAudioDropdownMenu) {
  btnHudAudioPicker.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = hudAudioDropdownMenu.style.display === "flex";
    closeHudDropdowns();
    if (!isOpen) {
      renderHudAudioDropdown();
      hudAudioDropdownMenu.style.display = "flex";
      btnHudAudioPicker.classList.add("active-dropdown");
      btnHudAudioPicker.setAttribute("aria-expanded", "true");
    }
  });
}

const hudAudioVolumeSlider = document.getElementById("hud-audio-volume-slider");
if (hudAudioVolumeSlider) {
  hudAudioVolumeSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    audioEngine.setVolume(val);
    const hudVolVal = document.getElementById("hud-volume-val");
    if (hudVolVal) hudVolVal.textContent = `${Math.round(val * 100)}%`;
    if (audioVolumeSlider) audioVolumeSlider.value = val;
  });
}

// Sync cockpit volume slider back if changed from outside
if (audioVolumeSlider) {
  audioVolumeSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    if (hudAudioVolumeSlider) hudAudioVolumeSlider.value = val;
    const hudVolVal = document.getElementById("hud-volume-val");
    if (hudVolVal) hudVolVal.textContent = `${Math.round(val * 100)}%`;
  });
}

// Keep dropdown open when interacting inside it
if (hudTrackDropdownMenu) {
  hudTrackDropdownMenu.addEventListener("click", (e) => e.stopPropagation());
}
if (hudAudioDropdownMenu) {
  hudAudioDropdownMenu.addEventListener("click", (e) => e.stopPropagation());
}

// Close dropdowns on outside click
document.addEventListener("click", (e) => {
  if (!e.target.closest(".hud-dropdown-wrapper")) {
    closeHudDropdowns();
  }
});

// Keyboard shortcuts for cockpit & fullscreen: 'T' = Cycle Theme, 'H' = Toggle HUD, 'F' = Fullscreen, 'Esc' = Close Dropdowns
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeHudDropdowns();
    if (modalRenameMedia && modalRenameMedia.classList.contains("open")) {
      closeRenameMediaModal();
      return;
    }
    if (modalAddAudioToTrack && modalAddAudioToTrack.classList.contains("open")) {
      closeAddAudioToTrackModal();
      return;
    }
    if (modalCreateTrack && modalCreateTrack.classList.contains("open")) {
      closeTrackModal();
      return;
    }
    if (modalTrimMedia && modalTrimMedia.classList.contains("open")) {
      closeTrimMediaModal();
      return;
    }
    return;
  }

  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  if (e.key === "t" || e.key === "T") {
    e.preventDefault();
    cycleTheme();
  } else if (e.key === "h" || e.key === "H") {
    e.preventDefault();
    toggleHudVisibility();
  } else if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    const btnFs = document.getElementById("hud-fullscreen-btn");
    if (btnFs) btnFs.click();
  }
});

// Initialize on page load
document.addEventListener("DOMContentLoaded", async () => {
  applyTheme(getActiveTheme());
  await loadLibraryUI();
  await loadTracksUI();

  // If there is a configured track, or a downloaded video, load it into cockpit
  if (cachedTracks && cachedTracks.length > 0) {
    loadTrackIntoCockpit(cachedTracks[0], false);
  } else if (cachedLibrary.videos && cachedLibrary.videos.length > 0) {
    const first = cachedLibrary.videos[0];
    loadVideoIntoCockpit(first.id, first.title, false);
  }

  pollDownloads();
});
