# FTMS-Rower Structured Workout YAML Schema Specification (`v1.0`)

This document defines the schema specification for structured rowing workouts in **FTMS-Rower**. Workouts are declared in human-readable YAML (`.yaml` / `.yml`), providing interval timing, distance triggers, target compliance thresholds (cadence, pace, power, heart rate), coaching cues, and cockpit behavior overrides.

---

## 1. Schema Overview

Every workout file adheres to the following root structure:

```yaml
schema: "1.0"                    # Required: schema version string
id: "unique-workout-id"          # Required: lowercase alphanumeric slug with hyphens/underscores
title: "Workout Title"           # Required: user-facing display title
description: "Workout summary"   # Optional: descriptive paragraph
author: "Author or Source"       # Optional: coach, organization, or athlete name
category: "intervals"           # Optional: intervals | endurance | pyramid | recovery | benchmark
difficulty: "intermediate"       # Optional: beginner | intermediate | advanced
tags: ["hiit", "sprint"]         # Optional: array of search/filter tags

settings:                        # Optional: cockpit execution defaults
  default_speed_mode: "cadence_zones"  # cadence_zones | continuous | ambient
  audio_modulation: true         # Enable cadence-proportional audio volume
  sound_alerts: true             # Play 3-2-1 transition beeps
  countdown_seconds: 5           # Pre-workout countdown lead-in (default: 5)

segments:                        # Required: ordered list of workout steps or repeat blocks
  - ...
```

---

## 2. Segments & Step Types

The `segments` array contains individual **steps** or container **blocks** with repeating steps.

### Step Types (`type`)

| Type | Purpose | Visual Theme Color | Inactivity Auto-Pause |
| :--- | :--- | :--- | :--- |
| `warmup` | Progressive physical activation | Soft Cyan / Blue | Disabled |
| `work` | High-effort or target rowing interval | Bright Orange / Accent Magenta | Enabled (3.5s watchdog) |
| `rest` | Active recovery paddle or passive rest | Calm Emerald / Teal | Configurable (`auto_pause_video`) |
| `cooldown` | Gentle flushing & heart rate recovery | Muted Slate / Ice | Disabled |
| `block` | Structural container with `repeat` loop | Inherited from children | Inherited from children |

---

## 3. Exit Conditions (`exit`)

Every step (except container `block`s) must define an **exit trigger** indicating when the step finishes and advances:

```yaml
exit:
  duration: "5m"       # Time-based trigger
```

### Supported Trigger Types:

1. **`duration` (Time-based):**
   - String formats: `"30s"`, `"90s"`, `"5m"`, `"12m30s"`, `"1h20m"`.
   - Integer seconds: `300` (equivalent to 5 minutes).

2. **`distance` (Distance-based):**
   - String formats: `"500m"`, `"1000m"`, `"2km"`, `"5k"`.
   - Integer meters: `500` or `2000`.

3. **`strokes` (Stroke count-based):**
   - Integer stroke count: `20` (e.g. for a "Power 20" drive).

4. **`manual` (Athlete-controlled):**
   - Boolean `true`: The step continues until the athlete taps **Next Interval (`⏭`)** on the HUD.

---

## 4. Performance Targets (`targets`)

Steps can specify one or more performance targets. The Cockpit HUD monitors real-time telemetry and indicates target compliance using color-coded chips and directional cues:

```yaml
targets:
  spm: [28, 32]               # Target Stroke Rate range [min, max] or exact integer
  split: ["1:44", "1:48"]     # Target /500m split range ["fast", "slow"] or exact "MM:SS"
  watts: [240, 280]           # Target Power Watts range [min, max] or exact integer
  hr_zone: 4                  # Target Heart Rate zone (1 to 5)
  hr: [155, 170]              # Target Heart Rate BPM range [min, max]
```

### Compliance Rules:
- **`in-target` (Green):** Telemetry is within the specified bounds (inclusive).
- **`under-target` (Amber with `▲` arrow):** Output is below target (e.g., pulling 24 SPM when target is 28–32).
- **`over-target` (Red with `▼` arrow):** Output exceeds target (e.g., pulling 36 SPM during a 20 SPM recovery).

---

## 5. Coaching Cues (`cues`)

Prompts displayed as subtitle banners on the lower third of the video:

```yaml
cues:
  on_start: "Explosive drive! Establish 30 SPM within the first 5 strokes."
  at_midpoint: "Halfway! Maintain length through the finish."
  at_time_remaining:
    "30s": "Final 30 seconds! Build the pressure."
  at_distance_remaining:
    "100m": "Empty the tank! Sprint to the line."
```

---

## 6. Container Blocks (`block` & `repeat`)

To define interval series without repetitive declarations, use a container `block`:

```yaml
- type: "block"
  title: "500m Repeats"
  repeat: 5                     # Number of cycles (default: 1)
  steps:
    - type: "work"
      title: "Sprint"
      exit: { distance: "500m" }
      targets: { spm: [28, 32], split: ["1:42", "1:48"] }

    - type: "rest"
      title: "Paddle Rest"
      mode: "active"            # "active" (light paddling) or "passive" (hands off handle)
      auto_pause_video: false   # false keeps scenic video rolling during active paddle
      exit: { duration: "2m" }
      targets: { spm: [14, 18] }
```

When loaded, the workout engine linearizes repeat blocks into sequential execution steps (e.g., `Step 2/11: Sprint (Set 1/5)`, `Step 3/11: Paddle Rest (Set 1/5)`).

---

## 7. Complete Working Examples

