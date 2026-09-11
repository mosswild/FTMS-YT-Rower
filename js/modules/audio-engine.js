/**
 * Decoupled Audio Pipeline Engine
 * Strictly muted scenic video + independent soundtrack audio fixed at 1.0x native speed.
 */

export class AudioEngine {
  constructor(videoElement, audioElement, options = {}) {
    this.video = videoElement;
    this.audio = audioElement;
    this.onStatusChange = options.onStatusChange || null;

    // Scenic video is strictly muted; disable audio time-stretching DSP overhead on WebKit / Chromium
    if (this.video) {
      this.video.muted = true;
      this.video.preservesPitch = false;
      this.video.webkitPreservesPitch = false;
      this.video.mozPreservesPitch = false;
    }

    // Soundtrack audio always plays at fixed native 1.0x speed
    if (this.audio) {
      this.audio.playbackRate = 1.0;
      this.audio.preservesPitch = true;
      this.audio.volume = 1.0;
      this.audio.muted = false;
      this.audio.loop = false; // We handle custom trim looping in timeupdate / ended
    }

    this.mode = "original"; // "original" | "custom" | "mute"
    this.currentVideoId = null;
    this.currentSrc = "";
    this.currentTitle = "Original Video Audio";
    this.customAudioUrl = null;
    this.customAudioTitle = null;
    this.pauseOnStrokeStop = false;
    this.volume = 1.0;
    this.isPlaying = false;

    // Dynamic Cadence-Proportional Audio Volume
    this.cadenceVolumeModulation = options.cadenceVolumeModulation !== undefined ? options.cadenceVolumeModulation : true;
    this.isAmbient = options.isAmbient || false;
    this.baselineSpm = options.baselineSpm || 20;
    this.lastCadenceSpm = 20;
    this.currentCadenceScale = (this.cadenceVolumeModulation && !this.isAmbient) ? this.calculateCadenceVolumeScale(this.lastCadenceSpm) : 1.0;
    this.targetCadenceScale = this.currentCadenceScale;
    this.volumeRampInterval = null;

    this.startTime = 0;
    this.endTime = 0;
    this.videoStartTime = 0;
    this.videoEndTime = 0;
    this.activeStart = 0;
    this.activeEnd = 0;

    if (this.audio) {
      this.audio.addEventListener("playing", () => {
        this.isPlaying = true;
        this.emitStatus();
      });
      this.audio.addEventListener("pause", () => {
        this.isPlaying = false;
        this.emitStatus();
      });
      this.audio.addEventListener("timeupdate", () => {
        if (this.mode === "mute") return;
        const start = this.activeStart || 0;
        const rawEnd = this.activeEnd || 0;
        const dur = this.audio.duration || 0;
        const end = (rawEnd > 0 && rawEnd <= dur) ? rawEnd : dur;
        const cur = this.audio.currentTime;

        // Loop back to trim start if we reach or exceed the trim end point
        if (end > start && cur >= end) {
          this.audio.currentTime = start;
          return;
        }

        // If playing before start boundary, jump to start
        if (start > 0 && cur < start - 0.25) {
          this.audio.currentTime = start;
          return;
        }
      });
      this.audio.addEventListener("ended", () => {
        // Loop audio from active trim start point
        const start = this.activeStart || 0;
        this.audio.currentTime = start;
        this.play();
      });
    }
  }

  emitStatus(isBlocked = false) {
    if (this.onStatusChange) {
      this.onStatusChange({
        playing: this.isPlaying,
        blocked: isBlocked,
        mode: this.mode,
        title: this.currentTitle,
        volume: this.volume,
        muted: this.audio ? this.audio.muted : false,
      });
    }
  }

  setPauseOnStrokeStop(enabled) {
    this.pauseOnStrokeStop = !!enabled;
  }

  setMode(mode) {
    this.mode = mode;
    this.applyAudioSource(true);
  }

