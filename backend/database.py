import sqlite3
import os
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
        video_id TEXT,
        audio_source TEXT,
        notes TEXT
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
        notes TEXT DEFAULT '',
        created_at REAL DEFAULT 0.0
    )
    """)

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

    cursor.execute("""
    INSERT OR REPLACE INTO tracks (
        id, name, video_id, start_time, end_time, default_audio, allowed_audios, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        track_id,
        track_data.get("name", "Untitled Track"),
        track_data.get("video_id", ""),
        float(track_data.get("start_time", 0.0)),
        float(track_data.get("end_time", 0.0)),
        track_data.get("default_audio", "original"),
        allowed_json,
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

    cursor.execute("""
    INSERT OR REPLACE INTO workouts (
        id, start_time, end_time, duration_seconds, distance_meters,
        total_strokes, avg_spm, avg_split, avg_watts, max_watts,
        avg_hr, video_id, audio_source, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        workout_data.get("video_id"),
        workout_data.get("audio_source"),
        workout_data.get("notes", "")
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
           avg_hr, video_id, audio_source, notes
    FROM workouts
    ORDER BY start_time DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_workout(workout_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM workouts WHERE id = ?", (workout_id,))
    workout_row = cursor.fetchone()
    if not workout_row:
        conn.close()
        return None

    workout = dict(workout_row)
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
