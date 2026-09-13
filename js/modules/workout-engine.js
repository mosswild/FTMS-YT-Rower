/**
 * FTMS-Rower Workout Engine
 * Manages structured interval programs, step triggers, compliance checking,
 * coaching cues, and synthesized Web Audio transition beeps.
 */

export class WorkoutEngine {
  constructor(options = {}) {
    this.options = Object.assign({
      onStatusChange: () => {},
      onStepChange: () => {},
      onTick: () => {},
      onCompliance: () => {},
      onCue: () => {},
      onWorkoutComplete: () => {},
    }, options);

    this.workout = null;
    this.steps = [];
    this.currentStepIndex = -1;
    this.status = "idle"; // "idle" | "countdown" | "running" | "paused" | "completed"

    // Step-level metrics tracking
    this.stepStartTime = null;
    this.stepElapsedSeconds = 0;
    this.stepDistanceMeters = 0;
    this.stepStrokes = 0;

    // Baselines established when step started
    this.stepBaselineDistance = 0;
    this.stepBaselineTime = 0;
    this.stepBaselineStrokes = 0;

    // Workout totals
    this.totalElapsedSeconds = 0;
    this.totalDistanceMeters = 0;

    // Countdown / Tick timer
    this.tickInterval = null;
    this.countdownSeconds = 0;
    this.lastBeepSecond = null;
    this.triggeredCues = new Set();
    this.lastTelemetry = {
      distanceMeters: 0,
      elapsedSeconds: 0,
      totalStrokes: 0,
      strokeRate: 0,
      splitSeconds: 0,
      powerWatts: 0,
      heartRate: 0
    };
    this.isRowerPaused = false;

    // Web Audio Context for beeps
    this.audioCtx = null;
    this.soundAlerts = true;
  }

  get isRunning() {
    return this.status === "running" || this.status === "countdown" || this.status === "paused";
  }

  get currentStep() {
    if (this.currentStepIndex >= 0 && this.currentStepIndex < this.steps.length) {
      return this.steps[this.currentStepIndex];
    }
    return null;
  }

