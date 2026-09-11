import os
import re
from typing import Tuple, Generator
from fastapi import HTTPException
from starlette.responses import StreamingResponse

CHUNK_SIZE = 1024 * 1024  # 1 MB chunks (expanded for mobile Wi-Fi buffer headroom)

def parse_range_header(range_header: str, file_size: int) -> Tuple[int, int]:
    """Parse HTTP Range header: e.g. 'bytes=0-1024' or 'bytes=1024-'."""
    match = re.match(r"^bytes=(\d*)-(\d*)$", range_header.strip())
    if not match:
        return 0, file_size - 1

    start_str, end_str = match.groups()
    if start_str and end_str:
        start = int(start_str)
        end = int(end_str)
    elif start_str:
        start = int(start_str)
        end = file_size - 1
    elif end_str:
        # Suffix range
        end = file_size - 1
        start = max(0, file_size - int(end_str))
    else:
        return 0, file_size - 1

    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))
    return start, end

def file_chunk_generator(file_path: str, start: int, end: int, chunk_size: int = CHUNK_SIZE) -> Generator[bytes, None, None]:
    with open(file_path, "rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            read_len = min(chunk_size, remaining)
            data = f.read(read_len)
            if not data:
                break
            remaining -= len(data)
            yield data

def range_streaming_response(file_path: str, range_header: str | None, media_type: str) -> StreamingResponse:
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Media file not found")

    file_size = os.path.getsize(file_path)

    if range_header:
        start, end = parse_range_header(range_header, file_size)
        content_length = end - start + 1
        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": media_type,
        }
        return StreamingResponse(
            file_chunk_generator(file_path, start, end),
            status_code=206,
            headers=headers,
            media_type=media_type,
        )
    else:
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": media_type,
        }
        return StreamingResponse(
            file_chunk_generator(file_path, 0, file_size - 1),
            status_code=200,
            headers=headers,
            media_type=media_type,
        )
