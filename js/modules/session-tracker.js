/**
 * Session Tracker & Persistence
 * Records 1Hz telemetry samples, calculates aggregate metrics, and persists to SQLite via backend API.
 */

export class SessionTracker {
  constructor(options = {}) {
    this.state = "idle"; // "idle" | "active" | "paused" | "finished"
    this.startTime = null;
    this.endTime = null;
    this.elapsedSeconds = 0;
    this.samples = [];

    this.currentMetrics = {
      spm: 0,
      split: 0,
      watts: 0,
      distance: 0,
      strokes: 0,
      hr: 0
    };

    this.timerInterval = null;
    this.sampleInterval = null;

    this.meta = {
      videoId: options.videoId || null,
      audioSource: options.audioSource || "original",
      notes: ""
    };

    this.onTick = options.onTick || null;
    this.onStateChange = options.onStateChange || null;
  }

  setMeta(videoId, audioSource, notes = "") {
    this.meta.videoId = videoId;
    this.meta.audioSource = audioSource;
    this.meta.notes = notes;
  }

  start() {
    if (this.state === "active") return;
    this.state = "active";
    this.startTime = new Date().toISOString();
    this.elapsedSeconds = 0;
    this.samples = [];

    // 1-second elapsed timer
    this.timerInterval = setInterval(() => {
      if (this.state === "active") {
        this.elapsedSeconds += 1;
        this.recordSample();
        if (this.onTick) {
          this.onTick(this.getSummary());
        }
      }
    }, 1000);

    if (this.onStateChange) this.onStateChange(this.state);
  }

  pause() {
    if (this.state === "active") {
      this.state = "paused";
      if (this.onStateChange) this.onStateChange(this.state);
    }
  }

  resume() {
    if (this.state === "paused") {
      this.state = "active";
      if (this.onStateChange) this.onStateChange(this.state);
    }
  }

  updateTelemetry(telemetry) {
    if (telemetry.strokeRate !== undefined) this.currentMetrics.spm = telemetry.strokeRate;
    if (telemetry.instantaneousPace !== undefined) this.currentMetrics.split = telemetry.instantaneousPace;
    if (telemetry.watts !== undefined) this.currentMetrics.watts = telemetry.watts;
    if (telemetry.distance !== undefined) this.currentMetrics.distance = telemetry.distance;
    if (telemetry.strokeCount !== undefined) this.currentMetrics.strokes = telemetry.strokeCount;
    if (telemetry.heartRate !== undefined) this.currentMetrics.hr = telemetry.heartRate;

    // Auto-start workout on first meaningful pull if idle
    if (this.state === "idle" && (this.currentMetrics.spm > 0 || this.currentMetrics.watts > 0)) {
      this.start();
    }
  }

  recordSample() {
    this.samples.push({
      elapsed_seconds: this.elapsedSeconds,
      stroke_rate: this.currentMetrics.spm,
      split_seconds: this.currentMetrics.split,
      watts: this.currentMetrics.watts,
      hr: this.currentMetrics.hr,
      distance: this.currentMetrics.distance
    });
  }

  getSummary() {
    const validWatts = this.samples.map(s => s.watts).filter(w => w > 0);
    const validSplits = this.samples.map(s => s.split_seconds).filter(s => s > 0);
    const validSpms = this.samples.map(s => s.stroke_rate).filter(sp => sp > 0);
    const validHrs = this.samples.map(s => s.hr).filter(h => h > 0);

    const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : 0;
    const max = arr => arr.length ? Math.max(...arr) : 0;

    return {
      durationSeconds: this.elapsedSeconds,
      distanceMeters: this.currentMetrics.distance,
      totalStrokes: this.currentMetrics.strokes,
      avgSpm: avg(validSpms),
      avgSplit: avg(validSplits),
      avgWatts: avg(validWatts),
      maxWatts: max(validWatts),
      avgHr: avg(validHrs),
      maxHr: max(validHrs),
    };
  }

  async finish() {
    if (this.state === "finished" || this.state === "idle") return null;
    
    this.state = "finished";
    this.endTime = new Date().toISOString();

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (this.onStateChange) this.onStateChange(this.state);

    const summary = this.getSummary();
    const sessionId = "workout_" + Date.now();

    const payload = {
      id: sessionId,
      start_time: this.startTime,
      end_time: this.endTime,
      duration_seconds: summary.durationSeconds,
      distance_meters: summary.distanceMeters,
      total_strokes: summary.totalStrokes,
      avg_spm: summary.avgSpm,
      avg_split: summary.avgSplit,
      avg_watts: summary.avgWatts,
      max_watts: summary.maxWatts,
      avg_hr: summary.avgHr,
      max_hr: summary.maxHr,
      video_id: this.meta.videoId,
      audio_source: this.meta.audioSource,
      notes: this.meta.notes || "",
      samples: this.samples
    };

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      console.log("[SessionTracker] Workout persisted to SQLite:", result);
      return result.id;
    } catch (err) {
      console.error("[SessionTracker] Error saving workout session:", err);
      return null;
    }
  }

  reset() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.state = "idle";
    this.startTime = null;
    this.endTime = null;
    this.elapsedSeconds = 0;
    this.samples = [];
    this.currentMetrics = { spm: 0, split: 0, watts: 0, distance: 0, strokes: 0, hr: 0 };
    if (this.onStateChange) this.onStateChange(this.state);
  }
}
