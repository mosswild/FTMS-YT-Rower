/**
 * Virtual Rower Simulator with Dynamic Workout Profiling
 * Generates realistic FTMS rowing packets with automatic rate modulation,
 * simulating speeding up, slowing down, and auto-pause intervals.
 */

export class VirtualRowerSimulator {
  constructor(onDataCallback, options = {}) {
    this.onData = onDataCallback;
    this.onPhaseChange = options.onPhaseChange || null;
    this.isRunning = false;
    this.isRowing = true; // manual override
    this.intervalId = null;

    // Simulation modes: "dynamic" (auto-varying workout program) or "manual"
    this.mode = "dynamic"; 

    this.spm = 20;
    this.targetSpm = 22;
    this.splitSeconds = 125;
    this.distance = 0;
    this.strokeCount = 0;
    this.watts = 180;
    this.heartRate = 135;
    this.elapsedSeconds = 0;
    this.lastTickTime = 0;

    // Dynamic Program Definition
    // Cycles through varied rowing intensities and deliberate rest periods
    this.dynamicPhases = [
      { name: "Cruise", targetSpm: 22, duration: 9, isRowing: true },
      { name: "Power Surge", targetSpm: 29, duration: 8, isRowing: true },
      { name: "All-Out Sprint", targetSpm: 34, duration: 7, isRowing: true },
      { name: "Paddle Down", targetSpm: 17, duration: 8, isRowing: true },
      { name: "Rest / Auto-Pause", targetSpm: 0, duration: 6, isRowing: false }, // 6s rest triggers 3.5s auto-pause!
      { name: "Catch & Accelerate", targetSpm: 25, duration: 8, isRowing: true },
    ];

    this.currentPhaseIndex = 0;
    this.phaseElapsed = 0;
  }

  setMode(mode) {
    this.mode = mode; // "dynamic" | "manual"
    if (this.mode === "manual") {
      this.isRowing = true;
      if (this.onPhaseChange) {
        this.onPhaseChange("Manual Control", Math.round(this.targetSpm));
      }
    } else {
      this.currentPhaseIndex = 0;
      this.phaseElapsed = 0;
      this.applyCurrentPhase();
    }
  }

  applyCurrentPhase() {
    const phase = this.dynamicPhases[this.currentPhaseIndex];
    this.targetSpm = phase.targetSpm;
    this.isRowing = phase.isRowing;
    if (this.onPhaseChange) {
      this.onPhaseChange(phase.name, phase.targetSpm);
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTickTime = Date.now();
    this.phaseElapsed = 0;

    if (this.mode === "dynamic") {
      this.applyCurrentPhase();
    }

    // Fire telemetry packets every 500ms
    this.intervalId = setInterval(() => this.tick(), 500);
  }

  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.onPhaseChange) {
      this.onPhaseChange("Stopped", 0);
    }
  }

  toggleRowing() {
    this.isRowing = !this.isRowing;
    if (this.onPhaseChange) {
      this.onPhaseChange(this.isRowing ? "Rowing Resumed" : "Rowing Paused", this.isRowing ? Math.round(this.targetSpm) : 0);
    }
    return this.isRowing;
  }

  setSpm(target) {
    this.targetSpm = Math.max(14, Math.min(38, target));
    if (this.mode === "manual" && this.onPhaseChange) {
      this.onPhaseChange("Manual", Math.round(this.targetSpm));
    }
  }

  tick() {
    const now = Date.now();
    const dtSeconds = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;

    // Advance dynamic program if in dynamic mode
    if (this.mode === "dynamic") {
      this.phaseElapsed += dtSeconds;
      const currentPhase = this.dynamicPhases[this.currentPhaseIndex];
      if (this.phaseElapsed >= currentPhase.duration) {
        this.phaseElapsed = 0;
        this.currentPhaseIndex = (this.currentPhaseIndex + 1) % this.dynamicPhases.length;
        this.applyCurrentPhase();
      }
    }

    if (!this.isRowing || this.targetSpm <= 0) {
      // User stopped pulling: emit 0 SPM to test auto-pause watchdog
      if (this.onData) {
        this.onData({
          timestamp: now,
          strokeRate: 0,
          instantaneousPace: 0,
          watts: 0,
          resistance: 8,
          distance: Math.round(this.distance),
          strokeCount: Math.round(this.strokeCount),
          heartRate: Math.max(90, Math.round(this.heartRate - 1)),
          elapsedSeconds: Math.round(this.elapsedSeconds),
          isSimulated: true,
          phaseName: this.mode === "dynamic" ? this.dynamicPhases[this.currentPhaseIndex].name : "Paused"
        });
      }
      return;
    }

    // Smoothly transition SPM toward target
    this.spm += (this.targetSpm - this.spm) * 0.20;
    const currentSpm = Math.round(this.spm * 10) / 10;

    // Faster stroke rate yields faster split
    // SPM 16 -> Split 140s (2:20)
    // SPM 22 -> Split 125s (2:05)
    // SPM 29 -> Split 108s (1:48)
    // SPM 34 -> Split 95s  (1:35)
    this.splitSeconds = Math.max(80, Math.min(170, 180 - (currentSpm * 2.5)));

    // Concept2 Watts = 2.80 / (pace_in_sec_per_meter ^ 3)
    const secPerMeter = this.splitSeconds / 500.0;
    this.watts = Math.round(2.80 / Math.pow(secPerMeter, 3));

    // Distance increment
    const metersPerSec = 500.0 / this.splitSeconds;
    this.distance += metersPerSec * dtSeconds;
    this.elapsedSeconds += dtSeconds;

    // Stroke count increment
    this.strokeCount += (currentSpm / 60) * dtSeconds;

    // Dynamic heart rate drift
    const targetHr = 100 + (currentSpm * 1.8);
    this.heartRate += (targetHr - this.heartRate) * 0.08;

    const packet = {
      timestamp: now,
      strokeRate: Math.round(currentSpm),
      instantaneousPace: Math.round(this.splitSeconds),
      watts: this.watts,
      resistance: 8,
      distance: Math.round(this.distance),
      strokeCount: Math.round(this.strokeCount),
      heartRate: Math.round(this.heartRate),
      elapsedSeconds: Math.round(this.elapsedSeconds),
      isSimulated: true,
      phaseName: this.mode === "dynamic" ? this.dynamicPhases[this.currentPhaseIndex].name : "Manual"
    };

    if (this.onData) {
      this.onData(packet);
    }
  }

  reset() {
    this.distance = 0;
    this.strokeCount = 0;
    this.elapsedSeconds = 0;
    this.heartRate = 130;
    this.phaseElapsed = 0;
    this.currentPhaseIndex = 0;
  }
}
