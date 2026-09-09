/**
 * Scenic Track Controller
 * Manages video segment trimming (start_time, end_time), looping,
 * and cockpit transport controls (Restart from beginning, Seek -10s, Seek +10s).
 */

export class TrackController {
  constructor(videoElement, options = {}) {
    this.video = videoElement;
    this.onProgress = options.onProgress || null;
    this.onTrackChange = options.onTrackChange || null;

    this.activeTrack = {
      id: null,
      name: "Full Scenic Video",
      videoId: null,
      startTime: 0,
      endTime: 0,
      defaultAudio: "original",
      allowedAudios: []
    };

    if (this.video) {
      this.video.addEventListener("timeupdate", () => this.handleTimeUpdate());
    }
  }

  loadTrack(trackData) {
    this.activeTrack = {
      id: trackData.id || null,
      name: trackData.name || "Custom Track",
      videoId: trackData.video_id,
      startTime: parseFloat(trackData.start_time || 0),
      endTime: parseFloat(trackData.end_time || 0),
      defaultAudio: trackData.default_audio || "original",
      allowedAudios: Array.isArray(trackData.allowed_audios) ? trackData.allowed_audios : [],
      fixedSpeed: !!trackData.fixed_speed
    };

    if (this.video) {
      // Seek to start position immediately
      this.video.currentTime = this.activeTrack.startTime;
    }

    if (this.onTrackChange) {
      this.onTrackChange(this.activeTrack);
    }
  }

  clearTrack() {
    this.activeTrack = {
      id: null,
      name: "Full Scenic Video",
      videoId: null,
      startTime: 0,
      endTime: 0,
      defaultAudio: "original",
      allowedAudios: [],
      fixedSpeed: false
    };
    if (this.onTrackChange) {
      this.onTrackChange(this.activeTrack);
    }
  }

  restart() {
    if (this.video) {
      this.video.currentTime = this.activeTrack.startTime;
    }
  }

  seekRelative(deltaSeconds) {
    if (!this.video) return;
    const current = this.video.currentTime;
    const start = this.activeTrack.startTime;
    const maxEnd = this.activeTrack.endTime > 0 ? this.activeTrack.endTime : (this.video.duration || current + 60);

    const target = Math.max(start, Math.min(maxEnd - 0.5, current + deltaSeconds));
    this.video.currentTime = target;
  }

  seekFraction(fraction) {
    if (!this.video) return;
    const start = this.activeTrack.startTime;
    const end = this.activeTrack.endTime > 0 ? this.activeTrack.endTime : (this.video.duration || 60);
    const target = start + ((end - start) * Math.max(0, Math.min(1, fraction)));
    this.video.currentTime = target;
  }

  handleTimeUpdate() {
    if (!this.video) return;
    const current = this.video.currentTime;
    const start = this.activeTrack.startTime;
    const end = this.activeTrack.endTime > 0 ? this.activeTrack.endTime : this.video.duration;

    // Enforce lower bound
    if (start > 0 && current < start - 0.5) {
      this.video.currentTime = start;
      return;
    }

    // Enforce loop at track end
    if (end > 0 && current >= end) {
      this.video.currentTime = start;
      return;
    }

    if (this.onProgress && end > start) {
      const trackElapsed = Math.max(0, current - start);
      const trackDuration = end - start;
      const progressPercent = Math.min(100, Math.max(0, (trackElapsed / trackDuration) * 100));

      this.onProgress({
        currentTime: current,
        trackElapsed,
        trackDuration,
        progressPercent,
        trackName: this.activeTrack.name
      });
    }
  }
}
