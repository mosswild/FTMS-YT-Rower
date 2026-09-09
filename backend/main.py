import os
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional, List
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.database import (
    init_db, save_workout, list_workouts, get_workout, delete_workout,
    save_track, list_tracks, get_track, delete_track
)
from backend.downloader import (
    start_download_task, get_download_tasks, get_download_status,
    cancel_download_task, delete_download_task, clear_inactive_tasks,
    update_media_title, get_library, delete_media_file, VIDEOS_DIR, AUDIO_DIR
)
from backend.streaming import range_streaming_response
from backend.tcx_generator import generate_tcx

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="FTMS Modern Rower Dashboard", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- Models -----------------
class DownloadRequest(BaseModel):
    url: str
    type: str = Field(default="both", description="video, audio, or both")

class MediaRenameRequest(BaseModel):
    title: str

class WorkoutSampleModel(BaseModel):
    elapsed_seconds: float
    stroke_rate: float = 0.0
    split_seconds: float = 0.0
    watts: float = 0.0
    hr: float = 0.0
    distance: float = 0.0

class WorkoutSaveRequest(BaseModel):
    id: str
    start_time: str
    end_time: Optional[str] = None
    duration_seconds: int = 0
    distance_meters: float = 0.0
    total_strokes: int = 0
    avg_spm: float = 0.0
    avg_split: float = 0.0
    avg_watts: float = 0.0
    max_watts: float = 0.0
    avg_hr: float = 0.0
    max_hr: Optional[float] = 0.0
    video_id: Optional[str] = None
    audio_source: Optional[str] = None
    notes: Optional[str] = ""
    samples: Optional[List[WorkoutSampleModel]] = None

# ----------------- Media Ingestion Endpoints -----------------
@app.post("/api/download")
async def create_download(req: DownloadRequest):
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="Valid URL is required")
    task_id = start_download_task(req.url.strip(), req.type)
    return {"task_id": task_id, "status": "started"}

@app.get("/api/download/status")
async def list_download_status():
    return {"tasks": get_download_tasks()}

@app.get("/api/download/status/{task_id}")
async def get_single_download_status(task_id: str):
    status = get_download_status(task_id)
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    return status

@app.post("/api/download/{task_id}/cancel")
async def cancel_download_task_endpoint(task_id: str):
    success = cancel_download_task(task_id, delete_from_queue=False)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task_id": task_id, "status": "cancelled"}

@app.delete("/api/download/{task_id}")
async def delete_download_task_endpoint(task_id: str):
    success = delete_download_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task_id": task_id, "deleted": True}

@app.delete("/api/download/queue/clear")
async def clear_download_queue_endpoint():
    count = clear_inactive_tasks()
    return {"cleared": count}

@app.get("/api/library")
async def get_media_library():
    return get_library()

@app.delete("/api/media/{media_type}/{item_id}")
async def delete_media(media_type: str, item_id: str):
    if media_type not in ("video", "audio"):
        raise HTTPException(status_code=400, detail="Invalid media type")
    deleted = delete_media_file(media_type, item_id)
    return {"deleted": deleted}

@app.patch("/api/media/{media_type}/{item_id}")
@app.put("/api/media/{media_type}/{item_id}")
async def rename_media(media_type: str, item_id: str, req: MediaRenameRequest):
    if media_type not in ("video", "audio"):
        raise HTTPException(status_code=400, detail="Invalid media type. Must be 'video' or 'audio'")
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    
    updated = update_media_title(media_type, item_id, title)
    if not updated:
        raise HTTPException(status_code=404, detail="Media item not found")
    return {"id": item_id, "media_type": media_type, "title": title, "meta": updated}

# ----------------- Streaming Endpoints (HTTP 206) -----------------
@app.get("/api/media/video/{video_id}")
async def stream_video(video_id: str, request: Request):
    # Support both id with or without extension
    clean_id = video_id[:-4] if video_id.endswith(".mp4") else video_id
    file_path = os.path.join(VIDEOS_DIR, f"{clean_id}.mp4")
    range_header = request.headers.get("range")
    return range_streaming_response(file_path, range_header, media_type="video/mp4")

