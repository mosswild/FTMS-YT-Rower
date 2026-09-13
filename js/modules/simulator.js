/**
 * Virtual Rower Simulator with Dynamic Workout Profiling and Structured Workout Following
 * Generates realistic FTMS rowing packets with automatic rate modulation,
 * simulating speeding up, slowing down, auto-pause intervals, and structured workout targets.
 */

export class VirtualRowerSimulator {
  constructor(onDataCallback, options = {}) {
    this.onData = onDataCallback;
    this.onPhaseChange = options.onPhaseChange || null;
    this.isRunning = false;
    this.isRowing = true; // manual override
    this.intervalId = null;

    // Simulation modes: "dynamic" (preset cycle), "workout" (follows active workout intervals), "manual"
    this.mode = "dynamic";

    // Mimic connection type: "relay" (Wi-Fi Relay Bridge) or "direct" (Web Bluetooth)
    this.mimicType = options.mimicType || "relay";
    this.deviceName = options.deviceName || (this.mimicType === "relay" ? "Sim Rower" : "Concept2 PM5 (Sim)");

    // Heart Rate Monitor Simulation
    this.isHrEnabled = options.isHrEnabled || false;
    this.hrDeviceName = options.hrDeviceName || "Polar H10 (Sim)";
    this.manualHr = 135;
    this.hrIntervalId = null;

    this.spm = 20;
    this.targetSpm = 22;
    this.splitSeconds = 125;
    this.targetSplitSeconds = null;
    this.distance = 0;
    this.strokeCount = 0;
    this.watts = 180;
    this.targetWatts = null;
    this.heartRate = 135;
    this.targetHr = null;
    this.elapsedSeconds = 0;
    this.lastTickTime = 0;

    // Structured Workout State Tracking
    this.currentWorkoutStep = null;
    this.workoutStepIndex = 0;
    this.workoutStepTotal = 0;

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
    this.isWorkoutPaused = false;
  }

  setMode(mode) {
    this.mode = mode; // "dynamic" | "workout" | "manual"
    if (this.mode === "manual") {
      this.isRowing = true;
      if (this.onPhaseChange) {
        this.onPhaseChange("Manual Control", Math.round(this.targetSpm));
      }
    } else if (this.mode === "workout") {
      if (this.isWorkoutPaused) {
        this.applyCurrentPhase();
      } else {
        this.applyWorkoutStepTarget();
      }
    } else {
      this.currentPhaseIndex = 0;
      this.phaseElapsed = 0;
      this.applyCurrentPhase();
    }
  }

  setMimicType(type, customName = null) {
    this.mimicType = type === "direct" ? "direct" : "relay";
    if (customName) {
      this.deviceName = customName;
    } else {
      this.deviceName = this.mimicType === "relay" ? "Sim Rower" : "Concept2 PM5 (Sim)";
    }
  }

  applyCurrentPhase() {
    const phase = this.dynamicPhases[this.currentPhaseIndex];
    this.targetSpm = phase.targetSpm;
    this.isRowing = phase.isRowing;
    this.targetSplitSeconds = null;
    this.targetWatts = null;
    this.targetHr = null;
    if (this.onPhaseChange) {
      const isPaused = this.isWorkoutPaused || (typeof workoutEngine !== "undefined" && workoutEngine && workoutEngine.status === "paused");
      const phaseLabel = isPaused ? `[PAUSED] Dynamic: ${phase.name}` : phase.name;
      this.onPhaseChange(phaseLabel, phase.targetSpm);
    }
  }

  onWorkoutStepChange(step, index, total) {
    this.currentWorkoutStep = step;
    this.workoutStepIndex = index;
    this.workoutStepTotal = total;
    if (typeof workoutEngine !== "undefined" && workoutEngine && (workoutEngine.workout || workoutEngine.isRunning)) {
      this.mode = "workout";
    }
    if (this.mode === "workout" && !this.isWorkoutPaused) {
      this.applyWorkoutStepTarget();
    }
  }

