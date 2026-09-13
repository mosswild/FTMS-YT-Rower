import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Dict, Any

def create_tcx_root() -> ET.Element:
    """Create root TrainingCenterDatabase element with XML schemas."""
    return ET.Element("TrainingCenterDatabase", {
        "xmlns": "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2",
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "xsi:schemaLocation": "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd"
    })

def append_lap(activity: ET.Element, lap_data: Dict[str, Any], samples: list, dt: datetime) -> ET.Element:
    """Append a Lap element with its Trackpoints and ActivityExtensions."""
    lap_start_str = lap_data.get("start_time")
    if not lap_start_str:
        start_sec = float(lap_data.get("start_elapsed_seconds") or 0.0)
        lap_start_str = (dt + timedelta(seconds=start_sec)).strftime("%Y-%m-%dT%H:%M:%SZ")

    lap_duration = float(lap_data.get("duration_seconds") or 0.0)
    lap_distance = float(lap_data.get("distance_meters") or 0.0)
    lap_avg_hr = int(lap_data.get("avg_hr") or 0)
    lap_max_hr = int(lap_data.get("max_hr") or lap_avg_hr or 0)
    lap_avg_spm = int(lap_data.get("avg_spm") or 0)
    lap_avg_watts = float(lap_data.get("avg_watts") or 0.0)
    lap_max_watts = float(lap_data.get("max_watts") or lap_avg_watts or 0.0)
    lap_type = (lap_data.get("type") or "").lower()
    lap_intensity = lap_data.get("intensity") or ("Resting" if lap_type == "rest" else "Active")

    lap_cals = int((lap_avg_watts * 4.0 * lap_duration / 4184.0) + (lap_duration / 60.0 * 1.5)) if lap_duration > 0 and lap_avg_watts > 0 else int(lap_duration / 60.0 * 8.0)

    # Calculate max speed in lap
    max_speed = 0.0
    for s in samples:
        split = float(s.get("split_seconds") or 0.0)
        if split > 0:
            speed = 500.0 / split
            if speed > max_speed:
                max_speed = speed

    lap = ET.SubElement(activity, "Lap", {"StartTime": lap_start_str})

    total_time = ET.SubElement(lap, "TotalTimeSeconds")
    total_time.text = f"{lap_duration:.1f}"

    dist_elem = ET.SubElement(lap, "DistanceMeters")
    dist_elem.text = f"{lap_distance:.1f}"

    if max_speed > 0:
        max_speed_elem = ET.SubElement(lap, "MaximumSpeed")
        max_speed_elem.text = f"{max_speed:.2f}"

    cal_elem = ET.SubElement(lap, "Calories")
    cal_elem.text = str(max(lap_cals, 1))

    if lap_avg_hr > 0:
        avg_hr_elem = ET.SubElement(lap, "AverageHeartRateBpm")
        ET.SubElement(avg_hr_elem, "Value").text = str(lap_avg_hr)

    if lap_max_hr > 0:
        max_hr_elem = ET.SubElement(lap, "MaximumHeartRateBpm")
        ET.SubElement(max_hr_elem, "Value").text = str(lap_max_hr)

    intensity = ET.SubElement(lap, "Intensity")
    intensity.text = lap_intensity

    if lap_avg_spm > 0:
        cadence_elem = ET.SubElement(lap, "Cadence")
        cadence_elem.text = str(lap_avg_spm)

    trigger_method = ET.SubElement(lap, "TriggerMethod")
    trigger_method.text = "FitnessEquipment"

    track = ET.SubElement(lap, "Track")
    for s in samples:
        elapsed = float(s.get("elapsed_seconds") or 0.0)
        tp_dt = dt + timedelta(seconds=elapsed)
        tp_time_str = tp_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

        tp = ET.SubElement(track, "Trackpoint")
        time_elem = ET.SubElement(tp, "Time")
        time_elem.text = tp_time_str

        sample_dist = float(s.get("distance") or 0.0)
        tp_dist = ET.SubElement(tp, "DistanceMeters")
        tp_dist.text = f"{sample_dist:.1f}"

        sample_hr = int(s.get("hr") or 0)
        if sample_hr > 0:
            tp_hr = ET.SubElement(tp, "HeartRateBpm")
            ET.SubElement(tp_hr, "Value").text = str(sample_hr)

        sample_spm = int(s.get("stroke_rate") or 0)
        if sample_spm > 0:
            tp_cad = ET.SubElement(tp, "Cadence")
            tp_cad.text = str(sample_spm)

        sample_watts = float(s.get("watts") or 0.0)
        sample_split = float(s.get("split_seconds") or 0.0)
        speed = 500.0 / sample_split if sample_split > 0 else 0.0

        if sample_watts > 0 or speed > 0:
            extensions = ET.SubElement(tp, "Extensions")
            tpx = ET.SubElement(extensions, "TPX", {
                "xmlns": "http://www.garmin.com/xmlschemas/ActivityExtension/v2"
            })
            if sample_watts > 0:
                watts_elem = ET.SubElement(tpx, "Watts")
                watts_elem.text = f"{int(sample_watts)}"
            if speed > 0:
                speed_elem = ET.SubElement(tpx, "Speed")
                speed_elem.text = f"{speed:.2f}"

    if lap_avg_watts > 0 or lap_max_watts > 0:
        lap_ext = ET.SubElement(lap, "Extensions")
        lx = ET.SubElement(lap_ext, "LX", {
            "xmlns": "http://www.garmin.com/xmlschemas/ActivityExtension/v2"
        })
        if lap_avg_watts > 0:
            ET.SubElement(lx, "AvgWatts").text = f"{int(lap_avg_watts)}"
        if lap_max_watts > 0:
            ET.SubElement(lx, "MaxWatts").text = f"{int(lap_max_watts)}"

    return lap

