import os
import re
import yaml
from typing import Dict, Any, List, Optional, Tuple

from backend.database import DATA_DIR

BUILTIN_WORKOUTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "workouts"))
USER_WORKOUTS_DIR = os.getenv("WORKOUTS_DIR", os.path.join(DATA_DIR, "workouts"))


def ensure_workout_directories():
    os.makedirs(BUILTIN_WORKOUTS_DIR, exist_ok=True)
    os.makedirs(USER_WORKOUTS_DIR, exist_ok=True)


def parse_duration_to_seconds(val: Any) -> Optional[float]:
    """Parses duration representations like 300, '5m', '90s', '4m30s', '1h20m', '02:30' into seconds."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if not isinstance(val, str):
        return None

    s = val.strip().lower()
    if not s:
        return None

    # Format MM:SS or HH:MM:SS
    if ":" in s:
        parts = s.split(":")
        try:
            if len(parts) == 2:
                return float(parts[0]) * 60 + float(parts[1])
            elif len(parts) == 3:
                return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        except ValueError:
            pass

    # Regex for 1h20m30s or combinations
    total = 0.0
    matched = False
    for pattern, multiplier in [
        (r'(\d+(?:\.\d+)?)\s*h', 3600.0),
        (r'(\d+(?:\.\d+)?)\s*m(?:in)?', 60.0),
        (r'(\d+(?:\.\d+)?)\s*s(?:ec)?', 1.0),
    ]:
        match = re.search(pattern, s)
        if match:
            total += float(match.group(1)) * multiplier
            matched = True

    if matched:
        return total

    # Fallback to plain number
    try:
        return float(s)
    except ValueError:
        return None


def parse_distance_to_meters(val: Any) -> Optional[float]:
    """Parses distance representations like 500, '500m', '2km', '5k' into meters."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if not isinstance(val, str):
        return None

    s = val.strip().lower()
    if not s:
        return None

    # KM or K
    km_match = re.match(r'^(\d+(?:\.\d+)?)\s*(?:km|k)$', s)
    if km_match:
        return float(km_match.group(1)) * 1000.0

    # Meters
    m_match = re.match(r'^(\d+(?:\.\d+)?)\s*m?$', s)
    if m_match:
        return float(m_match.group(1))

    try:
        return float(s)
    except ValueError:
        return None


def parse_split_to_seconds(val: Any) -> Optional[float]:
    """Parses split pace like '1:45', '01:50.5' into seconds per 500m."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if not isinstance(val, str):
        return None

    s = val.strip()
    if ":" in s:
        parts = s.split(":")
        try:
            return float(parts[0]) * 60.0 + float(parts[1])
        except ValueError:
            return None
    try:
        return float(s)
    except ValueError:
        return None


def normalize_range(val: Any) -> Optional[List[float]]:
    """Normalizes a single value or [min, max] list to a [min, max] list of floats."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        f = float(val)
        return [f, f]
    if isinstance(val, list):
        if len(val) == 1:
            f = float(val[0])
            return [f, f]
        elif len(val) >= 2:
            return [float(val[0]), float(val[1])]
    return None


def normalize_split_range(val: Any) -> Optional[Tuple[List[str], List[float]]]:
    """Normalizes split target like '1:45' or ['1:42', '1:48'] into (formatted_strings, seconds_floats)."""
    if val is None:
        return None
    if isinstance(val, str):
        secs = parse_split_to_seconds(val)
        if secs:
            return ([val, val], [secs, secs])
    elif isinstance(val, list):
        secs_list = []
        strs = []
        for item in val:
            item_str = str(item)
            secs = parse_split_to_seconds(item_str)
            if secs is not None:
                strs.append(item_str)
                secs_list.append(secs)
        if strs and secs_list:
            if len(strs) == 1:
                return ([strs[0], strs[0]], [secs_list[0], secs_list[0]])
            return ([strs[0], strs[1]], [min(secs_list), max(secs_list)])
    return None