  initAudio() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
  }

  playBeep(freq = 440, duration = 0.08, type = "sine") {
    if (!this.soundAlerts) return;
    try {
      this.initAudio();
      if (!this.audioCtx) return;

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);

      gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (e) {
      // Audio autoplay policy or device restrictions
    }
  }

  playTransitionChime() {
    if (!this.soundAlerts) return;
    try {
      this.initAudio();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      [880, 1320].forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);

        gain.gain.setValueAtTime(0.2, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.35);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now + idx * 0.05);
        osc.stop(now + idx * 0.05 + 0.35);
      });
    } catch (e) {}
  }

  loadWorkout(workoutData) {
    clearInterval(this.tickInterval);
    this.workout = workoutData;
    this.steps = workoutData.expanded_steps || [];
    this.soundAlerts = workoutData.settings ? workoutData.settings.sound_alerts !== false : true;
    this.currentStepIndex = 0;
    this.status = "ready";
    this.stepElapsedSeconds = 0;
    this.stepDistanceMeters = 0;
    this.stepStrokes = 0;
    this.options.onStatusChange(this.status, { workout: workoutData });
    if (this.steps.length > 0) {
      this.options.onStepChange(this.steps[0], 0, this.steps.length);
      this.options.onTick({
        stepIndex: 0,
        totalSteps: this.steps.length,
        step: this.steps[0],
        percent: 0,
        remainingText: "Ready — Press Start Workout",
        stepElapsedSeconds: 0,
        stepDistanceMeters: 0,
        stepStrokes: 0,
      });
    }
  }

  start(telemetry = {}) {
    if (!this.workout || this.steps.length === 0) return;
    this.initAudio();

    const countdownLead = this.workout.settings && this.workout.settings.countdown_seconds !== undefined
      ? this.workout.settings.countdown_seconds
      : 5;

    if (countdownLead > 0) {
      this.status = "countdown";
      this.countdownSeconds = countdownLead;
      this.options.onStatusChange(this.status, { countdown: this.countdownSeconds });
      this.playBeep(440, 0.08);

      clearInterval(this.tickInterval);
      this.tickInterval = setInterval(() => {
        this.countdownSeconds--;
        if (this.countdownSeconds > 0) {
          this.playBeep(440, 0.08);
          this.options.onStatusChange(this.status, { countdown: this.countdownSeconds });
        } else {
          clearInterval(this.tickInterval);
          this.playTransitionChime();
          this.beginExecution(telemetry);
        }
      }, 1000);
    } else {
      this.beginExecution(telemetry);
    }
  }

  beginExecution(telemetry = {}) {
    this.status = "running";
    this.currentStepIndex = 0;
    this.totalElapsedSeconds = 0;
    this.totalDistanceMeters = 0;
    this.activateStep(0, telemetry);

    clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      if (this.status === "running") {
        this.onTimerTick();
      }
    }, 250);

    this.options.onStatusChange(this.status, { step: this.currentStep });
  }

  activateStep(index, telemetry = null) {
    if (index >= this.steps.length) {
      this.completeWorkout();
      return;
    }

    this.currentStepIndex = Math.max(0, index);
    const step = this.steps[this.currentStepIndex];

    // Establish baselines
    this.stepStartTime = Date.now();
    this.stepElapsedSeconds = 0;
    this.stepDistanceMeters = 0;
    this.stepStrokes = 0;
    this.lastBeepSecond = null;
    this.triggeredCues.clear();

    const telem = (telemetry && (telemetry.distanceMeters !== undefined || telemetry.elapsedSeconds !== undefined))
      ? telemetry
      : this.lastTelemetry;

    this.stepBaselineDistance = telem.distanceMeters || 0;
    this.stepBaselineTime = telem.elapsedSeconds || 0;
    this.stepBaselineStrokes = telem.totalStrokes || 0;

    this.options.onStepChange(step, this.currentStepIndex, this.steps.length);

    // Initial cue
    if (step.cues && step.cues.on_start) {
      this.options.onCue(step.cues.on_start);
    }

    this.updateProgress();
    this.evaluateCompliance(this.lastTelemetry);
  }

  onTelemetry(telemetry) {
    if (telemetry) {
      if (telemetry.distanceMeters !== undefined) this.lastTelemetry.distanceMeters = telemetry.distanceMeters;
      if (telemetry.elapsedSeconds !== undefined) this.lastTelemetry.elapsedSeconds = telemetry.elapsedSeconds;
      if (telemetry.totalStrokes !== undefined) this.lastTelemetry.totalStrokes = telemetry.totalStrokes;
      if (telemetry.strokeRate !== undefined) this.lastTelemetry.strokeRate = telemetry.strokeRate;
      if (telemetry.splitSeconds !== undefined) this.lastTelemetry.splitSeconds = telemetry.splitSeconds;
      if (telemetry.powerWatts !== undefined) this.lastTelemetry.powerWatts = telemetry.powerWatts;
      if (telemetry.heartRate !== undefined) this.lastTelemetry.heartRate = telemetry.heartRate;
      if (telemetry.strokeRate !== undefined && telemetry.strokeRate > 0) {
        this.isRowerPaused = false;
      }
    }
    if (this.status !== "running" && this.status !== "paused") return;

    if (this.status === "paused") {
      this.evaluateCompliance(this.lastTelemetry);
      return;
    }

    // Update distance
    if (telemetry.distanceMeters !== undefined) {
      const delta = Math.max(0, telemetry.distanceMeters - this.stepBaselineDistance);
      this.stepDistanceMeters = delta;
    }

    // Update strokes
    if (telemetry.totalStrokes !== undefined) {
      this.stepStrokes = Math.max(0, telemetry.totalStrokes - this.stepBaselineStrokes);
    }

    // Check distance triggers
    const step = this.currentStep;
    if (step && step.exit && step.exit.distance) {
      const remaining = Math.max(0, step.exit.distance - this.stepDistanceMeters);

      // Cue at distance remaining
      if (step.cues && step.cues.at_distance_remaining) {
        for (const [distKey, cueText] of Object.entries(step.cues.at_distance_remaining)) {
          const triggerDist = parseFloat(distKey);
          if (!isNaN(triggerDist) && remaining <= triggerDist && !this.triggeredCues.has(`dist_${distKey}`)) {
            this.triggeredCues.add(`dist_${distKey}`);
            this.options.onCue(cueText);
          }
        }
      }

      if (this.stepDistanceMeters >= step.exit.distance) {
        this.advanceStep(telemetry);
        return;
      }
    }

    // Check stroke triggers
    if (step && step.exit && step.exit.strokes) {
      if (this.stepStrokes >= step.exit.strokes) {
        this.advanceStep(telemetry);
        return;
      }
    }

    // Evaluate compliance
    this.evaluateCompliance(telemetry);
    this.updateProgress();
  }

  onTimerTick() {
    if (this.status !== "running") return;

    if (this.stepStartTime) {
      this.stepElapsedSeconds = (Date.now() - this.stepStartTime) / 1000.0;
    }

    const step = this.currentStep;
    if (!step) return;

    // Check time triggers
    if (step.exit && step.exit.duration) {
      const remaining = Math.max(0, step.exit.duration - this.stepElapsedSeconds);
      const remainingInt = Math.ceil(remaining);

      // Warning beeps at 3, 2, 1 seconds
      if (remainingInt <= 3 && remainingInt > 0 && remainingInt !== this.lastBeepSecond) {
        this.lastBeepSecond = remainingInt;
        this.playBeep(520, 0.09);
      }

      // Midpoint cue
      if (step.cues && step.cues.at_midpoint && !this.triggeredCues.has("midpoint")) {
        if (this.stepElapsedSeconds >= step.exit.duration / 2.0) {
          this.triggeredCues.add("midpoint");
          this.options.onCue(step.cues.at_midpoint);
        }
      }

      if (this.stepElapsedSeconds >= step.exit.duration) {
        this.advanceStep();
        return;
      }
    }

    // Continuously evaluate compliance on tick so HUD remains active when stopped/paused
    this.evaluateCompliance(this.lastTelemetry);
    this.updateProgress();
  }

  evaluateCompliance(telemetry) {
    const step = this.currentStep;
    if (!step || !step.targets || this.status === "idle" || this.status === "completed") {
      this.options.onCompliance({});
      return;
    }

    const compliance = {};
    const targets = step.targets;
    const isStepRest = step.type === "rest";
    const curTelem = telemetry || this.lastTelemetry || {};
    const isPaused = this.isRowerPaused || this.status === "paused" || curTelem.strokeRate === 0;

    // SPM Compliance
    if (targets.spm) {
      const minSpm = Array.isArray(targets.spm) ? targets.spm[0] : targets.spm;
      const maxSpm = Array.isArray(targets.spm) ? (targets.spm[1] !== undefined ? targets.spm[1] : targets.spm[0]) : targets.spm;
      const targetStr = minSpm === maxSpm ? `${minSpm}` : `${minSpm}-${maxSpm}`;
      const val = curTelem.strokeRate !== undefined ? curTelem.strokeRate : 0;
      if (val === 0) {
        if (isStepRest && minSpm <= 0) {
          compliance.spm = { status: "in-target", target: targetStr };
        } else {
          compliance.spm = { status: "under-target", target: targetStr, diff: minSpm, isPaused: true };
        }
      } else if (val >= minSpm && val <= maxSpm) {
        compliance.spm = { status: "in-target", target: targetStr };
      } else if (val < minSpm) {
        compliance.spm = { status: "under-target", target: targetStr, diff: minSpm - val };
      } else {
        compliance.spm = { status: "over-target", target: targetStr, diff: val - maxSpm };
      }
    }

    // Split Compliance (seconds per 500m)
    const hasSplit = Boolean(targets.split_seconds || targets.split || targets.split_formatted);
    if (hasSplit) {
      let minSplit = null;
      let maxSplit = null;
      if (targets.split_seconds && targets.split_seconds.length >= 2) {
        minSplit = targets.split_seconds[0];
        maxSplit = targets.split_seconds[1];
      } else if (Array.isArray(targets.split)) {
        const parsed = targets.split.map(s => {
          if (typeof s === "number") return s;
          const parts = String(s).split(":");
          return parts.length === 2 ? parseFloat(parts[0]) * 60 + parseFloat(parts[1]) : parseFloat(s);
        }).filter(n => !isNaN(n));
        if (parsed.length >= 2) {
          minSplit = Math.min(...parsed);
          maxSplit = Math.max(...parsed);
        } else if (parsed.length === 1) {
          minSplit = parsed[0];
          maxSplit = parsed[0];
        }
      }

      let targetStr = "";
      if (targets.split_formatted && targets.split_formatted.length >= 2) {
        targetStr = `${targets.split_formatted[0]} - ${targets.split_formatted[1]}`;
      } else if (Array.isArray(targets.split)) {
        targetStr = targets.split.join(" - ");
      } else if (minSplit !== null && maxSplit !== null) {
        const m1 = Math.floor(minSplit / 60);
        const s1 = String(Math.round(minSplit % 60)).padStart(2, "0");
        const m2 = Math.floor(maxSplit / 60);
        const s2 = String(Math.round(maxSplit % 60)).padStart(2, "0");
        targetStr = `${m1}:${s1} - ${m2}:${s2}`;
      }

      const val = curTelem.splitSeconds !== undefined ? curTelem.splitSeconds : 0;
      if (val === 0) {
        if (isStepRest) {
          compliance.split = { status: "in-target", target: targetStr };
        } else {
          compliance.split = { status: "under-target", target: targetStr, isPaused: true };
        }
      } else if (minSplit !== null && maxSplit !== null) {
        if (val >= minSplit && val <= maxSplit) {
          compliance.split = { status: "in-target", target: targetStr };
        } else if (val > maxSplit) {
          // Slower split than target
          compliance.split = { status: "under-target", target: targetStr };
        } else {
          // Faster split than target
          compliance.split = { status: "over-target", target: targetStr };
        }
      }
    }

    // Watts Compliance
    if (targets.watts) {
      const minW = Array.isArray(targets.watts) ? targets.watts[0] : targets.watts;
      const maxW = Array.isArray(targets.watts) ? (targets.watts[1] !== undefined ? targets.watts[1] : targets.watts[0]) : targets.watts;
      const targetStr = minW === maxW ? `${minW}W` : `${minW}-${maxW}W`;
      const val = curTelem.powerWatts !== undefined ? curTelem.powerWatts : 0;
      if (val === 0) {
        if (isStepRest && minW <= 0) {
          compliance.watts = { status: "in-target", target: targetStr };
        } else {
          compliance.watts = { status: "under-target", target: targetStr, diff: minW, isPaused: true };
        }
      } else if (val >= minW && val <= maxW) {
        compliance.watts = { status: "in-target", target: targetStr };
      } else if (val < minW) {
        compliance.watts = { status: "under-target", target: targetStr, diff: minW - val };
      } else {
        compliance.watts = { status: "over-target", target: targetStr, diff: val - maxW };
      }
    }

    // Heart Rate Compliance
    if (targets.hr || targets.hr_zone) {
      const minHr = targets.hr ? (Array.isArray(targets.hr) ? targets.hr[0] : targets.hr) : null;
      const maxHr = targets.hr ? (Array.isArray(targets.hr) ? (targets.hr[1] !== undefined ? targets.hr[1] : targets.hr[0]) : targets.hr) : null;
      const targetStr = minHr !== null ? (minHr === maxHr ? `${minHr}` : `${minHr}-${maxHr}`) : `Zone ${Array.isArray(targets.hr_zone) ? targets.hr_zone[0] : targets.hr_zone}`;
      const val = curTelem.heartRate !== undefined ? curTelem.heartRate : 0;
      if (val === 0) {
        if (isStepRest && (!minHr || minHr <= 0)) {
          compliance.hr = { status: "in-target", target: targetStr };
        } else {
          compliance.hr = { status: "under-target", target: targetStr, diff: minHr || 0, isPaused: true };
        }
      } else if (minHr !== null && maxHr !== null) {
        if (val >= minHr && val <= maxHr) {
          compliance.hr = { status: "in-target", target: targetStr };
        } else if (val < minHr) {
          compliance.hr = { status: "under-target", target: targetStr, diff: minHr - val };
        } else {
          compliance.hr = { status: "over-target", target: targetStr, diff: val - maxHr };
        }
      } else {
        compliance.hr = { status: "in-target", target: targetStr };
      }
    }

    this.options.onCompliance(compliance);
  }

  updateProgress() {
    const step = this.currentStep;
    if (!step) return;

    let percent = 0;
    let remainingText = "";

    if (step.exit && step.exit.duration) {
      const dur = step.exit.duration;
      percent = Math.min(100, Math.max(0, (this.stepElapsedSeconds / dur) * 100));
      const remSec = Math.max(0, Math.ceil(dur - this.stepElapsedSeconds));
      const m = Math.floor(remSec / 60);
      const s = remSec % 60;
      remainingText = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} left`;
    } else if (step.exit && step.exit.distance) {
      const dist = step.exit.distance;
      percent = Math.min(100, Math.max(0, (this.stepDistanceMeters / dist) * 100));
      const remDist = Math.max(0, Math.round(dist - this.stepDistanceMeters));
      remainingText = `${remDist}m left`;
    } else if (step.exit && step.exit.strokes) {
      const str = step.exit.strokes;
      percent = Math.min(100, Math.max(0, (this.stepStrokes / str) * 100));
      const remStr = Math.max(0, str - this.stepStrokes);
      remainingText = `${remStr} strokes left`;
    } else {
      percent = 100;
      remainingText = "Open step";
    }

    this.options.onTick({
      stepIndex: this.currentStepIndex,
      totalSteps: this.steps.length,
      step: step,
      percent: percent,
      remainingText: remainingText,
      stepElapsedSeconds: this.stepElapsedSeconds,
      stepDistanceMeters: this.stepDistanceMeters,
      stepStrokes: this.stepStrokes,
    });
  }

  nextStep(telemetry = null) {
    this.advanceStep(telemetry);
  }

  skipStep(telemetry = null) {
    if (this.currentStepIndex < this.steps.length - 1) {
      this.activateStep(this.currentStepIndex + 1, telemetry);
    } else {
      this.completeWorkout();
    }
  }

  advanceStep(telemetry = null) {
    this.playTransitionChime();
    this.activateStep(this.currentStepIndex + 1, telemetry);
  }

  prevStep(telemetry = null) {
    if (this.currentStepIndex > 0) {
      this.activateStep(this.currentStepIndex - 1, telemetry);
    } else {
      this.restartStep(telemetry);
    }
  }

  restartStep(telemetry = null) {
    this.activateStep(this.currentStepIndex, telemetry);
  }

  pause() {
    if (this.status === "running") {
      this.status = "paused";
      this.options.onStatusChange(this.status);
      this.evaluateCompliance(this.lastTelemetry);
    }
  }

  resume() {
    if (this.status === "paused") {
      this.status = "running";
      // Adjust start time to account for pause duration
      this.stepStartTime = Date.now() - (this.stepElapsedSeconds * 1000.0);
      this.options.onStatusChange(this.status);
    }
  }

  onRowerPaused() {
    this.isRowerPaused = true;
    this.lastTelemetry.strokeRate = 0;
    this.lastTelemetry.powerWatts = 0;
    this.lastTelemetry.splitSeconds = 0;
    if (this.status === "running" || this.status === "paused") {
      this.evaluateCompliance(this.lastTelemetry);
    }
  }

  onRowerResumed() {
    this.isRowerPaused = false;
  }

  completeWorkout() {
    this.status = "completed";
    clearInterval(this.tickInterval);
    this.playTransitionChime();
    this.options.onStatusChange(this.status);
    this.options.onWorkoutComplete({
      workout: this.workout,
      totalElapsedSeconds: this.totalElapsedSeconds,
      totalDistanceMeters: this.totalDistanceMeters,
    });
  }

  stop() {
    clearInterval(this.tickInterval);
    this.status = "idle";
    this.workout = null;
    this.currentStepIndex = -1;
    this.stepElapsedSeconds = 0;
    this.stepDistanceMeters = 0;
    this.stepStrokes = 0;
    this.options.onStatusChange(this.status);
    this.options.onCompliance({});
  }
}
