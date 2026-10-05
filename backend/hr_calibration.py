"""OrangeTheory-Style Adaptive Heart Rate Calibration and Zone Calculation Engine.

Implements the physiological formulas and adaptive calibration mechanics used by OrangeTheory Fitness:
1. Initial baseline: Tanaka formula (208 - 0.7 * Age) or Fox formula (220 - Age).
2. The 5-Workout Trigger: Evaluates peak cardiovascular performance and sustained elevated
   efforts across qualifying workouts (duration >= 10m, avg HR >= 90, peak HR >= 120, last 120 days).
3. Spike-filtered peak analysis: Uses sustained percentiles (98.5th percentile / rolling top window)
   to eliminate Bluetooth / optical monitor artifacts.
4. Five distinct color-coded metabolic zones:
   - Zone 1 (Gray):   50% - 60% HRmax (Warm-up, recovery)
   - Zone 2 (Blue):   61% - 70% HRmax (Light aerobic base warm-up)
   - Zone 3 (Green):  71% - 83% HRmax (Aerobic endurance / Base pace)
   - Zone 4 (Orange): 84% - 91% HRmax (Anaerobic threshold / Push pace - Splat Points)
   - Zone 5 (Red):    92% - 100% HRmax (Maximum capacity / All-out - Splat Points)
5. Splat Points: 1 point earned for each cumulative 60 seconds spent in Orange or Red zones (>= 84% HRmax).
"""

from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime, timezone, timedelta
import math


# Zone definitions as percentages of HRmax [min_pct, max_pct]
ORANGETHEORY_ZONES = {
    1: {
        "name": "Gray",
        "label": "Warm-up / Recovery",
        "min_pct": 0.50,
        "max_pct": 0.60,
        "color": "#94a3b8",
        "bg_color": "rgba(148, 163, 184, 0.2)",
        "earns_splats": False,
    },
    2: {
        "name": "Blue",
        "label": "Light Aerobic / Warm-up",
        "min_pct": 0.61,
        "max_pct": 0.70,
        "color": "#38bdf8",
        "bg_color": "rgba(56, 189, 248, 0.2)",
        "earns_splats": False,
    },
    3: {
        "name": "Green",
        "label": "Aerobic Base Pace",
        "min_pct": 0.71,
        "max_pct": 0.83,
        "color": "#10b981",
        "bg_color": "rgba(16, 185, 129, 0.2)",
        "earns_splats": False,
    },
    4: {
        "name": "Orange",
        "label": "Anaerobic Push Pace",
        "min_pct": 0.84,
        "max_pct": 0.91,
        "color": "#f97316",
        "bg_color": "rgba(249, 115, 22, 0.2)",
        "earns_splats": True,
    },
    5: {
        "name": "Red",
        "label": "All-Out Maximum",
        "min_pct": 0.92,
        "max_pct": 1.00,
        "color": "#ef4444",
        "bg_color": "rgba(239, 68, 68, 0.2)",
        "earns_splats": True,
    },
}

# Calibration constants
MIN_QUALIFYING_WORKOUTS = 5
CALIBRATION_WINDOW_DAYS = 120
MIN_WORKOUT_DURATION_SECONDS = 600  # 10 minutes
MIN_QUALIFYING_AVG_HR = 90.0
MIN_QUALIFYING_PEAK_HR = 120.0
ABSOLUTE_MIN_HRMAX = 130
ABSOLUTE_MAX_HRMAX = 225


def calculate_age_based_max_hr(age: int, formula: str = "tanaka") -> int:
    """Calculates population-level estimated HRmax using Tanaka (default) or Fox formula.

    Tanaka equation: 208 - (0.7 * Age)
    Standard Fox formula: 220 - Age
    """
    safe_age = max(10, min(100, int(age)))
    if formula.lower() == "standard" or formula.lower() == "fox":
        max_hr = 220 - safe_age
    else:
        # Default: Tanaka equation (standard in Orangetheory OTbeat)
        max_hr = round(208.0 - (0.7 * safe_age))
    return int(max(ABSOLUTE_MIN_HRMAX, min(ABSOLUTE_MAX_HRMAX, max_hr)))


def calculate_zones_for_max_hr(max_hr: int) -> Dict[str, Dict[str, Any]]:
    """Generates the 5 OrangeTheory heart rate zones with exact BPM boundaries for a given HRmax."""
    safe_max_hr = max(ABSOLUTE_MIN_HRMAX, min(ABSOLUTE_MAX_HRMAX, int(max_hr)))
    zones = {}
    for zone_num, defn in ORANGETHEORY_ZONES.items():
        min_bpm = round(safe_max_hr * defn["min_pct"])
        max_bpm = round(safe_max_hr * defn["max_pct"])
        zones[str(zone_num)] = {
            "zone": zone_num,
            "name": defn["name"],
            "label": defn["label"],
            "min_pct": round(defn["min_pct"] * 100),
            "max_pct": round(defn["max_pct"] * 100),
            "min_bpm": min_bpm,
            "max_bpm": max_bpm,
            "color": defn["color"],
            "bg_color": defn["bg_color"],
            "earns_splats": defn["earns_splats"],
        }
    return zones


