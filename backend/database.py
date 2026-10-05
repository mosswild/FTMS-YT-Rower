import sqlite3
import os
import json
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

DATA_DIR = os.getenv("DATA_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data")))
DB_PATH = os.path.join(DATA_DIR, "sessions.db")

def get_db_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS workouts (
        id TEXT PRIMARY KEY,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_seconds INTEGER DEFAULT 0,
        distance_meters REAL DEFAULT 0.0,
        total_strokes INTEGER DEFAULT 0,
        avg_spm REAL DEFAULT 0.0,
        avg_split REAL DEFAULT 0.0,
        avg_watts REAL DEFAULT 0.0,
        max_watts REAL DEFAULT 0.0,
        avg_hr REAL DEFAULT 0.0,
        max_hr REAL DEFAULT 0.0,
        splat_points INTEGER DEFAULT 0,
        intensity_points INTEGER DEFAULT 0,
        video_id TEXT,
        audio_source TEXT,
        notes TEXT,
        laps TEXT DEFAULT '[]'
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS workout_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workout_id TEXT NOT NULL,
        elapsed_seconds REAL NOT NULL,
        stroke_rate REAL DEFAULT 0.0,
        split_seconds REAL DEFAULT 0.0,
        watts REAL DEFAULT 0.0,
        hr REAL DEFAULT 0.0,
        distance REAL DEFAULT 0.0,
        FOREIGN KEY (workout_id) REFERENCES workouts (id) ON DELETE CASCADE
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        video_id TEXT NOT NULL,
        start_time REAL DEFAULT 0.0,
        end_time REAL DEFAULT 0.0,
        default_audio TEXT DEFAULT 'original',
        allowed_audios TEXT DEFAULT '[]',
        fixed_speed INTEGER DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at REAL DEFAULT 0.0
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_profiles (
        id TEXT PRIMARY KEY,
        name TEXT DEFAULT 'Athlete',
        age INTEGER DEFAULT 30,
        gender TEXT DEFAULT 'unspecified',
        rest_hr INTEGER DEFAULT 60,
        formula TEXT DEFAULT 'tanaka',
        calibration_mode TEXT DEFAULT 'auto',
        manual_max_hr INTEGER DEFAULT 187,
        calibrated_max_hr REAL DEFAULT 0.0,
        active_max_hr INTEGER DEFAULT 187,
        last_calibrated_at TEXT,
        updated_at TEXT
    )
    """)

    # Migration for existing databases
    try:
        cursor.execute("ALTER TABLE tracks ADD COLUMN fixed_speed INTEGER DEFAULT 0")
    except Exception:
        pass

    try:
        cursor.execute("ALTER TABLE workouts ADD COLUMN laps TEXT DEFAULT '[]'")
    except Exception:
        pass

    try:
        cursor.execute("ALTER TABLE workouts ADD COLUMN max_hr REAL DEFAULT 0.0")
    except Exception:
        pass

    try:
        cursor.execute("ALTER TABLE workouts ADD COLUMN splat_points INTEGER DEFAULT 0")
    except Exception:
        pass

    try:
        cursor.execute("ALTER TABLE workouts ADD COLUMN intensity_points INTEGER DEFAULT 0")
    except Exception:
        pass

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_samples_workout ON workout_samples(workout_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tracks_video ON tracks(video_id)")
    conn.commit()
    conn.close()

def save_track(track_data: Dict[str, Any]) -> str:
    import json
    import time
    conn = get_db_connection()
    cursor = conn.cursor()
    track_id = track_data.get("id") or f"track_{int(time.time() * 1000)}"
    allowed_json = json.dumps(track_data.get("allowed_audios", [])) if isinstance(track_data.get("allowed_audios"), list) else str(track_data.get("allowed_audios", "[]"))
    fixed_speed_int = 1 if track_data.get("fixed_speed") else 0

    cursor.execute("""
    INSERT OR REPLACE INTO tracks (
        id, name, video_id, start_time, end_time, default_audio, allowed_audios, fixed_speed, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        track_id,
        track_data.get("name", "Untitled Track"),
        track_data.get("video_id", ""),
        float(track_data.get("start_time", 0.0)),
        float(track_data.get("end_time", 0.0)),
        track_data.get("default_audio", "original"),
        allowed_json,
        fixed_speed_int,
        track_data.get("notes", ""),
        float(track_data.get("created_at", time.time()))
    ))
    conn.commit()
    conn.close()
    return track_id

