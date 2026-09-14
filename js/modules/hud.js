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
      resistanceBadge: document.getElementById("hud-resistance-badge"),
      resistanceVal: document.getElementById("hud-resistance-val"),
      videoTitle: document.getElementById("hud-video-title"),
      audioBadge: document.getElementById("hud-audio-badge"),
      autoPauseBadge: document.getElementById("hud-autopause-badge"),
      fullscreenBtn: document.getElementById("hud-fullscreen-btn"),
      noticeToast: document.getElementById("hud-notice-toast"),
      workoutBar: document.getElementById("hud-workout-bar"),
      workoutStepBadge: document.getElementById("workout-step-badge"),
      workoutStepTitle: document.getElementById("workout-step-title"),
      workoutTargetSummary: document.getElementById("workout-target-summary"),
      workoutCountdown: document.getElementById("workout-step-countdown"),
      workoutProgressFill: document.getElementById("workout-progress-fill"),
      workoutCueToast: document.getElementById("workout-cue-toast"),
      targetSpm: document.getElementById("hud-target-spm"),
      targetSplit: document.getElementById("hud-target-split"),
      targetWatts: document.getElementById("hud-target-watts"),
      targetHr: document.getElementById("hud-target-hr"),
      workoutBadge: document.getElementById("hud-workout-badge"),
      frozenDist: document.getElementById("hud-frozen-dist"),
      frozenTime: document.getElementById("hud-frozen-time"),
      cellDistance: document.getElementById("hud-cell-distance"),
      cellTime: document.getElementById("hud-cell-time")
    };

    this.distanceOffset = 0;
    this.timeOffset = 0;
    this.rawDistance = 0;
    this.rawElapsedSeconds = 0;
    this.isSessionPaused = false;
    this.pausedAtRawSeconds = null;
    this.pausedAtRawDistance = null;
    this.toastTimeout = null;
    this.userScale = "auto";
    this.isWorkoutBarVisible = false;

    this.setupInactivityWatchdog();
    this.setupFullscreen();
  }

  pauseSession() {
    this.isSessionPaused = true;
    this.pausedAtRawSeconds = this.rawElapsedSeconds;
    this.pausedAtRawDistance = this.rawDistance;
    if (this.elements.frozenDist) this.elements.frozenDist.style.display = "inline-flex";
    if (this.elements.frozenTime) this.elements.frozenTime.style.display = "inline-flex";
    if (this.elements.cellDistance) this.elements.cellDistance.classList.add("cell-frozen");
    if (this.elements.cellTime) this.elements.cellTime.classList.add("cell-frozen");
  }

  resumeSession() {
    if (this.isSessionPaused) {
      this.isSessionPaused = false;
      if (this.pausedAtRawSeconds !== null && this.rawElapsedSeconds > this.pausedAtRawSeconds) {
        this.timeOffset += (this.rawElapsedSeconds - this.pausedAtRawSeconds);
      }
      if (this.pausedAtRawDistance !== null && this.rawDistance > this.pausedAtRawDistance) {
        this.distanceOffset += (this.rawDistance - this.pausedAtRawDistance);
      }
      this.pausedAtRawSeconds = null;
      this.pausedAtRawDistance = null;
      if (this.elements.frozenDist) this.elements.frozenDist.style.display = "none";
      if (this.elements.frozenTime) this.elements.frozenTime.style.display = "none";
      if (this.elements.cellDistance) this.elements.cellDistance.classList.remove("cell-frozen");
      if (this.elements.cellTime) this.elements.cellTime.classList.remove("cell-frozen");
    }
  }

  resetOffsets(dist, time) {
    this.isSessionPaused = false;
    this.pausedAtRawSeconds = null;
    this.pausedAtRawDistance = null;
    if (this.elements.frozenDist) this.elements.frozenDist.style.display = "none";
    if (this.elements.frozenTime) this.elements.frozenTime.style.display = "none";
    if (this.elements.cellDistance) this.elements.cellDistance.classList.remove("cell-frozen");
    if (this.elements.cellTime) this.elements.cellTime.classList.remove("cell-frozen");
    this.distanceOffset = dist !== undefined ? dist : this.rawDistance;
    this.timeOffset = time !== undefined ? time : this.rawElapsedSeconds;
    if (this.elements.distance) this.elements.distance.textContent = "0";
    if (this.elements.time) this.elements.time.textContent = "00:00";
  }

  resetDistance() {
    this.distanceOffset = this.rawDistance;
    if (this.elements.distance) this.elements.distance.textContent = "0";
  }

  resetTime() {
    this.timeOffset = this.rawElapsedSeconds;
    if (this.elements.time) this.elements.time.textContent = "00:00";
  }

  updateResistance(level) {
    if (this.elements.resistanceBadge && this.elements.resistanceVal) {
      if (level !== undefined && level !== null && level > 0) {
        this.elements.resistanceBadge.style.display = "inline-flex";
        this.elements.resistanceVal.textContent = `Lvl ${level}`;
      }
    }
  }

  showNotice(msg, durationMs = 2500) {
    if (!this.elements.noticeToast) return;
    this.elements.noticeToast.textContent = msg;
    this.elements.noticeToast.style.display = "block";
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.elements.noticeToast.style.display = "none";
    }, durationMs);
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

    if (data.distance !== undefined) {
      this.rawDistance = data.distance;
      const effectiveDist = (this.isSessionPaused && this.pausedAtRawDistance !== null)
        ? this.pausedAtRawDistance
        : data.distance;
      const displayDistance = Math.max(0, effectiveDist - this.distanceOffset);
      if (this.elements.distance) {
        this.elements.distance.textContent = Math.round(displayDistance).toLocaleString();
      }
    }

    if (data.elapsedSeconds !== undefined) {
      this.rawElapsedSeconds = data.elapsedSeconds;
      const effectiveSec = (this.isSessionPaused && this.pausedAtRawSeconds !== null)
        ? this.pausedAtRawSeconds
        : data.elapsedSeconds;
      const displaySeconds = Math.max(0, effectiveSec - this.timeOffset);
      if (this.elements.time) {
        this.elements.time.textContent = this.formatTime(displaySeconds);
      }
    }

    if (data.resistance !== undefined) {
      this.updateResistance(data.resistance);
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

  updateSpeedMultiplier(rate, isFixed = false, zoneName = null) {
    if (this.elements.speedBadge) {
      const textEl = document.getElementById("hud-speed-badge-text") || this.elements.speedBadge;
      if (isFixed) {
        textEl.textContent = "1.00× [Ambient]";
        this.elements.speedBadge.className = "speed-badge normal hud-picker-btn";
        return;
      }

      if (zoneName && zoneName !== "Continuous") {
        textEl.textContent = `${rate.toFixed(2)}× [${zoneName}]`;
      } else {
        textEl.textContent = `${rate.toFixed(2)}×`;
      }
      
      // Color tint based on speed multiplier
      if (rate > 1.2) {
        this.elements.speedBadge.className = "speed-badge high hud-picker-btn";
      } else if (rate < 0.9) {
        this.elements.speedBadge.className = "speed-badge low hud-picker-btn";
      } else {
        this.elements.speedBadge.className = "speed-badge normal hud-picker-btn";
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

  setScale(scale) {
    if (!this.container) return;
    this.userScale = scale || "auto";
    this.applyEffectiveScale();
  }

  applyEffectiveScale() {
    if (!this.container) return;
    this.container.classList.remove("hud-scale-compact", "hud-scale-large", "hud-scale-standard");
    if (this.userScale === "compact") {
      this.container.classList.add("hud-scale-compact");
    } else if (this.userScale === "large") {
      this.container.classList.add("hud-scale-large");
    } else if (this.userScale === "standard") {
      this.container.classList.add("hud-scale-standard");
    } else if (this.userScale === "auto" && this.isWorkoutBarVisible) {
      // When Auto/Adaptive is active and interval ribbon is visible, visually condense to compact mode
      this.container.classList.add("hud-scale-compact");
    }
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

  setWorkoutMode(title) {
    if (this.elements.workoutBadge) {
      this.elements.workoutBadge.textContent = title ? `Program: ${title}` : "Program: Free Row";
    }
  }

  showWorkoutBar(show = true) {
    this.isWorkoutBarVisible = !!show;
    if (this.elements.workoutBar) {
      this.elements.workoutBar.style.display = show ? "block" : "none";
    }
    this.applyEffectiveScale();
    if (!show) {
      this.clearWorkoutCompliance();
    }
  }

  setWorkoutStep(step, index, total) {
    if (!this.elements.workoutBar) return;
    this.showWorkoutBar(true);

    if (this.elements.workoutStepBadge) {
      this.elements.workoutStepBadge.textContent = (step.type || "WORK").toUpperCase();
      this.elements.workoutStepBadge.className = `workout-type-badge ${step.type || "work"}`;
    }

    if (this.elements.workoutStepTitle) {
      this.elements.workoutStepTitle.textContent = step.title || `Interval ${index + 1}/${total}`;
    }

    if (this.elements.workoutTargetSummary) {
      const parts = [];
      if (step.targets) {
        if (step.targets.spm) {
          const sMin = Array.isArray(step.targets.spm) ? step.targets.spm[0] : step.targets.spm;
          const sMax = Array.isArray(step.targets.spm) ? (step.targets.spm[1] !== undefined ? step.targets.spm[1] : sMin) : sMin;
          parts.push(sMin === sMax ? `${sMin} SPM` : `${sMin}-${sMax} SPM`);
        }
        if (step.targets.split_formatted) {
          parts.push(`${step.targets.split_formatted[0]}-${step.targets.split_formatted[1]}`);
        } else if (Array.isArray(step.targets.split)) {
          parts.push(step.targets.split.join(" - "));
        }
        if (step.targets.watts) {
          const wMin = Array.isArray(step.targets.watts) ? step.targets.watts[0] : step.targets.watts;
          const wMax = Array.isArray(step.targets.watts) ? (step.targets.watts[1] !== undefined ? step.targets.watts[1] : wMin) : wMin;
          parts.push(wMin === wMax ? `${wMin}W` : `${wMin}-${wMax}W`);
        }
        if (step.targets.hr) {
          const hrMin = Array.isArray(step.targets.hr) ? step.targets.hr[0] : step.targets.hr;
          const hrMax = Array.isArray(step.targets.hr) ? (step.targets.hr[1] !== undefined ? step.targets.hr[1] : hrMin) : hrMin;
          const zoneVal = step.targets.hr_zone ? (Array.isArray(step.targets.hr_zone) ? step.targets.hr_zone[0] : step.targets.hr_zone) : null;
          const zoneStr = zoneVal ? ` (Zone ${zoneVal})` : "";
          parts.push(hrMin === hrMax ? `${hrMin} BPM${zoneStr}` : `${hrMin}-${hrMax} BPM${zoneStr}`);
        } else if (step.targets.hr_zone) {
          const zoneVal = Array.isArray(step.targets.hr_zone) ? step.targets.hr_zone[0] : step.targets.hr_zone;
          parts.push(`HR Zone ${zoneVal}`);
        }
      }
      if (parts.length > 0) {
        this.elements.workoutTargetSummary.textContent = `Target: ${parts.join(" • ")}`;
        this.elements.workoutTargetSummary.style.display = "inline-block";
      } else {
        this.elements.workoutTargetSummary.style.display = "none";
      }
    }
  }

  updateWorkoutProgress(progress) {
    if (this.elements.workoutCountdown && progress.remainingText) {
      if (this.elements.workoutCountdown.textContent !== progress.remainingText) {
        this.elements.workoutCountdown.textContent = progress.remainingText;
      }
    }
    if (this.elements.workoutProgressFill && progress.percent !== undefined) {
      const scaleVal = Math.min(1, Math.max(0, (progress.percent || 0) / 100));
      const transformStr = `scaleX(${scaleVal})`;
      if (this.elements.workoutProgressFill.style.transform !== transformStr) {
        this.elements.workoutProgressFill.style.transform = transformStr;
      }
    }
  }

  showWorkoutCue(text, durationMs = 4500) {
    if (!this.elements.workoutCueToast) return;
    this.elements.workoutCueToast.textContent = `💡 ${text}`;
    this.elements.workoutCueToast.style.display = "block";
    clearTimeout(this.cueTimeout);
    this.cueTimeout = setTimeout(() => {
      this.elements.workoutCueToast.style.display = "none";
    }, durationMs);
  }

  setWorkoutCompliance(compliance = {}) {
    this.updateTargetChip(this.elements.targetSpm, compliance.spm);
    this.updateTargetChip(this.elements.targetSplit, compliance.split);
    this.updateTargetChip(this.elements.targetWatts, compliance.watts);
    this.updateTargetChip(this.elements.targetHr, compliance.hr);
  }

  updateTargetChip(chipEl, comp) {
    if (!chipEl) return;
    if (!comp) {
      if (chipEl.style.display !== "none") {
        chipEl.style.display = "none";
        chipEl._lastStatus = null;
        chipEl._lastTarget = null;
        chipEl._lastPaused = null;
      }
      return;
    }
    const status = comp.status;
    const target = comp.target;
    const isPaused = !!comp.isPaused;

    if (chipEl._lastStatus === status && chipEl._lastTarget === target && chipEl._lastPaused === isPaused && chipEl.style.display === "inline-flex") {
      return;
    }
    chipEl._lastStatus = status;
    chipEl._lastTarget = target;
    chipEl._lastPaused = isPaused;

    if (chipEl.style.display !== "inline-flex") {
      chipEl.style.display = "inline-flex";
    }
    const nextClass = `pm5-target-chip ${status}${isPaused ? " paused" : ""}`;
    if (chipEl.className !== nextClass) {
      chipEl.className = nextClass;
    }
    const nextTitle = isPaused ? `Paused — Out of Target (${target})` : `Target: ${target}`;
    if (chipEl.title !== nextTitle) {
      chipEl.title = nextTitle;
    }
    const nextContent = status === "in-target"
      ? `● ${target}`
      : (status === "under-target" ? (isPaused ? `⏸ ▲ ${target}` : `▲ ${target}`) : `▼ ${target}`);
    if (chipEl.innerHTML !== nextContent) {
      chipEl.innerHTML = nextContent;
    }
  }

  clearWorkoutCompliance() {
    [this.elements.targetSpm, this.elements.targetSplit, this.elements.targetWatts, this.elements.targetHr].forEach(chip => {
      if (chip) {
        chip.style.display = "none";
        chip._lastStatus = null;
        chip._lastTarget = null;
        chip._lastPaused = null;
      }
    });
  }
}