def expand_step(raw_step: Dict[str, Any], block_title: str = "", set_num: int = 1, total_sets: int = 1) -> Dict[str, Any]:
    """Normalizes a single step and its exit condition and targets."""
    step_type = str(raw_step.get("type", "work")).lower()
    base_title = raw_step.get("title") or step_type.capitalize()
    
    if total_sets > 1:
        full_title = f"{base_title} (Set {set_num}/{total_sets})"
    elif block_title:
        full_title = f"{base_title}"
    else:
        full_title = base_title

    # Exit condition
    exit_cfg = raw_step.get("exit") or {}
    duration_s = parse_duration_to_seconds(exit_cfg.get("duration"))
    distance_m = parse_distance_to_meters(exit_cfg.get("distance"))
    strokes = int(exit_cfg.get("strokes")) if exit_cfg.get("strokes") else None
    manual = bool(exit_cfg.get("manual", False))

    # Fallback if no exit specified: default to 1 minute or 500m
    if duration_s is None and distance_m is None and strokes is None and not manual:
        duration_s = 60.0

    normalized_exit = {
        "duration": duration_s,
        "distance": distance_m,
        "strokes": strokes,
        "manual": manual,
    }

    # Targets
    raw_targets = raw_step.get("targets") or {}
    normalized_targets = {}
    if "spm" in raw_targets:
        normalized_targets["spm"] = normalize_range(raw_targets["spm"])
    if "watts" in raw_targets:
        normalized_targets["watts"] = normalize_range(raw_targets["watts"])
    if "hr" in raw_targets:
        normalized_targets["hr"] = normalize_range(raw_targets["hr"])
    if "hr_zone" in raw_targets:
        hz = raw_targets["hr_zone"]
        if isinstance(hz, list) and len(hz) >= 2:
            normalized_targets["hr_zone"] = [int(hz[0]), int(hz[1])]
        else:
            normalized_targets["hr_zone"] = [int(hz), int(hz)]
    if "split" in raw_targets:
        split_res = normalize_split_range(raw_targets["split"])
        if split_res:
            normalized_targets["split_formatted"] = split_res[0]
            normalized_targets["split_seconds"] = split_res[1]

    # Cues
    cues = raw_step.get("cues") or {}

    # Rest / Auto-pause
    mode = raw_step.get("mode", "active" if step_type == "rest" else None)
    auto_pause_video = raw_step.get("auto_pause_video", step_type == "work")

    return {
        "type": step_type,
        "title": full_title,
        "raw_title": base_title,
        "set_num": set_num,
        "total_sets": total_sets,
        "exit": normalized_exit,
        "targets": normalized_targets,
        "cues": cues,
        "mode": mode,
        "auto_pause_video": auto_pause_video,
    }


def expand_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Expands repeat blocks and linearizes all segments into sequential steps."""
    expanded: List[Dict[str, Any]] = []
    step_index = 0

    for seg in segments:
        seg_type = str(seg.get("type", "work")).lower()
        if seg_type == "block":
            repeat_count = max(1, int(seg.get("repeat", 1)))
            block_title = seg.get("title", "")
            child_steps = seg.get("steps") or []
            for set_idx in range(1, repeat_count + 1):
                for child in child_steps:
                    step = expand_step(child, block_title=block_title, set_num=set_idx, total_sets=repeat_count)
                    step["step_index"] = step_index
                    expanded.append(step)
                    step_index += 1
        else:
            step = expand_step(seg)
            step["step_index"] = step_index
            expanded.append(step)
            step_index += 1

    return expanded


def calculate_workout_estimates(expanded_steps: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Estimates total duration in seconds and distance in meters."""
    total_duration = 0.0
    total_distance = 0.0

    for step in expanded_steps:
        exit_cfg = step.get("exit", {})
        dur = exit_cfg.get("duration")
        dist = exit_cfg.get("distance")

        # Estimate missing metrics using average base split (2:00/500m -> 4.16 m/s)
        default_speed_mps = 500.0 / 120.0
        
        # Check target split if defined
        split_secs = (step.get("targets", {}).get("split_seconds") or [120.0])[0]
        if split_secs > 0:
            speed_mps = 500.0 / split_secs
        else:
            speed_mps = default_speed_mps

        if dur is not None and dist is not None:
            total_duration += dur
            total_distance += dist
        elif dur is not None:
            total_duration += dur
            total_distance += dur * speed_mps
        elif dist is not None:
            total_distance += dist
            total_duration += dist / speed_mps
        else:
            # Manual or stroke-based fallback: ~2 minutes
            total_duration += 120.0
            total_distance += 500.0

    return {
        "estimated_duration_seconds": round(total_duration),
        "estimated_distance_meters": round(total_distance),
        "total_steps": len(expanded_steps),
    }


