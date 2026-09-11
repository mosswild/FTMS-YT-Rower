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

    // Deadband rate quantization to prevent AVPlayer / hardware decoder stalls on iOS / mobile
    this.deadbandThreshold = options.deadbandThreshold !== undefined ? options.deadbandThreshold : 0.06;
    this.minUpdateIntervalMs = options.minUpdateIntervalMs !== undefined ? options.minUpdateIntervalMs : 1200;
    this.appliedRate = 1.0;
    this.lastRateUpdateTime = 0;

    this.isFixedSpeed = false;
    this.isWorkoutLive = false;
    this.smoothedRate = 1.0;
    this.targetRate = 1.0;
    this.lastStrokeTime = 0;
    this.isAutoPaused = false;
    this.watchdogInterval = null;

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
      if (typeof this.video.addEventListener === "function") {
        this.video.addEventListener("loadedmetadata", disableAudioTracks);
      }
    }

    this.startWatchdog();
  }

  setWorkoutLive(isLive) {
    this.isWorkoutLive = !!isLive;
    if (this.isWorkoutLive) {
      this.lastStrokeTime = Date.now();
      if (this.isFixedSpeed) {
        this.applyRate(1.0, true);
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
      this.applyRate(1.0, true);
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

  applyRate(roundedRate, force = false) {
    // Notify UI listener immediately so the speed badge (e.g. "1.12x") remains reactive to every stroke
    if (this.onRateChange) {
      this.onRateChange(roundedRate);
    }

    if (!this.video) return;

    // Quantize hardware playback rate to 0.05 steps (e.g. 0.90, 0.95, 1.00, 1.05, 1.10)
    // to shield mobile AVPlayer hardware clocks from tiny continuous variations
    const quantizedRate = Math.round(roundedRate * 20) / 20;

    const now = Date.now();
    const rateDiff = Math.abs(quantizedRate - this.appliedRate);
    const timeSinceLastUpdate = now - this.lastRateUpdateTime;

    // Check whether hardware playbackRate should be updated:
    // 1. Forced update (fixed speed toggle, workout start/stop, auto-pause transitions)
    // 2. Rate reaches absolute min (0.3) or max (2.5) boundaries
    // 3. Significant speed change (>= deadbandThreshold) AND at least minUpdateIntervalMs (1200ms) has elapsed
    const isAtBoundary = (roundedRate <= this.minRate && this.appliedRate !== this.minRate) ||
                         (roundedRate >= this.maxRate && this.appliedRate !== this.maxRate);

    const shouldUpdate = force ||
      isAtBoundary ||
      (rateDiff >= this.deadbandThreshold && timeSinceLastUpdate >= this.minUpdateIntervalMs);

    if (shouldUpdate) {
      this.appliedRate = quantizedRate;
      this.lastRateUpdateTime = now;
      if (this.video.playbackRate !== quantizedRate) {
        this.video.playbackRate = quantizedRate;
      }
    }

    if (this.isAutoPaused || this.video.paused) {
      this.resumeVideo();
    }
  }

  updateCadence(currentSpm) {
    if (this.isFixedSpeed) {
      // Ambient fixed speed: video plays at constant 1.0x rate during live workout
      this.lastStrokeTime = Date.now();
      this.applyRate(1.0, false);
      if (this.isWorkoutLive && (this.isAutoPaused || (this.video && this.video.paused))) {
        this.resumeVideo();
      }
      return;
    }

    if (currentSpm <= 0) {
      // Stroke rate is 0 or stopped: smoothly decelerate playback rate to simulate boat glide drag
      if (!this.isAutoPaused && this.smoothedRate > this.minRate) {
        this.smoothedRate = Math.max(this.minRate, this.smoothedRate * 0.88);
        const roundedRate = Math.round(this.smoothedRate * 100) / 100;
        this.applyRate(roundedRate, false);
      }
      return;
    }

    const now = Date.now();
    this.lastStrokeTime = now;

    // Target Rate = Current SPM / Baseline SPM
    this.targetRate = currentSpm / this.baselineSpm;

    // SmoothedRate = alpha * TargetRate + (1 - alpha) * PrevSmoothedRate
    this.smoothedRate = (this.alpha * this.targetRate) + ((1 - this.alpha) * this.smoothedRate);

    // Strictly clamp between minRate (0.3) and maxRate (2.5)
    const clampedRate = Math.max(this.minRate, Math.min(this.maxRate, this.smoothedRate));
    const roundedRate = Math.round(clampedRate * 100) / 100;

    this.applyRate(roundedRate, false);
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
