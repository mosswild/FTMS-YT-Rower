/**
 * Display Keep-Awake Controller
 * Dual-tier sleep prevention for Desktop, Android, and iOS Safari / Standalone PWA.
 * 1. Standard W3C Screen Wake Lock API (Desktop Chrome, Edge, Safari 16.4+)
 * 2. Invisible inline NoSleep MP4 loop with silent AAC audio track for iOS WebKit
 *    (Muted video on iOS does not prevent system auto-lock; active media with audio does)
 */

const NO_SLEEP_MP4_URI = "data:video/mp4;base64,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";

export class KeepAwake {
  constructor(options = {}) {
    this.enabled = false;
    this.wakeLockSentinel = null;
    this.keepAwakeVideo = null;
    this.isPreArmed = false;
    this.heartbeatInterval = null;
    this.onStateChange = options.onStateChange || null;

    this.initVideoElement();
    this.bindVisibilityChange();
    this.bindPreArmGesture();
    this.startHeartbeat();
  }

  initVideoElement() {
    if (typeof document === "undefined") return;
    if (this.keepAwakeVideo) return;

    this.keepAwakeVideo = document.createElement("video");
    this.keepAwakeVideo.setAttribute("title", "FTMS Keep Awake");
    this.keepAwakeVideo.setAttribute("playsinline", "true");
    this.keepAwakeVideo.setAttribute("webkit-playsinline", "true");
    this.keepAwakeVideo.setAttribute("preload", "auto");
    this.keepAwakeVideo.setAttribute("aria-hidden", "true");
    this.keepAwakeVideo.tabIndex = -1;

    // Keep video element 1x1, transparent, fixed offscreen
    this.keepAwakeVideo.style.position = "fixed";
    this.keepAwakeVideo.style.top = "-100px";
    this.keepAwakeVideo.style.left = "-100px";
    this.keepAwakeVideo.style.width = "1px";
    this.keepAwakeVideo.style.height = "1px";
    this.keepAwakeVideo.style.opacity = "0.001";
    this.keepAwakeVideo.style.pointerEvents = "none";
    this.keepAwakeVideo.style.zIndex = "-9999";

    // AAC track in this MP4 is digital silence. We keep volume micro-low on platforms supporting volume
    try {
      this.keepAwakeVideo.volume = 0.0001;
    } catch (e) {}

    const source = document.createElement("source");
    source.src = NO_SLEEP_MP4_URI;
    source.type = "video/mp4";
    this.keepAwakeVideo.appendChild(source);

    // Continuous seek-loop: Seeking before reaching EOF prevents AVPlayer from briefly dropping sleep assertion
    this.keepAwakeVideo.addEventListener("timeupdate", () => {
      if (this.keepAwakeVideo && this.keepAwakeVideo.currentTime > 0.5) {
        this.keepAwakeVideo.currentTime = 0.1;
      }
    });

    // Fallback standard loop
    this.keepAwakeVideo.loop = true;

    try {
      document.body.appendChild(this.keepAwakeVideo);
    } catch (e) {
      window.addEventListener("DOMContentLoaded", () => {
        if (this.keepAwakeVideo && !this.keepAwakeVideo.parentNode) {
          document.body.appendChild(this.keepAwakeVideo);
        }
      });
    }
  }

  bindPreArmGesture() {
    if (typeof window === "undefined") return;
    const unlockGesture = () => {
      if (!this.isPreArmed) {
        this.preArm();
      }
    };
    window.addEventListener("pointerdown", unlockGesture, { passive: true, once: false });
    window.addEventListener("touchstart", unlockGesture, { passive: true, once: false });
    window.addEventListener("click", unlockGesture, { passive: true, once: false });
  }

  preArm() {
    if (this.isPreArmed || !this.keepAwakeVideo) return;
    // Calling load() or brief play/pause inside user interaction sets media activation flag on iOS WebKit
    try {
      const p = this.keepAwakeVideo.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          this.isPreArmed = true;
          // If keep-awake is not currently requested, pause it immediately
          if (!this.enabled && this.keepAwakeVideo && !this.keepAwakeVideo.paused) {
            this.keepAwakeVideo.pause();
          }
        }).catch(() => {});
      }
    } catch (e) {}
  }

  bindVisibilityChange() {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.enabled) {
        this.requestWakeLock();
        this.playVideoFallback();
      }
    });
  }

  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      if (this.enabled && typeof document !== "undefined" && document.visibilityState === "visible") {
        if (!this.wakeLockSentinel && "wakeLock" in navigator) {
          this.requestWakeLock();
        }
        if (this.keepAwakeVideo && this.keepAwakeVideo.paused) {
          this.playVideoFallback();
        }
      }
    }, 15000);
  }

  async requestWakeLock() {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    if (this.wakeLockSentinel) return;

    try {
      this.wakeLockSentinel = await navigator.wakeLock.request("screen");
      this.wakeLockSentinel.addEventListener("release", () => {
        this.wakeLockSentinel = null;
        if (this.enabled && typeof document !== "undefined" && document.visibilityState === "visible") {
          setTimeout(() => {
            if (this.enabled) this.requestWakeLock();
          }, 1000);
        }
        if (this.onStateChange) this.onStateChange(this.getState());
      });
      if (this.onStateChange) this.onStateChange(this.getState());
    } catch (err) {
      // Wake Lock API can reject if battery saver is on or user switched tabs
    }
  }

  playVideoFallback() {
    if (!this.keepAwakeVideo) return;
    if (!this.keepAwakeVideo.paused) return;

    try {
      const p = this.keepAwakeVideo.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          // Autoplay policy may block until next user touch
        });
      }
      if (this.onStateChange) this.onStateChange(this.getState());
    } catch (e) {}
  }

  enable() {
    this.enabled = true;
    this.requestWakeLock();
    this.playVideoFallback();
    if (this.onStateChange) this.onStateChange(this.getState());
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
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  getState() {
    return {
      enabled: this.enabled,
      wakeLockActive: !!this.wakeLockSentinel,
      videoActive: !!(this.keepAwakeVideo && !this.keepAwakeVideo.paused)
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
  }
}
