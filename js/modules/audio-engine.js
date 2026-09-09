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
      this.audio.loop = true;
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
        if (this.mode === "custom" && this.endTime > 0 && this.endTime > this.startTime) {
          if (this.audio.currentTime >= this.endTime) {
            this.audio.currentTime = this.startTime;
          }
        }
      });
      this.audio.addEventListener("ended", () => {
        // Loop audio from start trim point if set
        this.audio.currentTime = (this.mode === "custom" && this.startTime > 0) ? this.startTime : 0;
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

  setScenicVideo(videoId, title = "") {
    this.currentVideoId = videoId;
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

    if (this.mode === "original") {
      if (this.currentVideoId) {
        targetSrc = `/api/media/audio/${this.currentVideoId}`;
        targetTitle = "Original Video Audio";
      }
    } else if (this.mode === "custom") {
      targetSrc = this.customAudioUrl || "";
      targetTitle = this.customAudioTitle || "Custom Track";
    }

    if (targetSrc) {
      if (this.currentSrc !== targetSrc) {
        this.currentSrc = targetSrc;
        this.currentTitle = targetTitle;
        this.audio.src = targetSrc;
        this.audio.playbackRate = 1.0;
        this.audio.volume = this.volume;
        this.audio.muted = false;
        if (this.mode === "custom" && this.startTime > 0) {
          this.audio.currentTime = this.startTime;
        }
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
