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
    this.lastTelemetry = { distanceMeters: 0, elapsedSeconds: 0, totalStrokes: 0 };

    // Web Audio Context for beeps
    this.audioCtx = null;
    this.soundAlerts = true;
  }

  get isRunning() {
    return this.status === "running" || this.status === "countdown";
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
  }

  onTelemetry(telemetry) {
    if (telemetry) {
      if (telemetry.distanceMeters !== undefined) this.lastTelemetry.distanceMeters = telemetry.distanceMeters;
      if (telemetry.elapsedSeconds !== undefined) this.lastTelemetry.elapsedSeconds = telemetry.elapsedSeconds;
      if (telemetry.totalStrokes !== undefined) this.lastTelemetry.totalStrokes = telemetry.totalStrokes;
    }
    if (this.status !== "running") return;

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

    this.updateProgress();
  }

  evaluateCompliance(telemetry) {
    const step = this.currentStep;
    if (!step || !step.targets) {
      this.options.onCompliance({});
      return;
    }

    const compliance = {};
    const targets = step.targets;

    // SPM Compliance
    if (targets.spm && telemetry.strokeRate !== undefined && telemetry.strokeRate > 0) {
      const [minSpm, maxSpm] = targets.spm;
      const val = telemetry.strokeRate;
      if (val >= minSpm && val <= maxSpm) {
        compliance.spm = { status: "in-target", target: `${minSpm}-${maxSpm}` };
      } else if (val < minSpm) {
        compliance.spm = { status: "under-target", target: `${minSpm}-${maxSpm}`, diff: minSpm - val };
      } else {
        compliance.spm = { status: "over-target", target: `${minSpm}-${maxSpm}`, diff: val - maxSpm };
      }
    }

    // Split Compliance (seconds per 500m)
    if (targets.split_seconds && telemetry.splitSeconds !== undefined && telemetry.splitSeconds > 0) {
      const [minSplit, maxSplit] = targets.split_seconds; // min is fastest (lowest s), max is slowest
      const val = telemetry.splitSeconds;
      const targetStr = targets.split_formatted ? `${targets.split_formatted[0]} - ${targets.split_formatted[1]}` : "";
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

    // Watts Compliance
    if (targets.watts && telemetry.powerWatts !== undefined && telemetry.powerWatts > 0) {
      const [minW, maxW] = targets.watts;
      const val = telemetry.powerWatts;
      if (val >= minW && val <= maxW) {
        compliance.watts = { status: "in-target", target: `${minW}-${maxW}W` };
      } else if (val < minW) {
        compliance.watts = { status: "under-target", target: `${minW}-${maxW}W` };
      } else {
        compliance.watts = { status: "over-target", target: `${minW}-${maxW}W` };
      }
    }

    // Heart Rate Compliance
    if (targets.hr && telemetry.heartRate !== undefined && telemetry.heartRate > 0) {
      const [minHr, maxHr] = targets.hr;
      const val = telemetry.heartRate;
      if (val >= minHr && val <= maxHr) {
        compliance.hr = { status: "in-target", target: `${minHr}-${maxHr}` };
      } else if (val < minHr) {
        compliance.hr = { status: "under-target", target: `${minHr}-${maxHr}` };
      } else {
        compliance.hr = { status: "over-target", target: `${minHr}-${maxHr}` };
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
      const remMeters = Math.max(0, Math.ceil(dist - this.stepDistanceMeters));
      remainingText = `${remMeters}m left`;
    } else if (step.exit && step.exit.strokes) {
      const st = step.exit.strokes;
      percent = Math.min(100, Math.max(0, (this.stepStrokes / st) * 100));
      remainingText = `${Math.max(0, st - this.stepStrokes)} strokes left`;
    } else if (step.exit && step.exit.manual) {
      remainingText = "Tap Next when ready";
      percent = 100;
    }

    this.options.onTick({
      stepIndex: this.currentStepIndex,
      totalSteps: this.steps.length,
      step,
      percent,
      remainingText,
      stepElapsedSeconds: this.stepElapsedSeconds,
      stepDistanceMeters: this.stepDistanceMeters,
      stepStrokes: this.stepStrokes,
    });
  }

  nextStep(telemetry = null) {
    this.advanceStep(telemetry);
  }

  skipStep(telemetry = null) {
    this.advanceStep(telemetry);
  }

  advanceStep(telemetry = null) {
    this.playTransitionChime();
    this.activateStep(this.currentStepIndex + 1, telemetry);
  }

  prevStep(telemetry = null) {
    this.playTransitionChime();
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
