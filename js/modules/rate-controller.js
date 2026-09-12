/**
 * Rate Controller for Scenic Video Playback Synchronization
 * Implements exponential rate smoothing and inactivity auto-pause watchdog.
 */

export class RateController {
  constructor(videoElement, options = {}) {
    this.video = videoElement;
    if (this.video) {
      // Scenic video is strictly muted; disable audio time-stretching DSP overhead on WebKit / Chromium
      this.video.preservesPitch = false;
      this.video.webkitPreservesPitch = false;
      this.video.mozPreservesPitch = false;
    }
    this.baselineSpm = options.baselineSpm || 20;
    this.alpha = options.alpha !== undefined ? options.alpha : 0.25;
    this.minRate = options.minRate || 0.3;
    this.maxRate = options.maxRate || 2.5;
    this.autoPauseTimeoutMs = options.autoPauseTimeoutMs || 3500;

    // Speed synchronization mode: "zones" (default), "ambient", "continuous"
    this.speedMode = options.speedMode || "zones";
    this.zoneDwellMs = options.zoneDwellMs || 3000; // 3.0s sustained cadence required before shifting zones
    this.pendingZoneRate = 1.0;
    this.pendingZoneStartTime = 0;
    this.lastSpm = 0;

    // Continuous mode deadband rate quantization to prevent AVPlayer stalls
    this.deadbandThreshold = options.deadbandThreshold !== undefined ? options.deadbandThreshold : 0.08;
    this.minUpdateIntervalMs = options.minUpdateIntervalMs !== undefined ? options.minUpdateIntervalMs : 1500;
    this.appliedRate = 1.0;
    this.lastRateUpdateTime = 0;

    this.isFixedSpeed = false;
    this.isWorkoutLive = false;
    this.smoothedRate = 1.0;
    this.targetRate = 1.0;
    this.lastStrokeTime = 0;
    this.isAutoPaused = false;
    this.watchdogInterval = null;
    this.pendingPlaybackRate = null;

    this.onRateChange = options.onRateChange || null;
    this.onAutoPauseState = options.onAutoPauseState || null;

    if (this.video) {
      const disableAudioTracks = () => {
        try {
          if (this.video.audioTracks) {
            for (let i = 0; i < this.video.audioTracks.length; i++) {
              this.video.audioTracks[i].enabled = false;
            }
          }
        } catch (e) {}
      };
      disableAudioTracks();

      const onBufferReady = () => {
        if (this.pendingPlaybackRate !== null && this.video && this.video.readyState >= 2) {
          try {
            this.video.playbackRate = this.pendingPlaybackRate;
          } catch (e) {}
          this.pendingPlaybackRate = null;
        }
      };

      if (typeof this.video.addEventListener === "function") {
        this.video.addEventListener("loadedmetadata", disableAudioTracks);
        this.video.addEventListener("loadeddata", onBufferReady);
        this.video.addEventListener("canplay", onBufferReady);
      }
    }

    this.startWatchdog();
  }

  setSpeedMode(mode) {
    if (["zones", "ambient", "continuous"].includes(mode)) {
      this.speedMode = mode;
      if (mode === "ambient" || this.isFixedSpeed) {
        this.applyHardwareRate(1.0, true);
        if (this.onRateChange) this.onRateChange(1.0, "Ambient", 1.0);
      } else if (mode === "zones") {
        const zone = this.getZoneRate(this.lastSpm > 0 ? this.lastSpm : this.baselineSpm);
        this.pendingZoneRate = zone.rate;
        this.pendingZoneStartTime = Date.now();
        this.applyHardwareRate(zone.rate, true);
        if (this.onRateChange) this.onRateChange(this.smoothedRate, zone.name, zone.rate);
      } else if (mode === "continuous") {
        this.applyRate(this.smoothedRate, true);
      }
    }
  }

