#!/bin/sh
set -e

# Default PUID and PGID to 1000 if not specified
PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Target data and media directories
DATA_DIR=${DATA_DIR:-/config/data}
MEDIA_DIR=${MEDIA_DIR:-/config/media}

# Ensure destination directories exist
mkdir -p "$DATA_DIR" "$MEDIA_DIR/videos" "$MEDIA_DIR/audio"

# Handle Group Creation / Resolution
GROUP_NAME="rower"
if getent group "$PGID" >/dev/null 2>&1; then
    GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)
else
    addgroup -g "$PGID" "$GROUP_NAME" 2>/dev/null || true
fi

# Handle User Creation / Resolution
USER_NAME="rower"
if getent passwd "$PUID" >/dev/null 2>&1; then
    USER_NAME=$(getent passwd "$PUID" | cut -d: -f1)
else
    adduser -u "$PUID" -G "$GROUP_NAME" -h /app -s /bin/sh -D "$USER_NAME" 2>/dev/null || true
fi

# Apply permission fixes on config & data directories
echo "Starting FTMS-Rower container with PUID=${PUID} ($USER_NAME) and PGID=${PGID} ($GROUP_NAME)..."
chown -R "$PUID:$PGID" "$DATA_DIR" "$MEDIA_DIR" /app 2>/dev/null || true

# If first arg is 'start', replace with uvicorn command using $PORT
if [ "$1" = "start" ]; then
    set -- uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}"
fi

# Execute application process as specified user & group
exec su-exec "$PUID:$PGID" "$@"
