import os
import json
import shutil
import asyncio
import threading
import uuid
from typing import Dict, Any, List, Optional
import yt_dlp

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MEDIA_DIR = os.getenv("MEDIA_DIR", os.path.join(BASE_DIR, "media"))
VIDEOS_DIR = os.path.join(MEDIA_DIR, "videos")
AUDIO_DIR = os.path.join(MEDIA_DIR, "audio")

os.makedirs(VIDEOS_DIR, exist_ok=True)
os.makedirs(AUDIO_DIR, exist_ok=True)

# In-memory download task tracker
# task_id -> { id, url, type, status, progress, speed, eta, title, error, file_id }
DOWNLOAD_TASKS: Dict[str, Dict[str, Any]] = {}

def get_ffmpeg_path() -> Optional[str]:
    return shutil.which("ffmpeg") or "/usr/local/bin/ffmpeg"

def parse_progress_hook(task_id: str):
    def hook(d):
        task = DOWNLOAD_TASKS.get(task_id)
        if not task:
            return

        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            percent = (downloaded / total * 100) if total > 0 else 0.0
            
            task["status"] = "downloading"
            task["progress"] = round(percent, 1)
            task["speed"] = d.get("_speed_str", "").strip()
            task["eta"] = d.get("_eta_str", "").strip()
            if not task.get("title") and d.get("info_dict"):
                task["title"] = d["info_dict"].get("title", "")
        elif status == "finished":
            task["status"] = "processing"
            task["progress"] = 100.0
    return hook

def run_download_worker(task_id: str, url: str, dl_type: str):
    task = DOWNLOAD_TASKS[task_id]
    ffmpeg_path = get_ffmpeg_path()
    
    try:
        task["status"] = "extracting_metadata"
        # Extract info first
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
            info = ydl.extract_info(url, download=False)
            video_id = info.get("id")
            title = info.get("title", "Unknown Title")
            duration = info.get("duration", 0)
            thumbnail = info.get("thumbnail", "")
            task["title"] = title
            task["file_id"] = video_id

        # Download Video if requested (type == "video" or "both")
        if dl_type in ("video", "both"):
            task["status"] = "downloading_video"
            video_opts = {
                "format": "bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "merge_output_format": "mp4",
                "outtmpl": os.path.join(VIDEOS_DIR, "%(id)s.%(ext)s"),
                "ffmpeg_location": ffmpeg_path,
                "progress_hooks": [parse_progress_hook(task_id)],
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(video_opts) as ydl:
                ydl.download([url])

            # Save video metadata
            meta_path = os.path.join(VIDEOS_DIR, f"{video_id}.json")
            video_file = os.path.join(VIDEOS_DIR, f"{video_id}.mp4")
            meta = {
                "id": video_id,
                "title": title,
                "duration": duration,
                "thumbnail": thumbnail,
                "filename": f"{video_id}.mp4",
                "size_bytes": os.path.getsize(video_file) if os.path.exists(video_file) else 0,
                "created_at": os.path.getmtime(video_file) if os.path.exists(video_file) else 0,
            }
            with open(meta_path, "w") as f:
                json.dump(meta, f, indent=2)

        # Download Standalone Audio if requested (type == "audio" or "both")
        if dl_type in ("audio", "both"):
            task["status"] = "downloading_audio"
            audio_opts = {
                "format": "bestaudio/best",
                "postprocessors": [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "m4a",
                    "preferredquality": "192",
                }],
                "outtmpl": os.path.join(AUDIO_DIR, "%(id)s.%(ext)s"),
                "ffmpeg_location": ffmpeg_path,
                "progress_hooks": [parse_progress_hook(task_id)],
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(audio_opts) as ydl:
                ydl.download([url])

            # Save audio metadata
            meta_path = os.path.join(AUDIO_DIR, f"{video_id}.json")
            audio_file = os.path.join(AUDIO_DIR, f"{video_id}.m4a")
            meta = {
                "id": video_id,
                "title": title,
                "duration": duration,
                "thumbnail": thumbnail,
                "filename": f"{video_id}.m4a",
                "size_bytes": os.path.getsize(audio_file) if os.path.exists(audio_file) else 0,
                "created_at": os.path.getmtime(audio_file) if os.path.exists(audio_file) else 0,
            }
            with open(meta_path, "w") as f:
                json.dump(meta, f, indent=2)

        task["status"] = "completed"
        task["progress"] = 100.0

    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)