  onWorkoutStatusChange(status, meta) {
    if (meta && meta.step) {
      this.currentWorkoutStep = meta.step;
    } else if (typeof workoutEngine !== "undefined" && workoutEngine && workoutEngine.currentStep) {
      this.currentWorkoutStep = workoutEngine.currentStep;
    }

    // If a structured workout is active or changing state, ensure mode is aligned
    if (this.mode !== "workout" && typeof workoutEngine !== "undefined" && workoutEngine && (workoutEngine.workout || workoutEngine.isRunning)) {
      this.mode = "workout";
    }

    if (status === "ready") {
      this.isWorkoutPaused = false;
      this.isRowing = false;
      this.targetSpm = 0;
      if (this.onPhaseChange) {
        this.onPhaseChange(`Ready: ${meta && meta.workout ? meta.workout.title : 'Workout'}`, 0);
      }
    } else if (status === "completed") {
      this.isWorkoutPaused = false;
      this.isRowing = false;
      this.targetSpm = 0;
      if (this.onPhaseChange) {
        this.onPhaseChange("Workout Complete! 🎉", 0);
      }
    } else if (status === "paused") {
      this.isWorkoutPaused = true;
      // Clear fixed targets from previous workout step so dynamic modulation works naturally
      this.targetSplitSeconds = null;
      this.targetWatts = null;
      this.targetHr = null;
      // Immediately apply current dynamic phase so simulator continues its cycle
      this.applyCurrentPhase();
    } else if (status === "idle") {
      this.isWorkoutPaused = false;
      this.isRowing = false;
      this.targetSpm = 0;
      this.currentWorkoutStep = null;
      if (this.onPhaseChange) {
        this.onPhaseChange("Workout Ended", 0);
      }
    } else if (status === "countdown") {
      this.isWorkoutPaused = false;
      this.isRowing = false;
      this.targetSpm = 0;
      if (this.onPhaseChange) {
        this.onPhaseChange(`Starting in ${meta ? meta.countdown : 3}s...`, 0);
      }
    } else if (status === "running") {
      this.isWorkoutPaused = false;
      if (this.mode === "workout") {
        this.applyWorkoutStepTarget();
      }
    }
  }

