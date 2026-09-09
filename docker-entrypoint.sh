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
    SSL_ARGS=""
    if [ -n "$SSL_CERTFILE" ] && [ -n "$SSL_KEYFILE" ] && [ -f "$SSL_CERTFILE" ] && [ -f "$SSL_KEYFILE" ]; then
        echo "Enabling HTTPS with provided SSL certificates: $SSL_CERTFILE and $SSL_KEYFILE"
        SSL_ARGS="--ssl-certfile $SSL_CERTFILE --ssl-keyfile $SSL_KEYFILE"
    elif [ "$AUTO_HTTPS" = "true" ] || [ "$HTTPS" = "true" ]; then
        SSL_DIR="/config/ssl"
        mkdir -p "$SSL_DIR"
        if [ ! -f "$SSL_DIR/cert.pem" ] || [ ! -f "$SSL_DIR/key.pem" ]; then
            echo "Generating self-signed SSL certificate for HTTPS/Bluefy in $SSL_DIR..."
            openssl req -x509 -newkey rsa:2048 -keyout "$SSL_DIR/key.pem" -out "$SSL_DIR/cert.pem" -days 365 -nodes -subj "/CN=ftms-rower" 2>/dev/null || true
            chown -R "$PUID:$PGID" "$SSL_DIR" 2>/dev/null || true
        fi
        if [ -f "$SSL_DIR/cert.pem" ] && [ -f "$SSL_DIR/key.pem" ]; then
            echo "Enabling HTTPS with self-signed certificate on port ${PORT:-8000}"
            SSL_ARGS="--ssl-certfile $SSL_DIR/cert.pem --ssl-keyfile $SSL_DIR/key.pem"
        fi
    fi
    set -- uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}" $SSL_ARGS
fi

# Optional: Embedded Bluetooth Relay Bridge (runs inside container on Linux with host D-Bus)
if [ "$ENABLE_BLUETOOTH_RELAY" = "true" ] || [ "$BLUETOOTH_RELAY" = "true" ]; then
    echo "Starting internal Bluetooth Relay Bridge connecting to http://127.0.0.1:${PORT:-8000}..."
    (
        sleep 3
        RELAY_PROTOCOL="http"
        if [ -n "$SSL_ARGS" ]; then
            RELAY_PROTOCOL="https"
        fi
        python /app/scripts/bluetooth_relay.py \
            --server "${RELAY_PROTOCOL}://127.0.0.1:${PORT:-8000}" \
            ${BLE_DEVICE_NAME:+--name "$BLE_DEVICE_NAME"} \
            ${BLE_DEVICE_ADDRESS:+--address "$BLE_DEVICE_ADDRESS"}
    ) &
fi

# Execute application process as specified user & group
exec su-exec "$PUID:$PGID" "$@"
