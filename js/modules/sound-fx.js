/**
 * FTMS-Rower Sound Effects & Audio Context Unlocking Engine
 * 
 * Provides:
 * 1. Global iOS WebKit & Chromium user-gesture audio unlocking for HTMLAudioElement and AudioContext.
 * 2. Ascending two-tone notification chime for message popups, toasts, and coaching cues.
 * 3. Synthesized Web Audio beeps for countdown and interval transitions.
 */

let sharedAudioContext = null;
let isAudioUnlocked = false;
let lastChimeTime = 0;

/**
 * Returns the singleton Web Audio AudioContext, instantiating it if necessary.
 */
export function getSharedAudioContext() {
  if (!sharedAudioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      sharedAudioContext = new AudioCtx();
    }
  }
  if (sharedAudioContext && sharedAudioContext.state === "suspended") {
    sharedAudioContext.resume().catch(() => {});
  }
  return sharedAudioContext;
}

/**
 * Primes and unlocks Web Audio AudioContext and the HTMLAudioElement soundtrack
 * during any user gesture (pointerdown, touchstart, click).
 */
export function unlockAudio() {
  // 1. Resume AudioContext
  const ctx = getSharedAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  // 2. Prime HTMLAudioElement on iOS Safari if present
  if (!isAudioUnlocked) {
    const audio = document.getElementById("soundtrack");
    if (audio) {
      const prevMuted = audio.muted;
      const prevVolume = audio.volume;
      try {
        audio.muted = true;
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === "function") {
          playPromise
            .then(() => {
              // Immediately pause once authorized by WebKit
              audio.pause();
              audio.muted = prevMuted;
              audio.volume = prevVolume;
              isAudioUnlocked = true;
            })
            .catch(() => {
              audio.muted = prevMuted;
              audio.volume = prevVolume;
            });
        }
      } catch (err) {
        audio.muted = prevMuted;
        audio.volume = prevVolume;
      }
    }
  }
}

/**
 * Registers global event listeners to prime audio on the very first touch/click.
 */
export function setupGlobalAudioUnlock() {
  const events = ["pointerdown", "touchstart", "click", "keydown"];
  const handleInteraction = () => {
    unlockAudio();
    // Keep listeners active to re-resume AudioContext if the browser suspends it on background/lock
  };

  events.forEach((evt) => {
    window.addEventListener(evt, handleInteraction, { passive: true, capture: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const ctx = getSharedAudioContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    }
  });
}

/**
 * Plays a pleasant, subtle ascending two-tone notification chime (E5 -> A5)
 * when a notice toast, coaching cue, or message pops up.
 */
export function playMessageChime(volume = 0.20) {
  const now = Date.now();
  // Throttle to prevent overlapping burst chimes within 350ms
  if (now - lastChimeTime < 350) return;
  lastChimeTime = now;

  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const t = ctx.currentTime;
    // Ascending perfect fourth: E5 (659.25 Hz) -> A5 (880.00 Hz)
    const notes = [
      { freq: 659.25, start: t, duration: 0.16, maxGain: volume * 0.8 },
      { freq: 880.00, start: t + 0.07, duration: 0.26, maxGain: volume * 1.0 }
    ];

    notes.forEach((note) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(note.freq, note.start);

      // Smooth attack (15ms) to prevent clicks, followed by exponential decay
      gain.gain.setValueAtTime(0.0001, note.start);
      gain.gain.linearRampToValueAtTime(note.maxGain, note.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, note.start + note.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(note.start);
      osc.stop(note.start + note.duration);
    });
  } catch (e) {
    // Graceful fallback if Web Audio is unavailable
  }
}

/**
 * Synthesizes a countdown beep (default 440Hz).
 */
export function playCountdownBeep(freq = 440, durationSec = 0.08, volume = 0.25) {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + durationSec);
  } catch (e) {}
}

/**
 * Synthesizes an interval step completion chime (880Hz -> 1320Hz).
 */
export function playTransitionChime(volume = 0.20) {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const t = ctx.currentTime;
    [880, 1320].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startT = t + idx * 0.05;
      const dur = 0.35;

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startT);

      gain.gain.setValueAtTime(volume, startT);
      gain.gain.exponentialRampToValueAtTime(0.001, startT + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startT);
      osc.stop(startT + dur);
    });
  } catch (e) {}
}
