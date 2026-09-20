/**
 * Display Keep-Awake Controller
 * Dual-tier sleep prevention for Desktop, Android, iOS Safari, and Standalone PWA.
 * 1. Standard W3C Screen Wake Lock API (Desktop Chrome, Edge, Safari 16.4+ on HTTPS/localhost)
 * 2. Active Inline NoSleep MP4 loop with silent AAC audio + Silent Audio loop for iOS WebKit & HTTP LAN
 *    (iOS WebKit ignores muted or culled offscreen videos for sleep prevention;
 *     in-viewport active media assertions instruct Apple AVPlayer to hold system display assertion).
 */

const NO_SLEEP_MP4_URI = "data:video/mp4;base64,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";

const SILENT_WAV_URI = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

export class KeepAwake {
  constructor(options = {}) {
    this.enabled = true; // Keep enabled by default to prevent sleep on mobile devices
    this.wakeLockSentinel = null;
    this.keepAwakeVideo = null;
    this.keepAwakeAudio = null;
    this.heartbeatInterval = null;
    this.onStateChange = options.onStateChange || null;

    this.initMediaElements();
    this.bindVisibilityChange();
    this.bindUserInteractionGestures();
    this.startHeartbeat();

    // Initial activation attempt
    this.acquire();
  }

  initMediaElements() {
    if (typeof document === "undefined") return;

    // 1. Silent inline video element (placed inside viewport to avoid WebKit culling)
    if (!this.keepAwakeVideo) {
      this.keepAwakeVideo = document.createElement("video");
      this.keepAwakeVideo.setAttribute("title", "FTMS Keep Awake");
      this.keepAwakeVideo.setAttribute("playsinline", "true");
      this.keepAwakeVideo.setAttribute("webkit-playsinline", "true");
      this.keepAwakeVideo.setAttribute("preload", "auto");
      this.keepAwakeVideo.setAttribute("aria-hidden", "true");
      this.keepAwakeVideo.tabIndex = -1;

      // Positioned within the viewport coordinate system so WebKit compositor treats it as active
      this.keepAwakeVideo.style.position = "fixed";
      this.keepAwakeVideo.style.bottom = "0px";
      this.keepAwakeVideo.style.right = "0px";
      this.keepAwakeVideo.style.width = "2px";
      this.keepAwakeVideo.style.height = "2px";
      this.keepAwakeVideo.style.opacity = "0.02";
      this.keepAwakeVideo.style.pointerEvents = "none";
      this.keepAwakeVideo.style.zIndex = "-1";

      const source = document.createElement("source");
      source.src = NO_SLEEP_MP4_URI;
      source.type = "video/mp4";
      this.keepAwakeVideo.appendChild(source);

      // Jitter seek loop to prevent AVPlayer from treating playback as frozen
      this.keepAwakeVideo.addEventListener("timeupdate", () => {
        if (this.keepAwakeVideo && this.keepAwakeVideo.currentTime > 0.5) {
          this.keepAwakeVideo.currentTime = Math.random() * 0.3;
        }
      });

      this.keepAwakeVideo.loop = true;

      const appendVideo = () => {
        if (this.keepAwakeVideo && !this.keepAwakeVideo.parentNode && document.body) {
          document.body.appendChild(this.keepAwakeVideo);
        }
      };

      if (document.body) {
        appendVideo();
      } else {
        window.addEventListener("DOMContentLoaded", appendVideo, { once: true });
      }
    }

    // 2. Silent looping audio element as auxiliary active media session for iOS
    if (!this.keepAwakeAudio) {
      this.keepAwakeAudio = document.createElement("audio");
      this.keepAwakeAudio.src = SILENT_WAV_URI;
      this.keepAwakeAudio.loop = true;
      this.keepAwakeAudio.preload = "auto";
      this.keepAwakeAudio.style.display = "none";
      this.keepAwakeAudio.tabIndex = -1;

      const appendAudio = () => {
        if (this.keepAwakeAudio && !this.keepAwakeAudio.parentNode && document.body) {
          document.body.appendChild(this.keepAwakeAudio);
        }
      };

      if (document.body) {
        appendAudio();
      } else {
        window.addEventListener("DOMContentLoaded", appendAudio, { once: true });
      }
    }
  }