@app.get("/api/media/audio/{audio_id}")
async def stream_audio(audio_id: str, request: Request):
    clean_id = audio_id
    for ext in [".m4a", ".mp3"]:
        if audio_id.endswith(ext):
            clean_id = audio_id[:-len(ext)]
            break

    # Look for m4a first, then mp3
    file_path = os.path.join(AUDIO_DIR, f"{clean_id}.m4a")
    media_type = "audio/mp4"
    if not os.path.isfile(file_path):
        file_path = os.path.join(AUDIO_DIR, f"{clean_id}.mp3")
        media_type = "audio/mpeg"

    range_header = request.headers.get("range")
    return range_streaming_response(file_path, range_header, media_type=media_type)

@app.get("/api/media/thumbnail/{video_id}")
async def get_video_thumbnail(video_id: str):
    clean_id = video_id.replace(".mp4", "")
    jpg_path = os.path.join(VIDEOS_DIR, f"{clean_id}.jpg")
    if os.path.isfile(jpg_path):
        return FileResponse(jpg_path, media_type="image/jpeg")

    meta_path = os.path.join(VIDEOS_DIR, f"{clean_id}.json")
    if os.path.isfile(meta_path):
        try:
            import json
            with open(meta_path) as f:
                meta = json.load(f)
            thumb_url = meta.get("thumbnail")
            if thumb_url and thumb_url.startswith("http"):
                return RedirectResponse(thumb_url)
        except Exception:
            pass

    video_path = os.path.join(VIDEOS_DIR, f"{clean_id}.mp4")
    if os.path.isfile(video_path):
        import subprocess
        try:
            subprocess.run([
                "ffmpeg", "-y", "-ss", "1", "-i", video_path,
                "-vframes", "1", "-q:v", "2", jpg_path
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if os.path.isfile(jpg_path):
                return FileResponse(jpg_path, media_type="image/jpeg")
        except Exception:
            pass

    raise HTTPException(status_code=404, detail="Thumbnail not available")

# ----------------- Workout Persistence Endpoints -----------------
@app.get("/api/sessions")
async def get_sessions():
    sessions = list_workouts()
    return {"sessions": sessions}

@app.post("/api/sessions")
async def create_session(workout: WorkoutSaveRequest):
    data = workout.model_dump(exclude={"samples"})
    samples = [s.model_dump() for s in workout.samples] if workout.samples else None
    saved_id = save_workout(data, samples)
    return {"id": saved_id, "status": "saved"}

@app.get("/api/sessions/{session_id}")
async def get_single_session(session_id: str):
    session = get_workout(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@app.delete("/api/sessions/{session_id}")
async def delete_single_session(session_id: str):
    success = delete_workout(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True}

@app.get("/api/sessions/{session_id}/export/tcx")
async def export_tcx(session_id: str):
    session = get_workout(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    tcx_data = generate_tcx(session)
    filename = f"workout_{session_id}.tcx"
    return Response(
        content=tcx_data,
        media_type="application/vnd.garmin.tcx+xml",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )

# ----------------- Track Configuration Endpoints -----------------
class TrackModel(BaseModel):
    id: Optional[str] = None
    name: str
    video_id: str
    start_time: float = 0.0
    end_time: float = 0.0
    default_audio: str = "original"
    allowed_audios: Optional[List[str]] = Field(default_factory=list)
    notes: Optional[str] = ""

@app.get("/api/tracks")
async def get_all_tracks():
    return {"tracks": list_tracks()}

@app.post("/api/tracks")
async def create_or_update_track(track: TrackModel):
    data = track.model_dump()
    saved_id = save_track(data)
    return {"id": saved_id, "status": "saved"}

@app.get("/api/tracks/{track_id}")
async def get_single_track(track_id: str):
    t = get_track(track_id)
    if not t:
        raise HTTPException(status_code=404, detail="Track not found")
    return t

@app.delete("/api/tracks/{track_id}")
async def delete_single_track(track_id: str):
    success = delete_track(track_id)
    if not success:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"deleted": True}


# ----------------- Static Frontend Mounting -----------------
app.mount("/css", StaticFiles(directory=os.path.join(ROOT_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(ROOT_DIR, "js")), name="js")
if os.path.exists(os.path.join(ROOT_DIR, "video")):
    app.mount("/video", StaticFiles(directory=os.path.join(ROOT_DIR, "video")), name="video")
app.mount("/", StaticFiles(directory=ROOT_DIR, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run("backend.main:app", host=host, port=port, reload=True)