### Example 1: Classic HIIT (5 x 500m Power Intervals)
```yaml
schema: "1.0"
id: "5x500m-power-intervals"
title: "5 x 500m Power Intervals"
description: "High-intensity interval session: 5 repetitions of 500m max effort with 2-minute active paddle recovery."
author: "Concept2 Benchmark"
category: "intervals"
difficulty: "advanced"
tags: ["hiit", "vo2max", "sprint"]

settings:
  default_speed_mode: "cadence_zones"
  audio_modulation: true
  sound_alerts: true
  countdown_seconds: 5

segments:
  - type: "warmup"
    title: "Progressive Warmup"
    exit: { duration: "5m" }
    targets:
      spm: [18, 22]
      split: ["2:05", "2:15"]
    cues:
      on_start: "Settle into a relaxed rhythm, focusing on posture and leg drive."
      at_midpoint: "Gradually build pressure through the legs."

  - type: "block"
    title: "500m Repeats"
    repeat: 5
    steps:
      - type: "work"
        title: "Sprint Interval"
        exit: { distance: "500m" }
        targets:
          spm: [28, 32]
          split: ["1:42", "1:48"]
          watts: [240, 300]
        cues:
          on_start: "Explosive drive! Lock in your target split."
          at_distance_remaining:
            "100m": "Final sprint, empty the tank!"

      - type: "rest"
        title: "Active Recovery"
        mode: "active"
        auto_pause_video: false
        exit: { duration: "2m" }
        targets:
          spm: [14, 18]
        cues:
          on_start: "Deep breaths. Light paddle to clear lactic acid."

  - type: "cooldown"
    title: "Flush Cooldown"
    exit: { duration: "3m" }
    targets:
      spm: [16, 20]
    cues:
      on_start: "Smooth, long strokes to bring your heart rate down."
```

### Example 2: The Distance Pyramid (250m → 500m → 750m → 500m → 250m)
```yaml
schema: "1.0"
id: "distance-pyramid-sprint"
title: "Sprint Distance Pyramid"
description: "Ascending and descending distance ladder testing pacing discipline and lactate tolerance."
author: "British Rowing"
category: "pyramid"
difficulty: "advanced"
tags: ["pyramid", "ladder", "power"]

segments:
  - type: "warmup"
    title: "Warmup"
    exit: { duration: "5m" }
    targets: { spm: [20, 22] }

  - type: "work"
    title: "Step 1: 250m Blast"
    exit: { distance: "250m" }
    targets: { spm: [30, 34], split: ["1:38", "1:44"] }
  - type: "rest"
    title: "Rest"
    exit: { duration: "90s" }

  - type: "work"
    title: "Step 2: 500m Pace"
    exit: { distance: "500m" }
    targets: { spm: [28, 30], split: ["1:44", "1:48"] }
  - type: "rest"
    title: "Rest"
    exit: { duration: "2m" }

  - type: "work"
    title: "Step 3: 750m Peak"
    exit: { distance: "750m" }
    targets: { spm: [26, 28], split: ["1:48", "1:52"] }
  - type: "rest"
    title: "Rest"
    exit: { duration: "2m30s" }

  - type: "work"
    title: "Step 4: 500m Pace"
    exit: { distance: "500m" }
    targets: { spm: [28, 30], split: ["1:44", "1:48"] }
  - type: "rest"
    title: "Rest"
    exit: { duration: "2m" }

  - type: "work"
    title: "Step 5: 250m All-Out"
    exit: { distance: "250m" }
    targets: { spm: [32, 36], split: ["1:35", "1:42"] }

  - type: "cooldown"
    title: "Cooldown"
    exit: { duration: "4m" }
    targets: { spm: [16, 20] }
```

### Example 3: 5,000m Stroke Rate Ladder (Steady State)
```yaml
schema: "1.0"
id: "5k-rate-ladder"
title: "5K Negative Split & Rate Ladder"
description: "Continuous 5,000m row building stroke rate and pace every 1,000 meters."
author: "Pete Plan"
category: "endurance"
difficulty: "intermediate"
tags: ["endurance", "aerobic", "negative-split"]

segments:
  - type: "warmup"
    title: "Warmup"
    exit: { duration: "3m" }
    targets: { spm: [18, 20] }

  - type: "work"
    title: "0 – 1000m (Settle In)"
    exit: { distance: "1000m" }
    targets: { spm: [20, 22], split: ["2:05", "2:10"] }

  - type: "work"
    title: "1000 – 2000m (Base Pace)"
    exit: { distance: "1000m" }
    targets: { spm: [22, 24], split: ["2:02", "2:05"] }

  - type: "work"
    title: "2000 – 3000m (Tempo Surge)"
    exit: { distance: "1000m" }
    targets: { spm: [24, 26], split: ["1:58", "2:02"] }

  - type: "work"
    title: "3000 – 4000m (Hold Pressure)"
    exit: { distance: "1000m" }
    targets: { spm: [26, 28], split: ["1:54", "1:58"] }

  - type: "work"
    title: "4000 – 5000m (Sprint Finish)"
    exit: { distance: "1000m" }
    targets: { spm: [28, 32], split: ["1:48", "1:54"] }

  - type: "cooldown"
    title: "Cooldown"
    exit: { duration: "3m" }
    targets: { spm: [16, 18] }
```

---

## 8. Storage Locations

- **Built-in Workouts:** Bundled with the application under `workouts/*.yaml`.
- **Custom / User Workouts:** Persisted in SQLite or host volume under `data/workouts/*.yaml` (mapped to `/config/data/workouts/` in Docker).
