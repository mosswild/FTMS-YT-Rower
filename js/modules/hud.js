/**
 * Concept2 PM5-Style Telemetry HUD Controller
 * Manages high-contrast digital overlays, fullscreen handling, and 4-second inactivity auto-fade.
 */

export class PM5Hud {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.idleTimeout = null;
    this.isIdle = false;
    this.isActiveSession = false;

    // Element references
    this.elements = {
      spm: document.getElementById("hud-spm"),
      spmIndicator: document.getElementById("hud-spm-pulse"),
      split: document.getElementById("hud-split"),
      watts: document.getElementById("hud-watts"),
      distance: document.getElementById("hud-distance"),
      time: document.getElementById("hud-time"),
      hr: document.getElementById("hud-hr"),
      hrIcon: document.getElementById("hud-hr-icon"),
      speedBadge: document.getElementById("hud-speed-badge"),
      videoTitle: document.getElementById("hud-video-title"),
      audioBadge: document.getElementById("hud-audio-badge"),
      autoPauseBadge: document.getElementById("hud-autopause-badge"),
      fullscreenBtn: document.getElementById("hud-fullscreen-btn"),
    };

    this.setupInactivityWatchdog();
    this.setupFullscreen();
  }

  updateMetrics(data) {
    if (data.strokeRate !== undefined && this.elements.spm) {
      this.elements.spm.textContent = data.strokeRate > 0 ? Math.round(data.strokeRate) : "--";
      if (data.strokeRate > 0 && this.elements.spmIndicator) {
        this.elements.spmIndicator.classList.add("pulse");
        setTimeout(() => this.elements.spmIndicator.classList.remove("pulse"), 400);
      }
    }

    if (data.instantaneousPace !== undefined && this.elements.split) {
      this.elements.split.textContent = data.instantaneousPace > 0 ? this.formatSplit(data.instantaneousPace) : "--:--.-";
    }

    if (data.watts !== undefined && this.elements.watts) {
      this.elements.watts.textContent = data.watts > 0 ? Math.round(data.watts) : "--";
    }

    if (data.distance !== undefined && this.elements.distance) {
      this.elements.distance.textContent = Math.round(data.distance).toLocaleString();
    }

    if (data.elapsedSeconds !== undefined && this.elements.time) {
      this.elements.time.textContent = this.formatTime(data.elapsedSeconds);
    }

    if (data.heartRate !== undefined && this.elements.hr) {
      this.elements.hr.textContent = data.heartRate > 0 ? Math.round(data.heartRate) : "--";
      if (data.heartRate > 0 && this.elements.hrIcon) {
        this.elements.hrIcon.classList.add("beating");
      } else if (this.elements.hrIcon) {
        this.elements.hrIcon.classList.remove("beating");
      }
    }
  }

  updateSpeedMultiplier(rate, isFixed = false) {
    if (this.elements.speedBadge) {
      if (isFixed) {
        this.elements.speedBadge.textContent = "1.00× (Ambient)";
        this.elements.speedBadge.className = "speed-badge normal";
        return;
      }

      this.elements.speedBadge.textContent = `${rate.toFixed(2)}×`;
      
      // Color tint based on speed multiplier
      if (rate > 1.2) {
        this.elements.speedBadge.className = "speed-badge high";
      } else if (rate < 0.8) {
        this.elements.speedBadge.className = "speed-badge low";
      } else {
        this.elements.speedBadge.className = "speed-badge normal";
      }
    }
  }

  setAutoPause(isPaused) {
    if (this.elements.autoPauseBadge) {
      this.elements.autoPauseBadge.style.display = isPaused ? "inline-flex" : "none";
    }
  }

  setVideoTitle(title) {
    if (this.elements.videoTitle) {
      this.elements.videoTitle.textContent = title || "Scenic Row";
    }
  }

  setAudioMode(mode, customTitle) {
    if (this.elements.audioBadge) {
      const modeLabels = {
        original: "Audio: Original 1.0×",
        custom: customTitle ? `Audio: ${customTitle}` : "Audio: Custom Track 1.0×",
        mute: "Audio: Muted",
      };
      this.elements.audioBadge.textContent = modeLabels[mode] || (customTitle ? `Audio: ${customTitle}` : "Audio 1.0×");
    }
  }

  setActiveSession(isActive) {
    this.isActiveSession = isActive;
    if (!isActive) {
      this.wakeUp();
    }
  }

  setupInactivityWatchdog() {
    const onUserActivity = () => {
      this.wakeUp();
      if (this.isActiveSession) {
        clearTimeout(this.idleTimeout);
        this.idleTimeout = setTimeout(() => {
          this.container.classList.add("hud-idle");
          this.isIdle = true;
        }, 4000);
      }
    };

    this.container.addEventListener("mousemove", onUserActivity);
    this.container.addEventListener("mousedown", onUserActivity);
    this.container.addEventListener("touchstart", onUserActivity);
    this.container.addEventListener("keydown", onUserActivity);
  }

  wakeUp() {
    clearTimeout(this.idleTimeout);
    this.container.classList.remove("hud-idle");
    this.isIdle = false;
  }

  setupFullscreen() {
    if (!this.elements.fullscreenBtn) return;

    const updateButtonUI = (isFs) => {
      this.elements.fullscreenBtn.innerHTML = isFs
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
      this.elements.fullscreenBtn.setAttribute("title", isFs ? "Exit Fullscreen" : "Toggle Fullscreen");
    };

    const toggleFullscreenState = (active) => {
      this.container.classList.toggle("is-fullscreen", active);
      document.body.classList.toggle("in-fullscreen", active);
      document.documentElement.classList.toggle("in-fullscreen", active);
      updateButtonUI(active);

      // Attempt screen orientation lock if supported on mobile
      if (active && window.screen && window.screen.orientation && window.screen.orientation.lock) {
        window.screen.orientation.lock("landscape").catch(() => {});
      }
    };

    const isNativeFullscreenActive = () => {
      return !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
    };

    const enterFullscreen = async () => {
      // Engage CSS fullscreen immediately (ensures instant mobile layout coverage)
      toggleFullscreenState(true);

      const target = this.container;
      const rfs = target.requestFullscreen ||
        target.webkitRequestFullscreen ||
        target.mozRequestFullScreen ||
        target.msRequestFullscreen ||
        document.documentElement.requestFullscreen ||
        document.documentElement.webkitRequestFullscreen;

      if (rfs) {
        try {
          const res = rfs.call(target);
          if (res && res.catch) {
            await res.catch((err) => {
              console.warn("[Fullscreen] Native request rejected, using mobile CSS fallback:", err);
            });
          }
        } catch (err) {
          console.warn("[Fullscreen] Native call error, using mobile CSS fallback:", err);
        }
      }
    };

    const exitFullscreen = async () => {
      toggleFullscreenState(false);

      if (isNativeFullscreenActive()) {
        const efs = document.exitFullscreen ||
          document.webkitExitFullscreen ||
          document.mozCancelFullScreen ||
          document.msExitFullscreen;
        if (efs) {
          try {
            const res = efs.call(document);
            if (res && res.catch) await res.catch(() => {});
          } catch (err) {}
        }
      }
    };

    this.elements.fullscreenBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const active = isNativeFullscreenActive() || this.container.classList.contains("is-fullscreen");
      if (active) {
        exitFullscreen();
      } else {
        enterFullscreen();
      }
    });

    const onFsChange = () => {
      const isFs = isNativeFullscreenActive();
      if (!isFs) {
        if (this.container.classList.contains("is-fullscreen") && !this.isMobileDevice()) {
          toggleFullscreenState(false);
        }
      } else {
        toggleFullscreenState(true);
      }
    };

    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    document.addEventListener("mozfullscreenchange", onFsChange);
    document.addEventListener("MSFullscreenChange", onFsChange);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.container.classList.contains("is-fullscreen")) {
        exitFullscreen();
      }
    });
  }

  isMobileDevice() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
  }

  formatTime(totalSeconds) {
    const s = Math.floor(totalSeconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hrs}:${remMins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  formatSplit(totalSeconds) {
    if (!totalSeconds || totalSeconds <= 0) return "--:--.-";
    const mins = Math.floor(totalSeconds / 60);
    const remSecs = (totalSeconds % 60).toFixed(1);
    const paddedSecs = parseFloat(remSecs) < 10 ? `0${remSecs}` : remSecs;
    return `${mins}:${paddedSecs}`;
  }
}