def get_zone_for_bpm(bpm: float, max_hr: int) -> Optional[Dict[str, Any]]:
    """Determines which OrangeTheory zone a given heart rate falls into."""
    if not bpm or bpm <= 0 or not max_hr or max_hr <= 0:
        return None
    pct = (float(bpm) / float(max_hr)) * 100.0
    zones = calculate_zones_for_max_hr(max_hr)

    if pct < 50.0:
        # Below Zone 1 (Resting / Very Low)
        return {
            "zone": 0,
            "name": "Rest",
            "label": "Resting / Idle",
            "pct": round(pct, 1),
            "color": "#64748b",
            "bg_color": "rgba(100, 116, 139, 0.2)",
            "earns_splats": False,
        }

    for zone_num in (5, 4, 3, 2, 1):
        z = zones[str(zone_num)]
        if bpm >= z["min_bpm"]:
            return {
                "zone": zone_num,
                "name": z["name"],
                "label": z["label"],
                "pct": round(pct, 1),
                "color": z["color"],
                "bg_color": z["bg_color"],
                "earns_splats": z["earns_splats"],
            }

    z1 = zones["1"]
    return {
        "zone": 1,
        "name": z1["name"],
        "label": z1["label"],
        "pct": round(pct, 1),
        "color": z1["color"],
        "bg_color": z1["bg_color"],
        "earns_splats": False,
    }


def calculate_sustained_peak_hr(samples: List[Dict[str, Any]]) -> Optional[float]:
    """Calculates the spike-filtered sustained peak heart rate from workout samples.

    To eliminate Bluetooth/optical monitor spikes (e.g. momentary 220 BPM glitches),
    this extracts sustained cardiovascular readings by filtering out isolated outliers
    (using median-clamping and 95th-97th percentile checks) and validates against
    rolling sustained effort windows.
    """
    valid_hrs = [float(s.get("hr", 0)) for s in samples if float(s.get("hr", 0)) > 40.0]
    if len(valid_hrs) < 30:  # Need at least 30 samples (~30 seconds) of HR data
        return None

    # Step 1: Detect and clamp isolated 1-2 sample spikes
    chrono_hrs = list(valid_hrs)
    cleaned_chrono = []
    for i, hr in enumerate(chrono_hrs):
        # Look at 5-sample neighborhood to detect isolated spikes (> 20 bpm jump from neighbors)
        start_idx = max(0, i - 2)
        end_idx = min(len(chrono_hrs), i + 3)
        neighbors = [chrono_hrs[j] for j in range(start_idx, end_idx) if j != i]
        if neighbors:
            median_neighbor = sorted(neighbors)[len(neighbors) // 2]
            if hr > median_neighbor + 25.0:  # Obvious spike artifact
                cleaned_chrono.append(median_neighbor)
                continue
        cleaned_chrono.append(hr)

    # Step 2: 97th percentile of cleaned samples
    sorted_cleaned = sorted(cleaned_chrono)
    p97_idx = min(len(sorted_cleaned) - 1, int(len(sorted_cleaned) * 0.97))
    p97_hr = sorted_cleaned[p97_idx]

    # Step 3: Rolling 10-second moving average peak
    window_size = min(10, len(cleaned_chrono))
    curr = sum(cleaned_chrono[:window_size])
    max_rolling = curr / window_size
    for i in range(window_size, len(cleaned_chrono)):
        curr += cleaned_chrono[i] - cleaned_chrono[i - window_size]
        avg = curr / window_size
        if avg > max_rolling:
            max_rolling = avg

    # Sustained peak is confirmed by rolling average and percentile
    sustained = min(p97_hr, max_rolling + 1.0)
    return round(max(ABSOLUTE_MIN_HRMAX, min(ABSOLUTE_MAX_HRMAX, sustained)), 1)


def evaluate_qualifying_workouts(
    workouts: List[Dict[str, Any]],
    window_days: int = CALIBRATION_WINDOW_DAYS
) -> List[Dict[str, Any]]:
    """Filters completed workout sessions to identify valid qualifying workouts for calibration."""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=window_days)
    qualifying = []

    for w in workouts:
        dur = float(w.get("duration_seconds") or 0)
        avg_hr = float(w.get("avg_hr") or 0)
        max_hr = float(w.get("max_hr") or 0)
        start_time_str = w.get("start_time") or ""

        # Validate date window
        if start_time_str:
            try:
                clean_time = start_time_str.replace("Z", "+00:00")
                dt = datetime.fromisoformat(clean_time)
                if dt < cutoff_date:
                    continue
            except Exception:
                pass

        # Must meet duration, average HR, and peak HR thresholds
        if dur >= MIN_WORKOUT_DURATION_SECONDS and avg_hr >= MIN_QUALIFYING_AVG_HR:
            samples = w.get("samples") or []
            sustained_peak = None
            if samples:
                sustained_peak = calculate_sustained_peak_hr(samples)
            if not sustained_peak and max_hr >= MIN_QUALIFYING_PEAK_HR:
                # If samples not loaded, fallback to max_hr with reasonable safety clamp
                sustained_peak = min(max_hr, 215.0)

            if sustained_peak and sustained_peak >= MIN_QUALIFYING_PEAK_HR:
                qualifying.append({
                    "id": w.get("id"),
                    "start_time": start_time_str,
                    "duration_seconds": dur,
                    "avg_hr": avg_hr,
                    "sustained_peak_hr": sustained_peak,
                    "sample_count": len(samples),
                })

    return qualifying


