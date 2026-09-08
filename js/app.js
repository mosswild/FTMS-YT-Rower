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

  pm5Hud.setAudioMode(status.mode);

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
    pm5Hud.updateSpeedMultiplier(rate);
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
      if (state === "active") {
        workoutBtn.textContent = "Finish Workout";
        workoutBtn.className = "btn btn-danger";
        pm5Hud.setActiveSession(true);
      } else {
        workoutBtn.textContent = "Start Workout";
        workoutBtn.className = "btn btn-success";
        pm5Hud.setActiveSession(false);
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
      videosContainer.innerHTML = cachedLibrary.videos.map(v => `
        <div class="media-card">
          <div class="media-thumb-box">
            ${v.thumbnail ? `<img src="${v.thumbnail}" class="media-thumb-img" alt="${v.title}">` : `<div class="media-thumb-fallback">Video</div>`}
          </div>
          <div class="media-card-body">
            <div>
              <div class="media-title" title="${v.title}">${v.title}</div>
              <div class="media-meta-line">${v.duration ? `${Math.floor(v.duration / 60)}m ${v.duration % 60}s` : ""} • ${(v.size_bytes / (1024*1024)).toFixed(1)} MB</div>
            </div>
            <div class="media-actions">
              <button class="btn btn-primary btn-sm btn-load-video" data-id="${v.id}" data-title="${v.title}">Load Video</button>
              <button class="btn btn-secondary btn-sm btn-delete-media" data-type="video" data-id="${v.id}">Delete</button>
            </div>
          </div>
        </div>
      `).join("");

      videosContainer.querySelectorAll(".btn-load-video").forEach(btn => {
        btn.addEventListener("click", () => {
          loadVideoIntoCockpit(btn.dataset.id, btn.dataset.title, true);
          switchView("cockpit");
        });
      });

      videosContainer.querySelectorAll(".btn-delete-media").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (confirm("Delete this video?")) {
            await mediaManager.deleteMedia("video", btn.dataset.id);
            loadLibraryUI();
          }
        });
      });
    }
  }

  if (audioContainer) {
    if (!cachedLibrary.audio || cachedLibrary.audio.length === 0) {
      audioContainer.innerHTML = `<div style="grid-column: 1/-1; color: var(--text-dim); text-align: center; padding: 2rem;">No custom soundtracks downloaded yet.</div>`;
    } else {
      audioContainer.innerHTML = cachedLibrary.audio.map(a => `
        <div class="media-card">
          <div class="media-card-body">
            <div>
              <div class="media-title" title="${a.title}">${a.title}</div>
              <div class="media-meta-line">${a.duration ? `${Math.floor(a.duration / 60)}m ${a.duration % 60}s` : ""} • ${(a.size_bytes / (1024*1024)).toFixed(1)} MB</div>
            </div>
            <div class="media-actions">
              <button class="btn btn-primary btn-sm btn-load-audio" data-id="${a.id}" data-title="${a.title}">Use as Music</button>
              <button class="btn btn-secondary btn-sm btn-delete-media" data-type="audio" data-id="${a.id}">Delete</button>
            </div>
          </div>
        </div>
      `).join("");

      audioContainer.querySelectorAll(".btn-load-audio").forEach(btn => {
        btn.addEventListener("click", () => {
          const audioUrl = `/api/media/audio/${btn.dataset.id}`;
          audioEngine.setCustomAudio(audioUrl, btn.dataset.title);
          updateAudioTrackDropdown(audioUrl);
          switchView("cockpit");
        });
      });

      audioContainer.querySelectorAll(".btn-delete-media").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (confirm("Delete this audio track?")) {
            await mediaManager.deleteMedia("audio", btn.dataset.id);
            loadLibraryUI();
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

function loadVideoIntoCockpit(videoId, title, autoPlay = false, isTrack = false) {
  videoEl.src = `/api/media/video/${videoId}`;
  videoEl.load();
  pm5Hud.setVideoTitle(title);
  audioEngine.setScenicVideo(videoId, title);
  sessionTracker.setMeta(videoId, audioEngine.mode);
  if (!isTrack) {
    trackController.clearTrack();
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

        return `
          <div class="track-card">
            <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
              <img src="/api/media/thumbnail/${t.video_id}" alt="${t.name}" style="width: 100px; height: 56px; object-fit: cover; border-radius: 6px; background: #000; flex-shrink: 0; border: 1px solid var(--surface-border);">
              <div style="flex: 1; min-width: 0;">
                <div class="track-card-title">${t.name}</div>
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
        btn.addEventListener("click", async () => {
          if (confirm("Delete this track configuration?")) {
            await fetch(`/api/tracks/${btn.dataset.id}`, { method: "DELETE" });
            loadTracksUI();
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

  // Set audio based on track default
  if (track.default_audio === "original") {
    audioEngine.setMode("original");
    updateAudioTrackDropdown("original", track.allowed_audios);
  } else if (track.default_audio === "mute") {
    audioEngine.setMode("mute");
    updateAudioTrackDropdown("mute", track.allowed_audios);
  } else {
    const audioUrl = `/api/media/audio/${track.default_audio}`;
    audioEngine.setCustomAudio(audioUrl, "Track Soundtrack");
    updateAudioTrackDropdown(audioUrl, track.allowed_audios);
  }

  // Ensure paused and waiting for strokes
  rateController.pauseVideo();
  rateController.smoothedRate = rateController.minRate;
  pm5Hud.updateSpeedMultiplier(0);
  pm5Hud.setAutoPause(true);
  audioEngine.pause();

  if (autoPlay) {
    rateController.resumeVideo();
    audioEngine.play();
  }
}

// Track Transport Controls in Cockpit
if (btnTrackRestart) {
  btnTrackRestart.addEventListener("click", () => {
    trackController.restart();
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

function populateTrackModalDropdowns() {
  if (selectTrackVideo) {
    selectTrackVideo.innerHTML = (cachedLibrary.videos || []).map(v => `
      <option value="${v.id}">${v.title}</option>
    `).join("");
  }

  if (selectTrackDefaultAudio) {
    let opts = `
      <option value="original">Original Video Audio</option>
      <option value="mute">Muted</option>
    `;
    (cachedLibrary.audio || []).forEach(a => {
      opts += `<option value="${a.id}">${a.title}</option>`;
    });
    selectTrackDefaultAudio.innerHTML = opts;
  }

  if (containerTrackAllowedAudios) {
    if (!cachedLibrary.audio || cachedLibrary.audio.length === 0) {
      containerTrackAllowedAudios.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-dim);">No standalone soundtracks downloaded yet.</span>`;
    } else {
      containerTrackAllowedAudios.innerHTML = cachedLibrary.audio.map(a => `
        <label style="display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem; color: var(--text-main); cursor: pointer; padding: 0.25rem 0.4rem; border-radius: 4px; background: rgba(255,255,255,0.03);">
          <span style="display: flex; align-items: center; gap: 0.5rem;">
            <input type="checkbox" name="allowed_audio" value="${a.id}" checked style="accent-color: var(--accent-blue);">
            <span>${a.title}</span>
          </span>
          <button type="button" class="btn btn-secondary btn-sm btn-sample-audio" data-id="${a.id}" style="padding: 0.15rem 0.5rem; font-size: 0.72rem; line-height: 1.2;">▶ Sample</button>
        </label>
      `).join("");

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
    modalPreviewAudio.currentTime = 0;
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
  if (currentSrc !== url) {
    modalPreviewAudio.src = url;
    modalPreviewAudio.load();
    if (modalAudioScrubber) modalAudioScrubber.value = 0;
    if (modalAudioTime) modalAudioTime.textContent = "0:00 / 0:00";
  }

  if (autoPlay) {
    modalPreviewAudio.play()
      .then(() => setModalAudioPlayState(true))
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
    if (!isModalAudioScrubbing && modalAudioScrubber && modalPreviewAudio.duration) {
      modalAudioScrubber.value = (modalPreviewAudio.currentTime / modalPreviewAudio.duration) * 100;
    }
    if (modalAudioTime) {
      modalAudioTime.textContent = `${pm5Hud.formatTime(modalPreviewAudio.currentTime)} / ${pm5Hud.formatTime(modalPreviewAudio.duration || 0)}`;
    }
  });

  modalPreviewAudio.addEventListener("ended", () => {
    setModalAudioPlayState(false);
  });
}

if (modalAudioScrubber) {
  modalAudioScrubber.addEventListener("mousedown", () => { isModalAudioScrubbing = true; });
  modalAudioScrubber.addEventListener("touchstart", () => { isModalAudioScrubbing = true; });
  modalAudioScrubber.addEventListener("input", (e) => {
    isModalAudioScrubbing = true;
    if (modalPreviewAudio && modalPreviewAudio.duration) {
      const targetTime = (parseFloat(e.target.value) / 100) * modalPreviewAudio.duration;
      if (modalAudioTime) {
        modalAudioTime.textContent = `${pm5Hud.formatTime(targetTime)} / ${pm5Hud.formatTime(modalPreviewAudio.duration)}`;
      }
    }
  });
  modalAudioScrubber.addEventListener("change", (e) => {
    if (modalPreviewAudio && modalPreviewAudio.duration) {
      modalPreviewAudio.currentTime = (parseFloat(e.target.value) / 100) * modalPreviewAudio.duration;
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

  populateTrackModalDropdowns();
  updateTrackVideoPreview(selectTrackVideo ? selectTrackVideo.value : null);
  updateModalAudioSource(false);

  modalCreateTrack.classList.add("open");
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
    const parseTime = (val) => {
      if (!val) return 0;
      const s = String(val).trim();
      if (s.includes(":")) {
        const parts = s.split(":").map(Number);
        if (parts.length === 2) return (parts[0] * 60) + (parts[1] || 0);
        if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + (parts[2] || 0);
      }
      const num = parseFloat(s);
      return isNaN(num) ? 0 : Math.max(0, num);
    };
    const startTime = parseTime(document.getElementById("input-track-start").value);
    const endTime = parseTime(document.getElementById("input-track-end").value);
    const defaultAudio = selectTrackDefaultAudio.value;

    const allowedAudios = [];
    containerTrackAllowedAudios.querySelectorAll('input[name="allowed_audio"]:checked').forEach(cb => {
      allowedAudios.push(cb.value);
    });

    const payload = {
      id: trackId,
      name,
      video_id: videoId,
      start_time: startTime,
      end_time: endTime,
      default_audio: defaultAudio,
      allowed_audios: allowedAudios,
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
        updateAudioTrackDropdown(null, payload.allowed_audios);
      }
    } catch (err) {
      alert("Error saving track: " + err.message);
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
    } catch (err) {
      alert("Error starting download: " + err.message);
    }
  });
}

function pollDownloads() {
  mediaManager.startPolling((tasks) => {
    if (!tasksContainer) return;
    tasksContainer.innerHTML = tasks.map(t => `
      <div class="download-task-card">
        <div class="task-info-line">
          <strong>${t.title || t.url}</strong>
          <span>${t.status} (${t.progress}%) ${t.speed ? `• ${t.speed}` : ""} ${t.eta ? `• ETA: ${t.eta}` : ""}</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${t.progress}%"></div>
        </div>
        ${t.error ? `<div style="color: var(--accent-rose); font-size: 0.8rem; margin-top: 0.3rem;">${t.error}</div>` : ""}
      </div>
    `).join("");

    if (tasks.some(t => t.status === "completed")) {
      loadLibraryUI();
      loadTracksUI();
    }
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
        btn.addEventListener("click", async () => {
          if (confirm("Delete this workout record?")) {
            await fetch(`/api/sessions/${btn.dataset.id}`, { method: "DELETE" });
            loadHistoryUI();
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
if (simBtn) {
  simBtn.addEventListener("click", () => {
    if (simulator.isRunning) {
      simulator.stop();
      simBtn.textContent = "Start Simulator";
      simBtn.className = "btn btn-secondary";
      updateRowerStatus(false, "Simulator Stopped");
      if (videoEl) videoEl.pause();
      audioEngine.pause();
    } else {
      simulator.start();
      simBtn.textContent = "Stop Simulator";
      simBtn.className = "btn btn-primary";
      updateRowerStatus(true, `Sim: ${simulator.mode === "dynamic" ? "Dynamic Program" : "Manual"}`);

      if (!videoEl.src || videoEl.src === "" || videoEl.src.endsWith("/")) {
        if (cachedLibrary.videos && cachedLibrary.videos.length > 0) {
          const first = cachedLibrary.videos[0];
          loadVideoIntoCockpit(first.id, first.title, true);
        }
      } else {
        videoEl.play().catch(e => console.warn(e));
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
      rateController.pauseVideo();
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
      audioEngine.setCustomAudio(val, selectedOption.textContent);
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
    if (sessionTracker.state === "active") {
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

// Quick cycle button listener
const btnQuickTheme = document.getElementById("btn-quick-theme");
if (btnQuickTheme) {
  btnQuickTheme.addEventListener("click", () => {
    const current = getActiveTheme();
    const curIdx = THEMES.indexOf(current);
    const nextIdx = (curIdx + 1) % THEMES.length;
    applyTheme(THEMES[nextIdx]);
  });
}

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