def start_download_task(url: str, dl_type: str = "both") -> str:
    task_id = str(uuid.uuid4())
    DOWNLOAD_TASKS[task_id] = {
        "task_id": task_id,
        "url": url,
        "type": dl_type,
        "status": "pending",
        "progress": 0.0,
        "speed": "",
        "eta": "",
        "title": "",
        "error": None,
        "file_id": None,
    }
    thread = threading.Thread(target=run_download_worker, args=(task_id, url, dl_type), daemon=True)
    thread.start()
    return task_id

def get_download_tasks() -> List[Dict[str, Any]]:
    return list(DOWNLOAD_TASKS.values())

def get_download_status(task_id: str) -> Optional[Dict[str, Any]]:
    return DOWNLOAD_TASKS.get(task_id)

def get_library() -> Dict[str, List[Dict[str, Any]]]:
    """Scan VIDEOS_DIR and AUDIO_DIR for cached media files."""
    videos = []
    audios = []

    # Videos
    for fname in os.listdir(VIDEOS_DIR):
        if fname.endswith(".mp4"):
            video_id = os.path.splitext(fname)[0]
            meta_file = os.path.join(VIDEOS_DIR, f"{video_id}.json")
            filepath = os.path.join(VIDEOS_DIR, fname)
            
            if os.path.exists(meta_file):
                try:
                    with open(meta_file, "r") as f:
                        meta = json.load(f)
                except Exception:
                    meta = {}
            else:
                meta = {}

            videos.append({
                "id": video_id,
                "title": meta.get("title", f"Video {video_id}"),
                "duration": meta.get("duration", 0),
                "thumbnail": meta.get("thumbnail", ""),
                "filename": fname,
                "size_bytes": meta.get("size_bytes", os.path.getsize(filepath)),
                "created_at": meta.get("created_at", os.path.getmtime(filepath)),
                "has_matching_audio": os.path.exists(os.path.join(AUDIO_DIR, f"{video_id}.m4a")),
            })

    # Standalone Audio
    for fname in os.listdir(AUDIO_DIR):
        if fname.endswith(".m4a") or fname.endswith(".mp3"):
            audio_id = os.path.splitext(fname)[0]
            meta_file = os.path.join(AUDIO_DIR, f"{audio_id}.json")
            filepath = os.path.join(AUDIO_DIR, fname)
            
            if os.path.exists(meta_file):
                try:
                    with open(meta_file, "r") as f:
                        meta = json.load(f)
                except Exception:
                    meta = {}
            else:
                meta = {}

            audios.append({
                "id": audio_id,
                "title": meta.get("title", f"Track {audio_id}"),
                "duration": meta.get("duration", 0),
                "thumbnail": meta.get("thumbnail", ""),
                "filename": fname,
                "size_bytes": meta.get("size_bytes", os.path.getsize(filepath)),
                "created_at": meta.get("created_at", os.path.getmtime(filepath)),
            })

    # Sort descending by created_at
    videos.sort(key=lambda x: x.get("created_at", 0), reverse=True)
    audios.sort(key=lambda x: x.get("created_at", 0), reverse=True)

    return {"videos": videos, "audio": audios}

def delete_media_file(media_type: str, item_id: str) -> bool:
    target_dir = VIDEOS_DIR if media_type == "video" else AUDIO_DIR
    deleted = False
    for ext in [".mp4", ".m4a", ".mp3", ".json"]:
        p = os.path.join(target_dir, f"{item_id}{ext}")
        if os.path.exists(p):
            os.remove(p)
            deleted = True
    return deleted