  applyWorkoutStepTarget() {
    if (!this.currentWorkoutStep) {
      this.targetSpm = 22;
      this.isRowing = true;
      this.targetSplitSeconds = null;
      this.targetWatts = null;
      this.targetHr = null;
      if (this.onPhaseChange) {
        this.onPhaseChange("Workout (Waiting for Step)", 22);
      }
      return;
    }

    const step = this.currentWorkoutStep;
    const isRest = (step.type === "rest");

    if (isRest && (!step.targets || !step.targets.spm || step.targets.spm[1] <= 14)) {
      // Complete passive rest: stop pulling to trigger auto-pause watchdog
      this.targetSpm = 0;
      this.isRowing = false;
    } else {
      this.isRowing = true;
      if (step.targets && step.targets.spm && step.targets.spm.length >= 2) {
        this.targetSpm = (step.targets.spm[0] + step.targets.spm[1]) / 2;
      } else if (step.type === "warmup") {
        this.targetSpm = 20;
      } else if (step.type === "cooldown" || isRest) {
        this.targetSpm = 18;
      } else {
        this.targetSpm = 28;
      }
      if (this.spm < 14) {
        this.spm = this.targetSpm;
      }
    }

    // Target split seconds
    if (step.targets && step.targets.split_seconds && step.targets.split_seconds.length >= 2) {
      this.targetSplitSeconds = (step.targets.split_seconds[0] + step.targets.split_seconds[1]) / 2;
    } else {
      this.targetSplitSeconds = null;
    }

    // Target watts
    if (step.targets && step.targets.watts && step.targets.watts.length >= 2) {
      this.targetWatts = (step.targets.watts[0] + step.targets.watts[1]) / 2;
    } else {
      this.targetWatts = null;
    }

    // Target heart rate
    if (step.targets && step.targets.hr && step.targets.hr.length >= 2) {
      this.targetHr = (step.targets.hr[0] + step.targets.hr[1]) / 2;
    } else {
      this.targetHr = null;
    }

    if (this.onPhaseChange) {
      const stepType = (step.type || "WORK").toUpperCase();
      const title = step.title || `Interval ${this.workoutStepIndex + 1}/${this.workoutStepTotal}`;
      this.onPhaseChange(`[${stepType}] ${title}`, Math.round(this.targetSpm));
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTickTime = Date.now();
    this.phaseElapsed = 0;

    const isPaused = this.isWorkoutPaused || (typeof workoutEngine !== "undefined" && workoutEngine && workoutEngine.status === "paused");
    if (this.mode === "dynamic" || (this.mode === "workout" && isPaused)) {
      this.applyCurrentPhase();
    } else if (this.mode === "workout") {
      this.applyWorkoutStepTarget();
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
    // Zero out live rowing metrics when simulation stops
    this.spm = 0;
    this.watts = 0;
    this.splitSeconds = 0;
    if (this.onData) {
      const stopPacket = {
        strokeRate: 0,
        instantaneousPace: 0,
        watts: 0
      };
      if (!this.isHrEnabled) {
        stopPacket.heartRate = 0;
      }
      this.onData(stopPacket);
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

  setHrEnabled(enabled) {
    this.isHrEnabled = !!enabled;
    if (this.isHrEnabled) {
      if (!this.heartRate || this.heartRate < 50) {
        this.heartRate = this.manualHr || 135;
      }
      this.startHrLoop();
    } else {
      this.stopHrLoop();
      if (this.onData) {
        this.onData({ heartRate: 0 });
      }
    }
    return this.isHrEnabled;
  }

  startHrLoop() {
    if (this.hrIntervalId) return;
    // Emit immediate packet
    if (this.onData) {
      this.onData({ heartRate: Math.round(this.heartRate) });
    }
    this.hrIntervalId = setInterval(() => {
      if (!this.isHrEnabled) return;
      // If rowing simulator is not actively running its own 500ms loop, emit independent HR packets with slight natural jitter
      if (!this.isRunning) {
        const jitter = (Math.random() - 0.5) * 1.5;
        const currentHr = Math.round(Math.max(50, Math.min(220, (this.manualHr || 135) + jitter)));
        if (this.onData) {
          this.onData({ heartRate: currentHr });
        }
      }
    }, 1000);
  }

  stopHrLoop() {
    if (this.hrIntervalId) {
      clearInterval(this.hrIntervalId);
      this.hrIntervalId = null;
    }
  }

  toggleHr() {
    return this.setHrEnabled(!this.isHrEnabled);
  }

  setManualHr(targetBpm) {
    this.manualHr = Math.max(50, Math.min(220, targetBpm));
    this.heartRate = this.manualHr;
    if (this.isHrEnabled && this.onData) {
      this.onData({ heartRate: Math.round(this.heartRate) });
    }
  }

  tick() {
    const now = Date.now();
    const dtSeconds = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;

    // Advance dynamic program if in dynamic mode OR if workout is paused
    const isPaused = this.isWorkoutPaused || (typeof workoutEngine !== "undefined" && workoutEngine && workoutEngine.status === "paused");
    const shouldRunDynamicCycle = (this.mode === "dynamic") || (this.mode === "workout" && isPaused);

    if (shouldRunDynamicCycle) {
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
      if (this.isHrEnabled) {
        this.heartRate = Math.max(70, Math.round(this.heartRate - 0.5));
      }
      const hrPayload = this.isHrEnabled ? Math.round(this.heartRate) : 0;

      let phaseLabel = "Paused";
      if (isPaused) {
        phaseLabel = `[PAUSED] ${this.dynamicPhases[this.currentPhaseIndex].name}`;
      } else if (this.mode === "workout" && this.currentWorkoutStep) {
        phaseLabel = `[${(this.currentWorkoutStep.type || 'REST').toUpperCase()}] ${this.currentWorkoutStep.title || 'Rest'}`;
      } else if (this.mode === "dynamic") {
        phaseLabel = this.dynamicPhases[this.currentPhaseIndex].name;
      }

      if (this.onData) {
        this.onData({
          timestamp: now,
          strokeRate: 0,
          instantaneousPace: 0,
          watts: 0,
          resistance: 8,
          distance: Math.round(this.distance),
          strokeCount: Math.round(this.strokeCount),
          heartRate: hrPayload,
          elapsedSeconds: Math.round(this.elapsedSeconds),
          isSimulated: true,
          isHrSimulated: this.isHrEnabled,
          phaseName: phaseLabel,
          source: this.mimicType === "relay" ? "ble-relay" : "ble-direct",
          deviceName: this.deviceName,
          hrDeviceName: this.isHrEnabled ? this.hrDeviceName : null
        });
      }
      return;
    }

    // Smoothly transition SPM toward target with gentle organic micro-variation (+- 0.25 SPM)
    const organicJitter = (Math.sin(now / 1500) * 0.25);
    const effectiveTargetSpm = Math.max(14, this.targetSpm + organicJitter);
    this.spm += (effectiveTargetSpm - this.spm) * 0.22;
    const currentSpm = Math.round(this.spm * 10) / 10;

    // Transition split pace
    if (this.targetSplitSeconds) {
      this.splitSeconds += (this.targetSplitSeconds - this.splitSeconds) * 0.20;
    } else {
      // Faster stroke rate yields faster split
      // SPM 16 -> Split 140s (2:20)
      // SPM 22 -> Split 125s (2:05)
      // SPM 29 -> Split 108s (1:48)
      // SPM 34 -> Split 95s  (1:35)
      const baseSplit = Math.max(80, Math.min(170, 180 - (currentSpm * 2.5)));
      this.splitSeconds += (baseSplit - this.splitSeconds) * 0.20;
    }

    // Concept2 Watts = 2.80 / (pace_in_sec_per_meter ^ 3)
    if (this.targetWatts) {
      this.watts += (this.targetWatts - this.watts) * 0.20;
    } else {
      const secPerMeter = this.splitSeconds / 500.0;
      this.watts = Math.round(2.80 / Math.pow(secPerMeter, 3));
    }

    // Distance increment
    const metersPerSec = 500.0 / this.splitSeconds;
    this.distance += metersPerSec * dtSeconds;
    this.elapsedSeconds += dtSeconds;

    // Stroke count increment
    this.strokeCount += (currentSpm / 60) * dtSeconds;

    // Dynamic heart rate drift
    if (this.isHrEnabled) {
      let targetHr = 135;
      if (this.mode === "manual" && this.manualHr) {
        targetHr = this.manualHr;
      } else if (this.targetHr) {
        targetHr = this.targetHr;
      } else {
        targetHr = 100 + (currentSpm * 1.8);
      }
      this.heartRate += (targetHr - this.heartRate) * 0.08;
    }
    const currentHr = this.isHrEnabled ? Math.round(this.heartRate) : 0;

    let activePhaseLabel = "Manual";
    if (isPaused) {
      activePhaseLabel = `[PAUSED] ${this.dynamicPhases[this.currentPhaseIndex].name}`;
    } else if (this.mode === "workout") {
      activePhaseLabel = this.currentWorkoutStep 
        ? `[${(this.currentWorkoutStep.type || 'WORK').toUpperCase()}] ${this.currentWorkoutStep.title || 'Interval'}`
        : "Workout";
    } else if (this.mode === "dynamic") {
      activePhaseLabel = this.dynamicPhases[this.currentPhaseIndex].name;
    }

    const packet = {
      timestamp: now,
      strokeRate: Math.round(currentSpm),
      instantaneousPace: Math.round(this.splitSeconds),
      watts: Math.round(this.watts),
      resistance: 8,
      distance: Math.round(this.distance),
      strokeCount: Math.round(this.strokeCount),
      heartRate: currentHr,
      elapsedSeconds: Math.round(this.elapsedSeconds),
      isSimulated: true,
      isHrSimulated: this.isHrEnabled,
      phaseName: activePhaseLabel,
      source: this.mimicType === "relay" ? "ble-relay" : "ble-direct",
      deviceName: this.deviceName,
      hrDeviceName: this.isHrEnabled ? this.hrDeviceName : null
    };

    if (this.onData) {
      this.onData(packet);
    }
  }

  reset() {
    this.distance = 0;
    this.strokeCount = 0;
    this.elapsedSeconds = 0;
    this.heartRate = 135;
    this.phaseElapsed = 0;
    this.currentPhaseIndex = 0;
    this.currentWorkoutStep = null;
    this.workoutStepIndex = 0;
    this.workoutStepTotal = 0;
    this.isWorkoutPaused = false;
  }
}