  setScenicVideo(videoId, title = "", startTime = 0, endTime = 0) {
    this.currentVideoId = videoId;
    this.videoStartTime = Math.max(0, startTime || 0);
    this.videoEndTime = Math.max(0, endTime || 0);
    if (this.mode === "original") {
      this.applyAudioSource(true);
    }
  }

  setCustomAudio(url, title = "Custom Soundtrack", startTime = 0, endTime = 0) {
    this.customAudioUrl = url;
    this.customAudioTitle = title;
    this.startTime = Math.max(0, startTime || 0);
    this.endTime = Math.max(0, endTime || 0);
    this.mode = "custom";
    this.applyAudioSource(true);
  }

  applyAudioSource(autoPlay = false) {
    if (!this.audio) return;

    if (this.mode === "mute") {
      this.pause();
      this.emitStatus();
      return;
    }

    let targetSrc = "";
    let targetTitle = "Soundtrack";
    let targetStart = 0;
    let targetEnd = 0;

    if (this.mode === "original") {
      if (this.currentVideoId) {
        targetSrc = `/api/media/audio/${this.currentVideoId}`;
        targetTitle = "Original Video Audio";
        targetStart = this.videoStartTime || 0;
        targetEnd = this.videoEndTime || 0;
      }
    } else if (this.mode === "custom") {
      targetSrc = this.customAudioUrl || "";
      targetTitle = this.customAudioTitle || "Custom Track";
      targetStart = this.startTime || 0;
      targetEnd = this.endTime || 0;
    }

    if (targetSrc) {
      const isNewSrc = (this.currentSrc !== targetSrc);
      this.currentSrc = targetSrc;
      this.currentTitle = targetTitle;
      this.activeStart = targetStart;
      this.activeEnd = targetEnd;

      const enforceStart = () => {
        if (this.activeStart > 0) {
          try {
            this.audio.currentTime = this.activeStart;
          } catch (e) {}
        }
      };

      if (isNewSrc) {
        this.audio.src = targetSrc;
        this.audio.playbackRate = 1.0;
        this.applyEffectiveVolume();
        this.audio.addEventListener("loadedmetadata", enforceStart, { once: true });
        this.audio.addEventListener("canplay", enforceStart, { once: true });
      } else {
        enforceStart();
      }

      if (autoPlay) {
        this.play();
      }
    }
  }

  async play() {
    if (!this.audio || this.mode === "mute" || !this.currentSrc) return;
    this.audio.playbackRate = 1.0;
    this.applyEffectiveVolume();

    // Enforce activeStart on play if current time is outside boundaries
    const start = this.activeStart || 0;
    const rawEnd = this.activeEnd || 0;
    const dur = this.audio.duration || 0;
    const end = (rawEnd > 0 && rawEnd <= dur) ? rawEnd : dur;
    const cur = this.audio.currentTime;

    if (cur < start - 0.25 || (end > start && cur >= end)) {
      try {
        this.audio.currentTime = start;
      } catch (err) {}
    }

    try {
      this.applyEffectiveVolume();
      if (this.cadenceVolumeModulation) {
        this.startVolumeRamping();
      }
      await this.audio.play();
      this.isPlaying = true;
      this.emitStatus(false);
    } catch (err) {
      console.warn("[AudioEngine] Playback trigger prevented by browser policy:", err);
      this.isPlaying = false;
      this.emitStatus(true);
    }
  }

  pause() {
    if (this.audio) {
      this.audio.pause();
      this.isPlaying = false;
      this.stopVolumeRamping();
      this.emitStatus(false);
    }
  }