def parse_and_validate_workout(yaml_content: str, is_builtin: bool = False, file_path: str = "") -> Dict[str, Any]:
    """Parses and validates a workout YAML string, returning structured metadata and expanded steps."""
    try:
        data = yaml.safe_load(yaml_content)
    except Exception as e:
        raise ValueError(f"Invalid YAML syntax: {e}")

    if not isinstance(data, dict):
        raise ValueError("Workout definition must be a YAML mapping/object.")

    workout_id = str(data.get("id", "")).strip()
    if not workout_id:
        if file_path:
            workout_id = os.path.splitext(os.path.basename(file_path))[0]
        else:
            raise ValueError("Workout 'id' is required.")

    title = str(data.get("title", "")).strip()
    if not title:
        title = workout_id.replace("-", " ").replace("_", " ").title()

    segments = data.get("segments")
    if not isinstance(segments, list) or len(segments) == 0:
        raise ValueError("Workout must contain at least one segment in 'segments'.")

    expanded_steps = expand_segments(segments)
    estimates = calculate_workout_estimates(expanded_steps)

    settings = data.get("settings") or {}
    tags = data.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]

    return {
        "schema": str(data.get("schema", "1.0")),
        "id": workout_id,
        "title": title,
        "description": str(data.get("description", "")).strip(),
        "author": str(data.get("author", "Community")).strip(),
        "category": str(data.get("category", "intervals")).strip().lower(),
        "difficulty": str(data.get("difficulty", "intermediate")).strip().lower(),
        "tags": tags,
        "settings": {
            "default_speed_mode": settings.get("default_speed_mode", "cadence_zones"),
            "audio_modulation": bool(settings.get("audio_modulation", True)),
            "sound_alerts": bool(settings.get("sound_alerts", True)),
            "countdown_seconds": int(settings.get("countdown_seconds", 5)),
        },
        "raw_segments": segments,
        "expanded_steps": expanded_steps,
        "estimates": estimates,
        "is_builtin": is_builtin,
        "file_path": file_path,
        "raw_yaml": yaml_content,
    }


