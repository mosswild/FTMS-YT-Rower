import os
import json
import shutil
import subprocess
import tempfile
import time
import uuid
from typing import Dict, Any, Optional
from fastapi import UploadFile, HTTPException

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MEDIA_DIR = os.getenv("MEDIA_DIR", os.path.join(BASE_DIR, "media"))
VIDEOS_DIR = os.path.join(MEDIA_DIR, "videos")
AUDIO_DIR = os.path.join(MEDIA_DIR, "audio")

os.makedirs(VIDEOS_DIR, exist_ok=True)
os.makedirs(AUDIO_DIR, exist_ok=True)

VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi", ".ts"}
AUDIO_EXTS = {".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".wma"}

def get_ffmpeg_path() -> str:
    return shutil.which("ffmpeg") or "/usr/local/bin/ffmpeg"

def get_ffprobe_path() -> str:
    return shutil.which("ffprobe") or "/usr/local/bin/ffprobe"

def probe_duration(filepath: str) -> float:
    """Extract media duration in seconds using ffprobe."""
    ffprobe_bin = get_ffprobe_path()
    if not os.path.exists(filepath) or not os.path.isfile(ffprobe_bin):
        return 0.0
    try:
        cmd = [
            ffprobe_bin,
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            filepath
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        dur = float(res.stdout.strip())
        return round(max(0.0, dur), 2)
    except Exception as ex:
        print(f"[Uploader] ffprobe error extracting duration from {filepath}: {ex}")
        return 0.0

def generate_video_thumbnail(video_path: str, thumb_path: str, duration: float = 0.0):
    """Generate a JPG poster thumbnail from video using ffmpeg."""
    ffmpeg_bin = get_ffmpeg_path()
    if not os.path.exists(video_path) or not os.path.isfile(ffmpeg_bin):
        return
    ss_time = "00:00:01" if duration > 1.5 else "00:00:00"
    try:
        subprocess.run([
            ffmpeg_bin, "-y",
            "-ss", ss_time,
            "-i", video_path,
            "-vframes", "1",
            "-q:v", "2",
            thumb_path
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    except Exception as ex:
        print(f"[Uploader] ffmpeg thumbnail generation error: {ex}")

async def save_uploaded_media(file: UploadFile, media_type: str = "auto", custom_title: Optional[str] = None) -> Dict[str, Any]:
    orig_name = file.filename or "uploaded_media"
    name_root, ext = os.path.splitext(orig_name)
    ext = ext.lower()

    # Determine resolved media type
    resolved_type = media_type.lower().strip()
    if resolved_type == "auto":
        if ext in VIDEO_EXTS or (file.content_type and file.content_type.startswith("video/")):
            resolved_type = "video"
        elif ext in AUDIO_EXTS or (file.content_type and file.content_type.startswith("audio/")):
            resolved_type = "audio"
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file format '{ext}'. Supported: {', '.join(sorted(VIDEO_EXTS | AUDIO_EXTS))}"
            )
    elif resolved_type not in ("video", "audio"):
        raise HTTPException(status_code=400, detail="Invalid media_type. Must be 'video', 'audio', or 'auto'.")

    # Format Title
    title = (custom_title or "").strip()
    if not title:
        # Sanitize filename into human-readable title
        clean_name = name_root.replace("_", " ").replace("-", " ").strip()
        title = clean_name.title() if clean_name else "Uploaded Media"

    item_id = f"up_{uuid.uuid4().hex[:10]}"
    temp_dir = tempfile.mkdtemp(prefix="ftms_upload_")
    temp_path = os.path.join(temp_dir, f"input{ext}")

    try:
        # Stream file to disk in chunks to avoid large memory allocations
        with open(temp_path, "wb") as f_out:
            while True:
                chunk = await file.read(1024 * 1024)  # 1 MB chunks
                if not chunk:
                    break
                f_out.write(chunk)

        if os.path.getsize(temp_path) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        ffmpeg_bin = get_ffmpeg_path()

        if resolved_type == "video":
            dest_video = os.path.join(VIDEOS_DIR, f"{item_id}.mp4")
            dest_thumb = os.path.join(VIDEOS_DIR, f"{item_id}.jpg")
            dest_json = os.path.join(VIDEOS_DIR, f"{item_id}.json")

            if ext == ".mp4" and os.path.isfile(ffmpeg_bin):
                # Optimize container with faststart for instant streaming
                try:
                    subprocess.run([
                        ffmpeg_bin, "-y",
                        "-i", temp_path,
                        "-c", "copy",
                        "-movflags", "+faststart",
                        dest_video
                    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                except Exception:
                    shutil.copy2(temp_path, dest_video)
            elif ext == ".mp4":
                shutil.copy2(temp_path, dest_video)
            else:
                # Transcode non-mp4 video container to web-compatible H.264 / AAC MP4
                if not os.path.isfile(ffmpeg_bin):
                    raise HTTPException(status_code=500, detail="ffmpeg is required to process non-MP4 video uploads.")
                try:
                    subprocess.run([
                        ffmpeg_bin, "-y",
                        "-i", temp_path,
                        "-c:v", "libx264",
                        "-preset", "veryfast",
                        "-crf", "22",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-movflags", "+faststart",
                        dest_video
                    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                except subprocess.CalledProcessError as ex:
                    raise HTTPException(status_code=500, detail=f"Failed to transcode video to MP4: {ex}")

            duration = probe_duration(dest_video)
            generate_video_thumbnail(dest_video, dest_thumb, duration)

            file_size = os.path.getsize(dest_video)
            meta = {
                "id": item_id,
                "title": title,
                "duration": duration,
                "start_time": 0.0,
                "end_time": 0.0,
                "thumbnail": "",
                "filename": f"{item_id}.mp4",
                "created_at": time.time(),
                "size_bytes": file_size,
                "source": "upload"
            }

            with open(dest_json, "w") as f_meta:
                json.dump(meta, f_meta, indent=2)

            return {
                "status": "success",
                "id": item_id,
                "media_type": "video",
                "title": title,
                "duration": duration,
                "filename": f"{item_id}.mp4",
                "size_bytes": file_size
            }

        else: # Audio
            if ext in (".m4a", ".mp3"):
                dest_ext = ext
                dest_audio = os.path.join(AUDIO_DIR, f"{item_id}{dest_ext}")
                shutil.copy2(temp_path, dest_audio)
            else:
                # Transcode lossless or non-standard audio to MP3
                if not os.path.isfile(ffmpeg_bin):
                    raise HTTPException(status_code=500, detail="ffmpeg is required to process audio uploads.")
                dest_ext = ".mp3"
                dest_audio = os.path.join(AUDIO_DIR, f"{item_id}.mp3")
                try:
                    subprocess.run([
                        ffmpeg_bin, "-y",
                        "-i", temp_path,
                        "-codec:a", "libmp3lame",
                        "-qscale:a", "2",
                        dest_audio
                    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                except subprocess.CalledProcessError as ex:
                    raise HTTPException(status_code=500, detail=f"Failed to convert audio to MP3: {ex}")

            duration = probe_duration(dest_audio)
            dest_json = os.path.join(AUDIO_DIR, f"{item_id}.json")
            file_size = os.path.getsize(dest_audio)

            meta = {
                "id": item_id,
                "title": title,
                "duration": duration,
                "start_time": 0.0,
                "end_time": 0.0,
                "thumbnail": "",
                "filename": f"{item_id}{dest_ext}",
                "created_at": time.time(),
                "size_bytes": file_size,
                "source": "upload"
            }

            with open(dest_json, "w") as f_meta:
                json.dump(meta, f_meta, indent=2)

            return {
                "status": "success",
                "id": item_id,
                "media_type": "audio",
                "title": title,
                "duration": duration,
                "filename": f"{item_id}{dest_ext}",
                "size_bytes": file_size
            }

    finally:
        # Always clean up temporary directory and files
        shutil.rmtree(temp_dir, ignore_errors=True)
