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
    
    calories = int((avg_watts * 4.0 * duration / 4184.0) + (duration / 60.0 * 1.5)) if duration > 0 and avg_watts > 0 else int(duration / 60.0 * 8.0)

    # Max speed calculation
    max_speed = 0.0
    samples = workout.get("samples") or []
    for s in samples:
        split = float(s.get("split_seconds") or 0.0)
        if split > 0:
            speed = 500.0 / split
            if speed > max_speed:
                max_speed = speed

    activity = ET.SubElement(activities, "Activity", {"Sport": "Rowing"})
    
    activity_id = ET.SubElement(activity, "Id")
    activity_id.text = formatted_start

    lap = ET.SubElement(activity, "Lap", {"StartTime": formatted_start})
    
    total_time = ET.SubElement(lap, "TotalTimeSeconds")
    total_time.text = f"{duration:.1f}"

    dist_elem = ET.SubElement(lap, "DistanceMeters")
    dist_elem.text = f"{distance:.1f}"

    if max_speed > 0:
        max_speed_elem = ET.SubElement(lap, "MaximumSpeed")
        max_speed_elem.text = f"{max_speed:.2f}"

    cal_elem = ET.SubElement(lap, "Calories")
    cal_elem.text = str(max(calories, 1))

    if avg_hr > 0:
        avg_hr_elem = ET.SubElement(lap, "AverageHeartRateBpm")
        ET.SubElement(avg_hr_elem, "Value").text = str(avg_hr)

    if max_hr > 0:
        max_hr_elem = ET.SubElement(lap, "MaximumHeartRateBpm")
        ET.SubElement(max_hr_elem, "Value").text = str(max_hr)

    intensity = ET.SubElement(lap, "Intensity")
    intensity.text = "Active"

    if avg_spm > 0:
        cadence_elem = ET.SubElement(lap, "Cadence")
        cadence_elem.text = str(avg_spm)

    trigger_method = ET.SubElement(lap, "TriggerMethod")
    trigger_method.text = "Manual"

    track = ET.SubElement(lap, "Track")

    if not samples and duration > 0:
        samples = [
            {"elapsed_seconds": 0.0, "stroke_rate": avg_spm, "split_seconds": workout.get("avg_split") or 120.0, "watts": avg_watts, "hr": avg_hr, "distance": 0.0},
            {"elapsed_seconds": duration, "stroke_rate": avg_spm, "split_seconds": workout.get("avg_split") or 120.0, "watts": avg_watts, "hr": avg_hr, "distance": distance}
        ]

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