def list_tracks() -> List[Dict[str, Any]]:
    import json
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tracks ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        try:
            d["allowed_audios"] = json.loads(d.get("allowed_audios") or "[]")
        except Exception:
            d["allowed_audios"] = []
        d["fixed_speed"] = bool(d.get("fixed_speed", 0))
        result.append(d)
    return result

def get_track(track_id: str) -> Optional[Dict[str, Any]]:
    import json
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tracks WHERE id = ?", (track_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    try:
        d["allowed_audios"] = json.loads(d.get("allowed_audios") or "[]")
    except Exception:
        d["allowed_audios"] = []
    d["fixed_speed"] = bool(d.get("fixed_speed", 0))
    return d

def delete_track(track_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted


def save_workout(workout_data: Dict[str, Any], samples: Optional[List[Dict[str, Any]]] = None) -> str:
    conn = get_db_connection()
    cursor = conn.cursor()
    workout_id = workout_data["id"]

    laps_data = workout_data.get("laps", [])
    laps_json = json.dumps(laps_data) if isinstance(laps_data, list) else str(laps_data or "[]")

    pts = workout_data.get("intensity_points", workout_data.get("splat_points", 0))

    cursor.execute("""
    INSERT OR REPLACE INTO workouts (
        id, start_time, end_time, duration_seconds, distance_meters,
        total_strokes, avg_spm, avg_split, avg_watts, max_watts,
        avg_hr, max_hr, splat_points, intensity_points, video_id, audio_source, notes, laps
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        workout_id,
        workout_data.get("start_time"),
        workout_data.get("end_time"),
        workout_data.get("duration_seconds", 0),
        workout_data.get("distance_meters", 0.0),
        workout_data.get("total_strokes", 0),
        workout_data.get("avg_spm", 0.0),
        workout_data.get("avg_split", 0.0),
        workout_data.get("avg_watts", 0.0),
        workout_data.get("max_watts", 0.0),
        workout_data.get("avg_hr", 0.0),
        workout_data.get("max_hr", 0.0),
        pts,
        pts,
        workout_data.get("video_id"),
        workout_data.get("audio_source"),
        workout_data.get("notes", ""),
        laps_json
    ))

    if samples:
        # Delete existing samples for this workout if re-saving
        cursor.execute("DELETE FROM workout_samples WHERE workout_id = ?", (workout_id,))
        sample_rows = [
            (
                workout_id,
                s.get("elapsed_seconds", 0.0),
                s.get("stroke_rate", 0.0),
                s.get("split_seconds", 0.0),
                s.get("watts", 0.0),
                s.get("hr", 0.0),
                s.get("distance", 0.0)
            )
            for s in samples
        ]
        cursor.executemany("""
        INSERT INTO workout_samples (
            workout_id, elapsed_seconds, stroke_rate, split_seconds, watts, hr, distance
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, sample_rows)

    conn.commit()
    conn.close()
    return workout_id

def list_workouts() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, start_time, end_time, duration_seconds, distance_meters,
           total_strokes, avg_spm, avg_split, avg_watts, max_watts,
           avg_hr, max_hr, splat_points, intensity_points, video_id, audio_source, notes, laps
    FROM workouts
    ORDER BY start_time DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        pts = d.get("intensity_points") if d.get("intensity_points") is not None else d.get("splat_points", 0)
        d["intensity_points"] = pts
        d["splat_points"] = pts
        try:
            d["laps"] = json.loads(d.get("laps") or "[]")
        except Exception:
            d["laps"] = []
        result.append(d)
    return result

def get_workout(workout_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM workouts WHERE id = ?", (workout_id,))
    workout_row = cursor.fetchone()
    if not workout_row:
        conn.close()
        return None

    workout = dict(workout_row)
    try:
        workout["laps"] = json.loads(workout.get("laps") or "[]")
    except Exception:
        workout["laps"] = []

    cursor.execute("""
    SELECT elapsed_seconds, stroke_rate, split_seconds, watts, hr, distance
    FROM workout_samples
    WHERE workout_id = ?
    ORDER BY elapsed_seconds ASC
    """, (workout_id,))
    workout["samples"] = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return workout

def delete_workout(workout_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM workouts WHERE id = ?", (workout_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

def delete_workouts(workout_ids: List[str]) -> int:
    if not workout_ids:
        return 0
    conn = get_db_connection()
    cursor = conn.cursor()
    placeholders = ",".join(["?"] * len(workout_ids))
    cursor.execute(f"DELETE FROM workouts WHERE id IN ({placeholders})", tuple(workout_ids))
    deleted_count = cursor.rowcount
    conn.commit()
    conn.close()
    return deleted_count


def get_user_profile(profile_id: str = "default") -> Dict[str, Any]:
    """Retrieves a user profile, initializing with default 30yo Tanaka baseline if not found."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM user_profiles WHERE id = ?", (profile_id,))
    row = cursor.fetchone()
    if row:
        profile = dict(row)
        conn.close()
        return profile

    # Default profile creation
    now_iso = datetime.now(timezone.utc).isoformat()
    default_profile = {
        "id": profile_id,
        "name": "Athlete",
        "age": 30,
        "gender": "unspecified",
        "rest_hr": 60,
        "formula": "tanaka",
        "calibration_mode": "auto",
        "manual_max_hr": 187,
        "calibrated_max_hr": 0.0,
        "active_max_hr": 187,
        "last_calibrated_at": None,
        "updated_at": now_iso,
    }
    cursor.execute("""
    INSERT OR REPLACE INTO user_profiles (
        id, name, age, gender, rest_hr, formula, calibration_mode,
        manual_max_hr, calibrated_max_hr, active_max_hr, last_calibrated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        default_profile["id"],
        default_profile["name"],
        default_profile["age"],
        default_profile["gender"],
        default_profile["rest_hr"],
        default_profile["formula"],
        default_profile["calibration_mode"],
        default_profile["manual_max_hr"],
        default_profile["calibrated_max_hr"],
        default_profile["active_max_hr"],
        default_profile["last_calibrated_at"],
        default_profile["updated_at"],
    ))
    conn.commit()
    conn.close()
    return default_profile


def save_user_profile(profile_data: Dict[str, Any]) -> Dict[str, Any]:
    """Saves or updates a user profile."""
    conn = get_db_connection()
    cursor = conn.cursor()
    profile_id = profile_data.get("id", "default")
    now_iso = datetime.now(timezone.utc).isoformat()

    cursor.execute("""
    INSERT OR REPLACE INTO user_profiles (
        id, name, age, gender, rest_hr, formula, calibration_mode,
        manual_max_hr, calibrated_max_hr, active_max_hr, last_calibrated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        profile_id,
        profile_data.get("name", "Athlete"),
        int(profile_data.get("age", 30)),
        profile_data.get("gender", "unspecified"),
        int(profile_data.get("rest_hr", 60)),
        profile_data.get("formula", "tanaka"),
        profile_data.get("calibration_mode", "auto"),
        int(profile_data.get("manual_max_hr", 187)),
        float(profile_data.get("calibrated_max_hr", 0.0)),
        int(profile_data.get("active_max_hr", 187)),
        profile_data.get("last_calibrated_at"),
        now_iso,
    ))
    conn.commit()
    conn.close()
    return get_user_profile(profile_id)


def get_recent_workouts_for_calibration(limit: int = 100) -> List[Dict[str, Any]]:
    """Retrieves recent completed workouts with their heart rate samples for calibration analysis."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, start_time, duration_seconds, distance_meters, avg_hr, max_hr, splat_points
    FROM workouts
    WHERE duration_seconds >= 600 AND avg_hr >= 85
    ORDER BY start_time DESC
    LIMIT ?
    """, (limit,))
    workout_rows = cursor.fetchall()

    results = []
    for r in workout_rows:
        w = dict(r)
        w_id = w["id"]
        cursor.execute("""
        SELECT elapsed_seconds, hr
        FROM workout_samples
        WHERE workout_id = ? AND hr > 40
        ORDER BY elapsed_seconds ASC
        """, (w_id,))
        w["samples"] = [dict(s) for s in cursor.fetchall()]
        results.append(w)

    conn.close()
    return results