def calibrate_max_hr(
    qualifying_workouts: List[Dict[str, Any]],
    age: int,
    formula: str = "tanaka"
) -> Tuple[int, bool, float]:
    """Runs the OrangeTheory adaptive calibration algorithm against qualifying workouts.

    Returns:
        (active_max_hr, is_calibrated, raw_calibrated_val)

    Logic:
    - If qualifying_workouts count < 5:
        Not yet calibrated. Returns age formula baseline.
    - If qualifying_workouts count >= 5:
        Evaluates the top sustained peak cardiovascular efforts across workouts.
        Weights top 3 peak sessions to establish the athlete's true observed HRmax,
        blending 85% observed peak cluster with 15% age-based prior for stability.
    """
    age_baseline = calculate_age_based_max_hr(age, formula)

    if len(qualifying_workouts) < MIN_QUALIFYING_WORKOUTS:
        return age_baseline, False, float(age_baseline)

    # Sort workouts by sustained peak HR descending
    sorted_peaks = sorted(
        [float(w["sustained_peak_hr"]) for w in qualifying_workouts],
        reverse=True
    )

    # OrangeTheory looks at peak efforts. Take the average of the top 3 peak workouts
    top_peaks = sorted_peaks[:min(3, len(sorted_peaks))]
    peak_avg = sum(top_peaks) / len(top_peaks)

    # Blend 85% observed sustained peak with 15% age baseline for physiological stability
    calibrated_raw = (0.85 * peak_avg) + (0.15 * age_baseline)
    clamped_hr = round(max(ABSOLUTE_MIN_HRMAX, min(ABSOLUTE_MAX_HRMAX, calibrated_raw)))

    return int(clamped_hr), True, round(calibrated_raw, 1)


def calculate_session_zones_and_splats(
    samples: List[Dict[str, Any]],
    max_hr: int
) -> Dict[str, Any]:
    """Calculates time spent in each of the 5 OrangeTheory zones and total Splat Points earned."""
    zone_seconds = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0, 5: 0.0, 0: 0.0}
    splat_seconds = 0.0

    if not samples or max_hr <= 0:
        return {
            "splat_points": 0,
            "zone_seconds": {str(k): 0 for k in (1, 2, 3, 4, 5)},
            "zone_minutes": {str(k): 0.0 for k in (1, 2, 3, 4, 5)},
            "pct_in_zones": {str(k): 0.0 for k in (1, 2, 3, 4, 5)},
        }

    # Evaluate each interval between consecutive samples (or assume 1s per sample if elapsed is standard)
    for i, s in enumerate(samples):
        hr = float(s.get("hr", 0))
        if hr <= 0:
            continue

        # Estimate duration represented by this sample
        if i < len(samples) - 1:
            next_t = float(samples[i + 1].get("elapsed_seconds", s.get("elapsed_seconds", 0) + 1.0))
            curr_t = float(s.get("elapsed_seconds", 0))
            dt = max(0.2, min(5.0, next_t - curr_t))
        else:
            dt = 1.0

        zone_info = get_zone_for_bpm(hr, max_hr)
        if zone_info:
            z_num = zone_info["zone"]
            zone_seconds[z_num] = zone_seconds.get(z_num, 0.0) + dt
            if zone_info["earns_splats"]:
                splat_seconds += dt

    # 1 Splat Point per full 60 seconds (1 minute) spent in Orange (Zone 4) or Red (Zone 5)
    splat_points = int(math.floor(splat_seconds / 60.0))

    total_valid_seconds = sum(zone_seconds[k] for k in (1, 2, 3, 4, 5))
    pct_in_zones = {}
    zone_minutes = {}
    for k in (1, 2, 3, 4, 5):
        s_dur = zone_seconds.get(k, 0.0)
        zone_minutes[str(k)] = round(s_dur / 60.0, 1)
        pct_in_zones[str(k)] = round((s_dur / total_valid_seconds * 100.0), 1) if total_valid_seconds > 0 else 0.0

    return {
        "splat_points": splat_points,
        "splat_seconds": round(splat_seconds, 1),
        "zone_seconds": {str(k): round(zone_seconds.get(k, 0.0), 1) for k in (1, 2, 3, 4, 5)},
        "zone_minutes": zone_minutes,
        "pct_in_zones": pct_in_zones,
    }
