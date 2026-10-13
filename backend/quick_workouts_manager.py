import time
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from backend.database import get_db_connection, list_tracks, get_track
import backend.workout_manager as workout_mgr


DEFAULT_QUICK_CARDS = [
    {
        "id": "glacier-lake-primer",
        "title": "Glacier Lake Primer",
        "description": "10m technique warmup on serene glacial water.",
        "track_hint": "glacier",
        "fallback_track_id": "track-glacier",
        "workout_id": "10m-stroke-technique-primer",
    },
    {
        "id": "thames-zone2-cruise",
        "title": "Thames Zone 2 Cruise",
        "description": "Steady 30-minute aerobic endurance base building.",
        "track_hint": "scull",
        "fallback_track_id": "track-thames",
        "workout_id": "30m-zone2-aerobic-base",
    },
    {
        "id": "fast-water-hiit",
        "title": "Fast Water HIIT",
        "description": "High-intensity stroke rate intervals for maximum calorie burn.",
        "track_hint": "lake",
        "fallback_track_id": "track-fast-water",
        "workout_id": "15m-calorie-burner-hiit",
    },
    {
        "id": "classic-2k-benchmark",
        "title": "Classic 2,000m Benchmark",
        "description": "Standard 2k pacing trial to test your aerobic threshold.",
        "track_hint": "ocean",
        "fallback_track_id": "track-sprint",
        "workout_id": "2000m-beginner-milestone",
    },
]


def _match_track_id(tracks: List[Dict[str, Any]], hint: str, fallback_id: str, index: int) -> str:
    """Attempts to match a track from the library by hint keyword, otherwise uses fallback."""
    if not tracks:
        return fallback_id
    hint_lower = hint.lower()
    for t in tracks:
        name = str(t.get("name", "")).lower()
        t_id = str(t.get("id", "")).lower()
        if hint_lower in name or hint_lower in t_id:
            return t["id"]
    return tracks[index % len(tracks)]["id"]


def ensure_default_quick_workouts() -> None:
    """Seeds the 4 default Quick Workout cards if no defaults exist."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM quick_workouts WHERE is_default = 1")
    count = cursor.fetchone()[0]

    if count == 0:
        tracks = list_tracks()
        now_iso = datetime.now(timezone.utc).isoformat()

        for idx, cfg in enumerate(DEFAULT_QUICK_CARDS):
            chosen_track_id = _match_track_id(tracks, cfg["track_hint"], cfg["fallback_track_id"], idx)
            cursor.execute("""
            INSERT OR IGNORE INTO quick_workouts (
                id, user_id, title, description, track_id, workout_id, is_default, created_at
            ) VALUES (?, NULL, ?, ?, ?, ?, 1, ?)
            """, (
                cfg["id"],
                cfg["title"],
                cfg["description"],
                chosen_track_id,
                cfg["workout_id"],
                now_iso
            ))
        conn.commit()

    conn.close()


def _enrich_card(row_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Attaches track and workout metadata to a quick workout card."""
    card = dict(row_dict)
    card["is_default"] = bool(card.get("is_default", 0))

    # Enrich track details
    track_id = card.get("track_id")
    track = get_track(track_id) if track_id else None
    if track:
        card["track_name"] = track.get("name", "Unknown Track")
        card["video_id"] = track.get("video_id", "")
        card["fixed_speed"] = bool(track.get("fixed_speed", False))
        card["default_audio"] = track.get("default_audio", "original")
    else:
        card["track_name"] = "Scenic Track"
        card["video_id"] = ""
        card["fixed_speed"] = False
        card["default_audio"] = "original"

    # Enrich workout details
    workout_id = card.get("workout_id")
    if workout_id and workout_id != "free_row":
        try:
            workout = workout_mgr.get_workout(workout_id)
            if workout:
                card["workout_title"] = workout.get("title", workout_id)
                card["workout_category"] = workout.get("category", "General")
                card["workout_difficulty"] = workout.get("difficulty", "all")
                estimates = workout.get("estimates", {})
                card["estimated_duration_seconds"] = estimates.get("estimated_duration_seconds", 0)
                card["estimated_distance_meters"] = estimates.get("estimated_distance_meters", 0)
                card["total_steps"] = estimates.get("total_steps", 0)
            else:
                card["workout_title"] = workout_id
                card["workout_category"] = "General"
                card["workout_difficulty"] = "all"
                card["estimated_duration_seconds"] = 0
                card["estimated_distance_meters"] = 0
                card["total_steps"] = 0
        except Exception:
            card["workout_title"] = workout_id
            card["workout_category"] = "General"
            card["workout_difficulty"] = "all"
            card["estimated_duration_seconds"] = 0
            card["estimated_distance_meters"] = 0
            card["total_steps"] = 0
    else:
        card["workout_title"] = "Free Row"
        card["workout_category"] = "Free Row"
        card["workout_difficulty"] = "all"
        card["estimated_duration_seconds"] = 0
        card["estimated_distance_meters"] = 0
        card["total_steps"] = 0

    return card


def list_quick_workouts(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Returns default cards combined with user-specific cards."""
    conn = get_db_connection()
    cursor = conn.cursor()

    if user_id:
        cursor.execute("""
        SELECT * FROM quick_workouts
        WHERE is_default = 1 OR user_id = ?
        ORDER BY is_default DESC, created_at DESC
        """, (user_id,))
    else:
        cursor.execute("""
        SELECT * FROM quick_workouts
        WHERE is_default = 1
        ORDER BY created_at ASC
        """)

    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()

    return [_enrich_card(r) for r in rows]


def get_quick_workout(card_id: str) -> Optional[Dict[str, Any]]:
    """Fetches a single quick workout card by ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM quick_workouts WHERE id = ?", (card_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None
    return _enrich_card(dict(row))


def create_quick_workout(data: Dict[str, Any]) -> Dict[str, Any]:
    """Creates a custom user quick workout card."""
    card_id = data.get("id") or f"card_{int(time.time() * 1000)}"
    user_id = data.get("user_id")
    title = (data.get("title") or "Custom Workout").strip()
    description = (data.get("description") or "").strip()
    track_id = data.get("track_id", "").strip()
    workout_id = (data.get("workout_id") or "free_row").strip()
    now_iso = datetime.now(timezone.utc).isoformat()

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO quick_workouts (
        id, user_id, title, description, track_id, workout_id, is_default, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    """, (
        card_id,
        user_id,
        title,
        description,
        track_id,
        workout_id,
        now_iso
    ))
    conn.commit()
    conn.close()

    return get_quick_workout(card_id)  # type: ignore


def update_quick_workout(card_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Updates a quick workout card (default cards cannot be changed to non-default or re-assigned)."""
    current = get_quick_workout(card_id)
    if not current:
        return None

    title = data.get("title", current["title"])
    description = data.get("description", current.get("description", ""))
    track_id = data.get("track_id", current["track_id"])
    workout_id = data.get("workout_id", current.get("workout_id"))

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE quick_workouts
    SET title = ?, description = ?, track_id = ?, workout_id = ?
    WHERE id = ?
    """, (title, description, track_id, workout_id, card_id))
    conn.commit()
    conn.close()

    return get_quick_workout(card_id)


def delete_quick_workout(card_id: str) -> bool:
    """Deletes a quick workout card. Default system cards cannot be deleted."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT is_default FROM quick_workouts WHERE id = ?", (card_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return False
    if row["is_default"] == 1:
        conn.close()
        raise ValueError("Cannot delete system default quick workout cards.")

    cursor.execute("DELETE FROM quick_workouts WHERE id = ?", (card_id,))
    conn.commit()
    conn.close()
    return True
