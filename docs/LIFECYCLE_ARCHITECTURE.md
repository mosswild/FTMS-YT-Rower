# FTMS-Rower Lifecycle Architecture & Decoupling Model

This specification documents the three decoupled core layers in FTMS-Rower, their interaction contracts, and their lifecycle state machines across start, stop, pause, and resume events.

---

## 1. The Three Core Layers

```
+-------------------------------------------------------------------------+
|                              LAYER 1: SIMULATOR                         |
|  - VirtualRowerSimulator (Simulates human pulling on physical flywheel) |
|  - Emits FTMS Bluetooth telemetry (SPM, Pace, Watts, HR)                |
|  - Runs autonomous Dynamic Program cycle (Cruise, Surge, Sprint, etc.)  |
+------------------------------------+------------------------------------+
                                     |
                                     v [FTMS Telemetry Packets]
+------------------------------------+------------------------------------+
|                         LAYER 2: WORKOUT / SESSION                      |
|  - SessionTracker & PM5 HUD (The overall activity container)            |
|  - Tracks live session metrics, session history, and HUD telemetry     |
|  - Manages video/audio synchronization with live rowing                 |
+------------------------------------+------------------------------------+
                                     |
                                     v [Live Pulls vs Target Compliance]
+------------------------------------+------------------------------------+
|                              LAYER 3: PROGRAM                           |
|  - WorkoutEngine (Structured Training Routine)                          |
|  - Interval steps, targets, countdowns, step durations & distances      |
|  - Progress ribbon and compliance evaluation                            |
+-------------------------------------------------------------------------+
```

---

## 2. Layer Responsibilities & Contracts

### Layer 1: Simulator (`VirtualRowerSimulator`)
- **Role:** Simulates the physical hardware and athlete pulling on the machine. Emits raw FTMS Bluetooth telemetry packets every 500ms.
- **Autonomous Dynamics:** Cycles through its own dynamic program profile (*Cruise* 22 SPM, *Power Surge* 29 SPM, *All-Out Sprint* 34 SPM, *Paddle Down* 17 SPM, *Rest* 0 SPM, *Catch & Accelerate* 25 SPM).
- **Decoupling Guarantee:** The Simulator represents the athlete pulling on the oars. Pausing a planned Program has **zero control or throttling effect** on the Simulator. If the Simulator is running, it continues pulling and cycling through its paces.

### Layer 2: Workout / Session (`SessionTracker` & PM5 HUD)
- **Role:** The container representing the rowing session.
- **Live Metrics:** PM5 HUD Cells 1 (SPM), 2 (Split Pace), 3 (Watts), and 6 (Heart Rate) display real-time instantaneous telemetry from the rower or simulator.
- **Session Progress:** Cell 4 (Elapsed Time) and Cell 5 (Distance) track session totals. During a Program pause, these cells freeze at the snapshot values with the amber `⏸ PAUSED` badge anchored at the bottom-right.

### Layer 3: Program (`WorkoutEngine`)
- **Role:** The structured interval sequence (e.g. *Pyramid Intervals*, *5 x 500m*, *30-min Aerobic Base*).
- **Execution:** Tracks interval countdowns, step durations, step distances, and target compliance (`● Target`, `▲ Under`, `▼ Over`).
- **Pause Behavior:** Pausing the Program stops the interval timer, stops step distance accumulation, and pauses video/audio. It evaluates live pulls against the paused step's targets.

---

## 3. Lifecycle Interaction Matrix

| User Action | Simulator State | Workout / Session State | Program State | Video / Audio State |
| :--- | :--- | :--- | :--- | :--- |
| **Start Workout** | Idle (or keeps running if already started) | Starts active session | Starts loaded Program | Starts playback synced to rowing |
| **Start Simulator** | Starts pulling & cycling dynamic program | Automatically starts Workout Session | Automatically starts loaded Program | Starts playback synced to rowing |
| **Pause Program** (`⏸`) | **Continues pulling & cycling autonomously** | **Still live:** SPM, Pace, Watts, HR update live. Distance & Time freeze with `⏸ PAUSED`. | **Paused:** Step timers & step distance accumulation stop. Targets stay visible. | Paused |
| **Resume Program** (`▶`) | **Continues pulling & cycling** | **Unfreezes:** Distance & Time resume progressing from paused values. | **Running:** Step timers & step distance resume. | Resumes playback synced to rowing |
| **Stop Program** (`✕`) | Continues if started independently | Session finishes (or continues as Free Row) | Closes ribbon, resets to Free Row | Continues or pauses based on rowing activity |
| **Stop Simulator** | Zeroes out metrics & stops loop | Ends Workout Session | Ends Program | Pauses playback |

---

## 4. Invariant Rules for Future Implementation

1. **Simulator Autonomy:** `simulator.js` must never stop cycling or clamp to static values simply because `workoutEngine` enters a `"paused"` state.
2. **Independent Hardware Mimicry:** The Simulator acts identically to a physical Concept2 PM5 connected over Web Bluetooth or Wi-Fi Relay. If a rower continues pulling on their physical machine while their training program is paused, the HUD receives live pulls. The Simulator must do the exact same thing.
3. **No Target Wiping on Pause:** Pausing a Program must never wipe out the active interval's target metadata or compliance chips.
4. **Frozen Distance & Time:** Elapsed Time and Distance on the PM5 HUD must remain strictly frozen at the paused snapshot with the amber `⏸ PAUSED` badge until unpaused, regardless of whether strokes are being pulled.
