import os
import re
from typing import Tuple
from fastapi import HTTPException
from starlette.responses import FileResponse

CHUNK_SIZE = 512 * 1024  # 512 KB chunk size for non-blocking async file streaming

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

def range_streaming_response(file_path: str, range_header: str | None, media_type: str) -> FileResponse:
    """
    Return an RFC-compliant, asynchronous, non-blocking FileResponse.
    Starlette's FileResponse natively processes HTTP Range headers (HTTP 206 Partial Content),
    calculates Content-Range and ETags, and streams asynchronously via anyio without blocking the main event loop.
    """
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Media file not found")

    response = FileResponse(
        file_path,
        media_type=media_type,
        headers={"Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes"},
    )
    response.chunk_size = CHUNK_SIZE
    return response