  bindUserInteractionGestures() {
    if (typeof window === "undefined") return;

    // Any touch, click, or pointer interaction actively re-affirms media playback & wake lock
    const handleGesture = () => {
      if (this.enabled) {
        this.acquire();
      }
    };

    window.addEventListener("pointerdown", handleGesture, { passive: true });
    window.addEventListener("touchstart", handleGesture, { passive: true });
    window.addEventListener("click", handleGesture, { passive: true });
  }

  bindVisibilityChange() {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.enabled) {
        this.acquire();
      }
    });
  }

  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      if (this.enabled && typeof document !== "undefined" && document.visibilityState === "visible") {
        this.acquire();
      }
    }, 10000);
  }

  async acquire() {
    if (!this.enabled) return;

    // 1. Attempt native Screen Wake Lock API (works on Desktop, Android, and iOS 16.4+ on HTTPS/localhost)
    if (typeof navigator !== "undefined" && "wakeLock" in navigator && !this.wakeLockSentinel) {
      try {
        this.wakeLockSentinel = await navigator.wakeLock.request("screen");
        this.wakeLockSentinel.addEventListener("release", () => {
          this.wakeLockSentinel = null;
          if (this.enabled && typeof document !== "undefined" && document.visibilityState === "visible") {
            setTimeout(() => {
              if (this.enabled) this.acquire();
            }, 1000);
          }
          if (this.onStateChange) this.onStateChange(this.getState());
        });
        if (this.onStateChange) this.onStateChange(this.getState());
      } catch (err) {
        // Native wakeLock may reject on non-HTTPS origins or power save mode
      }
    }

    // 2. Play silent inline video (iOS Safari / WebKit sleep prevention)
    if (this.keepAwakeVideo && this.keepAwakeVideo.paused) {
      try {
        const p = this.keepAwakeVideo.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {});
        }
      } catch (e) {}
    }

    // 3. Play silent audio element (Reinforces AVPlayer media assertion on WebKit)
    if (this.keepAwakeAudio && this.keepAwakeAudio.paused) {
      try {
        const p = this.keepAwakeAudio.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {});
        }
      } catch (e) {}
    }

    if (this.onStateChange) this.onStateChange(this.getState());
  }

  enable() {
    this.enabled = true;
    this.acquire();
  }

  preArm() {
    this.enable();
  }

  async disable() {
    this.enabled = false;
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch (e) {}
      this.wakeLockSentinel = null;
    }
    if (this.keepAwakeVideo && !this.keepAwakeVideo.paused) {
      try {
        this.keepAwakeVideo.pause();
      } catch (e) {}
    }
    if (this.keepAwakeAudio && !this.keepAwakeAudio.paused) {
      try {
        this.keepAwakeAudio.pause();
      } catch (e) {}
    }
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  getState() {
    return {
      enabled: this.enabled,
      wakeLockActive: !!this.wakeLockSentinel,
      videoActive: !!(this.keepAwakeVideo && !this.keepAwakeVideo.paused),
      audioActive: !!(this.keepAwakeAudio && !this.keepAwakeAudio.paused)
    };
  }

  destroy() {
    this.disable();
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.keepAwakeVideo && this.keepAwakeVideo.parentNode) {
      this.keepAwakeVideo.parentNode.removeChild(this.keepAwakeVideo);
      this.keepAwakeVideo = null;
    }
    if (this.keepAwakeAudio && this.keepAwakeAudio.parentNode) {
      this.keepAwakeAudio.parentNode.removeChild(this.keepAwakeAudio);
      this.keepAwakeAudio = null;
    }
  }
}
