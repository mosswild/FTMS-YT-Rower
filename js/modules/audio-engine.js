/**
 * Decoupled Audio Pipeline Engine
 * Strictly muted scenic video + independent soundtrack audio fixed at 1.0x native speed.
 */

export class AudioEngine {
  constructor(videoElement, audioElement, options = {}) {
    this.video = videoElement;
    this.audio = audioElement;
    this.onStatusChange = options.onStatusChange || null;

    // Scenic video is strictly muted
    if (this.video) {
      this.video.muted = true;
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
        this.audio.volume = this.volume;
        this.audio.muted = false;
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
    this.audio.volume = this.volume;
    this.audio.muted = false;

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

  handleAutoPause(isPaused) {
    if (!this.audio || this.mode === "mute") return;

    if (this.pauseOnStrokeStop) {
      if (isPaused) {
        this.pause();
      } else {
        this.play();
      }
    } else {
      // Audio should always continue at 1.0x when strokes pause,
      // but ensure it starts if it wasn't playing yet
      if (!isPaused && !this.isPlaying) {
        this.play();
      }
    }
  }

  setVolume(volumeFraction) {
    this.volume = Math.max(0, Math.min(1, volumeFraction));
    if (this.audio) {
      this.audio.volume = this.volume;
      this.audio.muted = (this.volume === 0);
    }
    this.emitStatus();
  }

  getVolume() {
    return this.volume;
  }
}