def append_activity(activities: ET.Element, workout: Dict[str, Any]) -> ET.Element:
    """Append a single Rowing Activity to the Activities XML element."""
    start_time_str = workout.get("start_time")
    if not start_time_str:
        start_time_str = datetime.now(timezone.utc).isoformat()
    
    # Normalize ISO format with trailing Z
    try:
        dt = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
    except Exception:
        dt = datetime.now(timezone.utc)
    
    formatted_start = dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    duration = float(workout.get("duration_seconds") or 0)
    distance = float(workout.get("distance_meters") or 0.0)
    avg_hr = int(workout.get("avg_hr") or 0)
    max_hr = int(workout.get("max_hr") or avg_hr or 0)
    avg_spm = int(workout.get("avg_spm") or 0)
    avg_watts = float(workout.get("avg_watts") or 0.0)
    max_watts = float(workout.get("max_watts") or avg_watts or 0.0)

    samples = workout.get("samples") or []
    if not samples and duration > 0:
        samples = [
            {"elapsed_seconds": 0.0, "stroke_rate": avg_spm, "split_seconds": workout.get("avg_split") or 120.0, "watts": avg_watts, "hr": avg_hr, "distance": 0.0},
            {"elapsed_seconds": duration, "stroke_rate": avg_spm, "split_seconds": workout.get("avg_split") or 120.0, "watts": avg_watts, "hr": avg_hr, "distance": distance}
        ]

    activity = ET.SubElement(activities, "Activity", {"Sport": "Rowing"})
    
    activity_id = ET.SubElement(activity, "Id")
    activity_id.text = formatted_start

    laps = workout.get("laps") or []
    if laps:
        for lap_data in laps:
            start_sec = float(lap_data.get("start_elapsed_seconds") or 0.0)
            end_sec = start_sec + float(lap_data.get("duration_seconds") or 0.0)
            lap_samples = [s for s in samples if start_sec <= float(s.get("elapsed_seconds") or 0.0) <= end_sec]
            # If no samples fall in range, provide boundary points
            if not lap_samples and float(lap_data.get("duration_seconds") or 0.0) > 0:
                lap_samples = [
                    {"elapsed_seconds": start_sec, "stroke_rate": lap_data.get("avg_spm") or avg_spm, "split_seconds": lap_data.get("avg_split") or 120.0, "watts": lap_data.get("avg_watts") or avg_watts, "hr": lap_data.get("avg_hr") or avg_hr, "distance": float(lap_data.get("distance_meters") or 0.0)},
                    {"elapsed_seconds": end_sec, "stroke_rate": lap_data.get("avg_spm") or avg_spm, "split_seconds": lap_data.get("avg_split") or 120.0, "watts": lap_data.get("avg_watts") or avg_watts, "hr": lap_data.get("avg_hr") or avg_hr, "distance": float(lap_data.get("distance_meters") or 0.0)}
                ]
            append_lap(activity, lap_data, lap_samples, dt)
    else:
        single_lap_data = {
            "start_time": formatted_start,
            "duration_seconds": duration,
            "distance_meters": distance,
            "avg_hr": avg_hr,
            "max_hr": max_hr,
            "avg_spm": avg_spm,
            "avg_watts": avg_watts,
            "max_watts": max_watts,
            "intensity": "Active"
        }
        append_lap(activity, single_lap_data, samples, dt)

    return activity

def generate_tcx(workout: Dict[str, Any]) -> str:
    """
    Generate Garmin Training Center XML v2 for a single rowing workout.
    Compatible with Strava, Garmin Connect, and TrainingPeaks.
    """
    root = create_tcx_root()
    activities = ET.SubElement(root, "Activities")
    append_activity(activities, workout)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True).decode("utf-8")

def generate_multi_tcx(workouts: list) -> str:
    """
    Generate Garmin Training Center XML v2 containing multiple rowing activities.
    """
    root = create_tcx_root()
    activities = ET.SubElement(root, "Activities")
    for w in workouts:
        if w:
            append_activity(activities, w)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True).decode("utf-8")