  restart() {
    if (this.audio) {
      this.audio.currentTime = this.activeStart || 0;
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  setCadenceVolumeModulation(enabled) {
    this.cadenceVolumeModulation = !!enabled;
    if (!this.cadenceVolumeModulation || this.isAmbient) {
      this.currentCadenceScale = 1.0;
      this.targetCadenceScale = 1.0;
      this.applyEffectiveVolume();
      this.stopVolumeRamping();
    } else {
      this.targetCadenceScale = this.calculateCadenceVolumeScale(this.lastCadenceSpm);
      if (this.isPlaying) {
        this.startVolumeRamping();
      }
    }
  }

  setAmbientMode(isAmbient) {
    this.isAmbient = !!isAmbient;
    if (this.isAmbient) {
      this.currentCadenceScale = 1.0;
      this.targetCadenceScale = 1.0;
      this.applyEffectiveVolume();
      this.stopVolumeRamping();
    } else if (this.cadenceVolumeModulation) {
      this.targetCadenceScale = this.calculateCadenceVolumeScale(this.lastCadenceSpm);
      if (this.isPlaying) {
        this.startVolumeRamping();
      }
    }
  }

  setBaselineSpm(baseline) {
    if (baseline > 0) {
      this.baselineSpm = baseline;
      if (this.cadenceVolumeModulation && !this.isAmbient) {
        this.targetCadenceScale = this.calculateCadenceVolumeScale(this.lastCadenceSpm);
      }
    }
  }

  calculateCadenceVolumeScale(spm) {
    if (spm <= 0) return 0.55; // Resting / auto-paused volume: gentle, unobtrusive ambient bed
    const ratio = spm / this.baselineSpm;
    if (ratio <= 1.0) {
      // Range from 0 SPM (0.55) to baseline SPM (1.00)
      return 0.55 + 0.45 * ratio;
    } else {
      // Range from baseline SPM (1.00) up to 1.5 ratio (1.20)
      return 1.00 + 0.20 * Math.min(1.0, (ratio - 1.0) / 0.5);
    }
  }

  updateCadence(spm) {
    this.lastCadenceSpm = spm !== undefined ? spm : this.lastCadenceSpm;
    if (!this.cadenceVolumeModulation || this.isAmbient) return;
    this.targetCadenceScale = this.calculateCadenceVolumeScale(spm);
    if (!this.volumeRampInterval && this.isPlaying) {
      this.startVolumeRamping();
    }
  }

  applyEffectiveVolume() {
    if (!this.audio) return;
    const scale = (this.cadenceVolumeModulation && !this.isAmbient) ? this.currentCadenceScale : 1.0;
    const effVol = Math.max(0, Math.min(1.0, this.volume * scale));
    this.audio.volume = effVol;
    this.audio.muted = (effVol === 0 || this.volume === 0);
  }

  startVolumeRamping() {
    if (this.volumeRampInterval) return;
    this.volumeRampInterval = setInterval(() => {
      if (!this.cadenceVolumeModulation || this.isAmbient || !this.audio || !this.isPlaying) {
        if (!this.isPlaying || this.isAmbient) {
          this.stopVolumeRamping();
        }
        return;
      }
      const diff = this.targetCadenceScale - this.currentCadenceScale;
      if (Math.abs(diff) < 0.01) {
        this.currentCadenceScale = this.targetCadenceScale;
      } else {
        this.currentCadenceScale += diff * 0.12;
      }
      this.applyEffectiveVolume();
    }, 100);
  }

  stopVolumeRamping() {
    if (this.volumeRampInterval) {
      clearInterval(this.volumeRampInterval);
      this.volumeRampInterval = null;
    }
  }

  handleAutoPause(isPaused) {
    if (!this.audio || this.mode === "mute") return;

    if (this.pauseOnStrokeStop) {
      if (isPaused) {
        this.pause();
      } else {
        this.play();
      }
    } else {
      if (this.cadenceVolumeModulation && !this.isAmbient) {
        if (isPaused) {
          this.updateCadence(0);
        } else {
          this.updateCadence(this.lastCadenceSpm || this.baselineSpm);
        }
      }
      // Audio should always continue at 1.0x when strokes pause,
      // but ensure it starts if it wasn't playing yet
      if (!isPaused && !this.isPlaying) {
        this.play();
      }
    }
  }

  setVolume(volumeFraction) {
    this.volume = Math.max(0, Math.min(1, volumeFraction));
    this.applyEffectiveVolume();
    this.emitStatus();
  }

  getVolume() {
    return this.volume;
  }
}