def list_workouts() -> List[Dict[str, Any]]:
    """Returns a list of all available workouts (built-in and custom) with metadata summaries."""
    ensure_workout_directories()
    workouts_map: Dict[str, Dict[str, Any]] = {}

    # 1. Load Built-in workouts
    if os.path.exists(BUILTIN_WORKOUTS_DIR):
        for fname in sorted(os.listdir(BUILTIN_WORKOUTS_DIR)):
            if fname.endswith((".yaml", ".yml")):
                fpath = os.path.join(BUILTIN_WORKOUTS_DIR, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        content = f.read()
                    parsed = parse_and_validate_workout(content, is_builtin=True, file_path=fpath)
                    # Lightweight card summary
                    workouts_map[parsed["id"]] = {
                        "id": parsed["id"],
                        "title": parsed["title"],
                        "description": parsed["description"],
                        "author": parsed["author"],
                        "category": parsed["category"],
                        "difficulty": parsed["difficulty"],
                        "tags": parsed["tags"],
                        "settings": parsed["settings"],
                        "estimates": parsed["estimates"],
                        "step_count": len(parsed["expanded_steps"]),
                        "is_builtin": True,
                        "timeline": [
                            {"type": s["type"], "title": s["raw_title"], "exit": s["exit"]}
                            for s in parsed["expanded_steps"]
                        ],
                    }
                except Exception as e:
                    print(f"[WorkoutManager] Error loading built-in workout {fname}: {e}")

    # 2. Load User custom workouts (can override or add)
    if os.path.exists(USER_WORKOUTS_DIR):
        for fname in sorted(os.listdir(USER_WORKOUTS_DIR)):
            if fname.endswith((".yaml", ".yml")):
                fpath = os.path.join(USER_WORKOUTS_DIR, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        content = f.read()
                    parsed = parse_and_validate_workout(content, is_builtin=False, file_path=fpath)
                    workouts_map[parsed["id"]] = {
                        "id": parsed["id"],
                        "title": parsed["title"],
                        "description": parsed["description"],
                        "author": parsed["author"],
                        "category": parsed["category"],
                        "difficulty": parsed["difficulty"],
                        "tags": parsed["tags"],
                        "settings": parsed["settings"],
                        "estimates": parsed["estimates"],
                        "step_count": len(parsed["expanded_steps"]),
                        "is_builtin": False,
                        "timeline": [
                            {"type": s["type"], "title": s["raw_title"], "exit": s["exit"]}
                            for s in parsed["expanded_steps"]
                        ],
                    }
                except Exception as e:
                    print(f"[WorkoutManager] Error loading custom workout {fname}: {e}")

    return list(workouts_map.values())


def get_workout(workout_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves full parsed workout by ID with all expanded steps and raw YAML."""
    ensure_workout_directories()

    # Check user dir first
    for d, is_builtin in [(USER_WORKOUTS_DIR, False), (BUILTIN_WORKOUTS_DIR, True)]:
        if os.path.exists(d):
            for ext in [".yaml", ".yml"]:
                fpath = os.path.join(d, f"{workout_id}{ext}")
                if os.path.exists(fpath):
                    with open(fpath, "r", encoding="utf-8") as f:
                        content = f.read()
                    return parse_and_validate_workout(content, is_builtin=is_builtin, file_path=fpath)

    # Search by parsed ID inside all files if filename doesn't match slug
    for d, is_builtin in [(USER_WORKOUTS_DIR, False), (BUILTIN_WORKOUTS_DIR, True)]:
        if os.path.exists(d):
            for fname in os.listdir(d):
                if fname.endswith((".yaml", ".yml")):
                    fpath = os.path.join(d, fname)
                    try:
                        with open(fpath, "r", encoding="utf-8") as f:
                            content = f.read()
                        parsed = parse_and_validate_workout(content, is_builtin=is_builtin, file_path=fpath)
                        if parsed["id"] == workout_id:
                            return parsed
                    except Exception:
                        pass

    return None


def save_workout(yaml_content: str, override_id: Optional[str] = None) -> Dict[str, Any]:
    """Validates and persists a user custom workout YAML file."""
    ensure_workout_directories()
    parsed = parse_and_validate_workout(yaml_content, is_builtin=False)
    workout_id = override_id or parsed["id"]

    # Protect built-in workouts from direct overwrite
    builtin_path = os.path.join(BUILTIN_WORKOUTS_DIR, f"{workout_id}.yaml")
    if os.path.exists(builtin_path):
        workout_id = f"{workout_id}-custom"
        parsed["id"] = workout_id

    file_path = os.path.join(USER_WORKOUTS_DIR, f"{workout_id}.yaml")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(yaml_content)

    parsed["file_path"] = file_path
    return parsed


def delete_workout(workout_id: str) -> bool:
    """Deletes a custom workout. Built-in workouts cannot be deleted."""
    ensure_workout_directories()

    w = get_workout(workout_id)
    if not w:
        return False

    if w.get("is_builtin"):
        raise ValueError("Built-in workouts are read-only and cannot be deleted.")

    file_path = w.get("file_path")
    if file_path and os.path.exists(file_path):
        os.remove(file_path)
        return True

    return False