  getZoneRate(spm) {
    if (spm <= 0) return { rate: 0.85, name: "Glide" };
    if (spm < 18) return { rate: 0.85, name: "Recovery" };
    if (spm <= 23) return { rate: 1.00, name: "Base" };
    if (spm <= 27) return { rate: 1.25, name: "Tempo" };
    return { rate: 1.50, name: "Sprint" };
  }

  setWorkoutLive(isLive) {
    this.isWorkoutLive = !!isLive;
    if (this.isWorkoutLive) {
      this.lastStrokeTime = Date.now();
      if (this.isFixedSpeed || this.speedMode === "ambient") {
        this.applyHardwareRate(1.0, true);
        this.resumeVideo();
      }
    } else {
      this.pauseVideo(true);
    }
  }

  setFixedSpeed(isFixed) {
    this.isFixedSpeed = !!isFixed;
    if (this.isFixedSpeed) {
      this.smoothedRate = 1.0;
      this.targetRate = 1.0;
      this.applyHardwareRate(1.0, true);
      if (this.onRateChange) this.onRateChange(1.0, "Ambient", 1.0);
      if (this.isWorkoutLive && (this.isAutoPaused || (this.video && this.video.paused))) {
        this.resumeVideo();
      }
    }
  }

  setBaselineSpm(baseline) {
    if (baseline > 0) {
      this.baselineSpm = baseline;
    }
  }

  setAlpha(alpha) {
    if (alpha >= 0.05 && alpha <= 1.0) {
      this.alpha = alpha;
    }
  }

  applyHardwareRate(rate, force = false) {
    if (!this.video) return;
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastRateUpdateTime;

    if (force || timeSinceLastUpdate >= this.minUpdateIntervalMs || this.appliedRate !== rate) {
      this.appliedRate = rate;
      this.lastRateUpdateTime = now;
      if (this.video.playbackRate !== rate) {
        if (this.video.readyState >= 2) {
          try {
            this.video.playbackRate = rate;
            this.pendingPlaybackRate = null;
          } catch (e) {}
        } else {
          this.pendingPlaybackRate = rate;
        }
      }
    }

    if (this.isAutoPaused || this.video.paused) {
      this.resumeVideo();
    }
  }

  applyRate(roundedRate, force = false) {
    // Notify UI listener immediately so the speed badge remains reactive to every stroke
    if (this.onRateChange) {
      this.onRateChange(roundedRate, "Continuous", roundedRate);
    }

    if (!this.video) return;

    // Quantize hardware playback rate to 0.05 steps
    const quantizedRate = Math.round(roundedRate * 20) / 20;

    const now = Date.now();
    const rateDiff = Math.abs(quantizedRate - this.appliedRate);
    const timeSinceLastUpdate = now - this.lastRateUpdateTime;

    const isAtBoundary = (roundedRate <= this.minRate && this.appliedRate !== this.minRate) ||
                         (roundedRate >= this.maxRate && this.appliedRate !== this.maxRate);

    const shouldUpdate = force ||
      isAtBoundary ||
      (rateDiff >= this.deadbandThreshold && timeSinceLastUpdate >= this.minUpdateIntervalMs);

    if (shouldUpdate) {
      this.appliedRate = quantizedRate;
      this.lastRateUpdateTime = now;
      if (this.video.playbackRate !== quantizedRate) {
        if (this.video.readyState >= 2) {
          try {
            this.video.playbackRate = quantizedRate;
            this.pendingPlaybackRate = null;
          } catch (e) {}
        } else {
          this.pendingPlaybackRate = quantizedRate;
        }
      }
    }

    if (this.isAutoPaused || this.video.paused) {
      this.resumeVideo();
    }
  }

