/**
 * Rate Controller for Scenic Video Playback Synchronization
 * Implements exponential rate smoothing and inactivity auto-pause watchdog.
 */

export class RateController {
  constructor(videoElement, options = {}) {
    this.video = videoElement;
    this.baselineSpm = options.baselineSpm || 20;
    this.alpha = options.alpha !== undefined ? options.alpha : 0.25;
    this.minRate = options.minRate || 0.3;
    this.maxRate = options.maxRate || 2.5;
    this.autoPauseTimeoutMs = options.autoPauseTimeoutMs || 3500;

    this.isFixedSpeed = false;
    this.smoothedRate = 1.0;
    this.targetRate = 1.0;
    this.lastStrokeTime = 0;
    this.isAutoPaused = false;
    this.watchdogInterval = null;

    this.onRateChange = options.onRateChange || null;
    this.onAutoPauseState = options.onAutoPauseState || null;

    this.startWatchdog();
  }

  setFixedSpeed(isFixed) {
    this.isFixedSpeed = !!isFixed;
    if (this.isFixedSpeed) {
      this.smoothedRate = 1.0;
      this.targetRate = 1.0;
      if (this.video) {
        this.video.playbackRate = 1.0;
      }
      if (this.onRateChange) {
        this.onRateChange(1.0);
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

  updateCadence(currentSpm) {
    if (this.isFixedSpeed) {
      // Ambient fixed speed: video plays at constant 1.0x rate regardless of stroke rate
      if (currentSpm > 0) {
        this.lastStrokeTime = Date.now();
        if (this.video) {
          this.video.playbackRate = 1.0;
          if (this.isAutoPaused || this.video.paused) {
            this.resumeVideo();
          }
        }
        if (this.onRateChange) {
          this.onRateChange(1.0);
        }
      }
      return;
    }

    if (currentSpm <= 0) {
      // Stroke rate is 0 or stopped: smoothly decelerate playback rate to simulate boat glide drag
      if (!this.isAutoPaused && this.smoothedRate > this.minRate) {
        this.smoothedRate = Math.max(this.minRate, this.smoothedRate * 0.88);
        const roundedRate = Math.round(this.smoothedRate * 100) / 100;
        if (this.video && !this.video.paused) {
          this.video.playbackRate = roundedRate;
        }
        if (this.onRateChange) {
          this.onRateChange(roundedRate);
        }
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

    if (this.video) {
      this.video.playbackRate = roundedRate;
      if (this.isAutoPaused || this.video.paused) {
        this.resumeVideo();
      }
    }

    if (this.onRateChange) {
      this.onRateChange(roundedRate);
    }
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

  pauseVideo() {
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