  updateCadence(currentSpm) {
    this.lastSpm = currentSpm;
    if (this.isFixedSpeed || this.speedMode === "ambient") {
      this.lastStrokeTime = Date.now();
      this.applyHardwareRate(1.0, false);
      if (this.onRateChange) this.onRateChange(1.0, "Ambient", 1.0);
      if (this.isWorkoutLive && (this.isAutoPaused || (this.video && this.video.paused))) {
        this.resumeVideo();
      }
      return;
    }

    if (currentSpm <= 0) {
      // Stroke rate is 0 or stopped: decelerate
      if (!this.isAutoPaused && this.smoothedRate > this.minRate) {
        this.smoothedRate = Math.max(this.minRate, this.smoothedRate * 0.88);
        const roundedRate = Math.round(this.smoothedRate * 100) / 100;
        if (this.speedMode === "zones") {
          if (this.onRateChange) this.onRateChange(roundedRate, "Glide", 0.85);
          const now = Date.now();
          if (this.pendingZoneRate !== 0.85) {
            this.pendingZoneRate = 0.85;
            this.pendingZoneStartTime = now;
          } else if (now - this.pendingZoneStartTime >= this.zoneDwellMs && this.appliedRate !== 0.85) {
            this.applyHardwareRate(0.85);
          }
        } else {
          this.applyRate(roundedRate, false);
        }
      }
      return;
    }

    const now = Date.now();
    this.lastStrokeTime = now;

    // Target Rate = Current SPM / Baseline SPM
    this.targetRate = currentSpm / this.baselineSpm;
    this.smoothedRate = (this.alpha * this.targetRate) + ((1 - this.alpha) * this.smoothedRate);
    const continuousRate = Math.round(Math.max(this.minRate, Math.min(this.maxRate, this.smoothedRate)) * 100) / 100;

    if (this.speedMode === "zones") {
      const zone = this.getZoneRate(currentSpm);

      // Instantly update decoupled UI speed badge
      if (this.onRateChange) {
        this.onRateChange(continuousRate, zone.name, zone.rate);
      }

      // Hysteresis & Dwell time checking for hardware video playback rate:
      // Only switch zone if sustained for zoneDwellMs (default 3000ms)
      if (zone.rate !== this.pendingZoneRate) {
        this.pendingZoneRate = zone.rate;
        this.pendingZoneStartTime = now;
      } else if (now - this.pendingZoneStartTime >= this.zoneDwellMs && this.appliedRate !== zone.rate) {
        this.applyHardwareRate(zone.rate);
      }

      if (this.isAutoPaused || (this.video && this.video.paused)) {
        this.resumeVideo();
      }
      return;
    }

    // Continuous mode
    this.applyRate(continuousRate, false);
  }

  resumeVideo() {
    this.isAutoPaused = false;
    if (this.video && this.video.paused) {
      this.video.play().catch(e => console.warn("[RateController] Autoplay error:", e));
    }
    if (this.onAutoPauseState) {
      this.onAutoPauseState(false);
    }
  }

  pauseVideo(force = false) {
    // If in ambient fixed speed mode, ignore auto-pause requests during a live workout unless explicitly forced
    if (this.isFixedSpeed && !force && this.isWorkoutLive) {
      return;
    }
    this.isAutoPaused = true;
    if (this.video && !this.video.paused) {
      this.video.pause();
    }
    if (this.onAutoPauseState) {
      this.onAutoPauseState(true);
    }
  }

  startWatchdog() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(() => {
      // Ambient fixed speed: never auto-pause when rower pauses or stops
      if (this.isFixedSpeed) return;

      if (this.lastStrokeTime === 0) return;
      const elapsedSinceStroke = Date.now() - this.lastStrokeTime;
      
      if (elapsedSinceStroke > this.autoPauseTimeoutMs && !this.isAutoPaused) {
        // No stroke notifications arrived for > 3.5 seconds
        console.log(`[RateController] Inactivity detected (${elapsedSinceStroke}ms > ${this.autoPauseTimeoutMs}ms). Auto-pausing video.`);
        this.pauseVideo();
      }
    }, 250);
  }

  destroy() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }
}
