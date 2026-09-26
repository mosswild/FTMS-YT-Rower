#!/usr/bin/env bash
# Generates local SSL certificates with Subject Alternative Names (SAN)
# for HTTPS serving on macOS, Linux, and iPhone Safari.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SSL_DIR="$REPO_DIR/ssl"

mkdir -p "$SSL_DIR"

CERT_FILE="$SSL_DIR/cert.pem"
KEY_FILE="$SSL_DIR/key.pem"

# Detect local IP address
LOCAL_IP=""
if command -v ipconfig >/dev/null 2>&1; then
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
fi
if [ -z "$LOCAL_IP" ] && command -v hostname >/dev/null 2>&1; then
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
fi
LOCAL_IP=${LOCAL_IP:-127.0.0.1}

HOSTNAME_STR=$(hostname 2>/dev/null || echo "localhost")

echo "=== FTMS-Rower SSL Certificate Generator ==="
echo "Local IP:   $LOCAL_IP"
echo "Hostname:   $HOSTNAME_STR"
echo "Output Dir: $SSL_DIR"
echo ""

# Check if mkcert is available for zero-warning trusted certs
if command -v mkcert >/dev/null 2>&1; then
    echo "[mkcert detected] Generating locally trusted certificates..."
    mkcert -install
    mkcert -cert-file "$CERT_FILE" -key-file "$KEY_FILE" localhost 127.0.0.1 "$LOCAL_IP" "$HOSTNAME_STR" "*.local"
    echo ""
    echo "[OK] Created trusted certificates via mkcert!"
    echo "  Cert: $CERT_FILE"
    echo "  Key:  $KEY_FILE"
    echo ""
    echo "Tip for iPhone: AirDrop the mkcert root CA (run 'mkcert -CAROOT' to find it) to your iPhone"
    echo "and enable full trust in Settings -> General -> About -> Certificate Trust Settings."
else
    echo "[OpenSSL] Generating self-signed SSL certificate with Subject Alternative Names (SAN)..."
    SAN="subjectAltName=DNS:localhost,DNS:$HOSTNAME_STR,DNS:*.local,IP:127.0.0.1,IP:$LOCAL_IP"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout "$KEY_FILE" -out "$CERT_FILE" \
      -subj "/CN=FTMS-Rower" \
      -addext "$SAN"

    echo ""
    echo "[OK] Generated self-signed SSL certificates:"
    echo "  Cert: $CERT_FILE"
    echo "  Key:  $KEY_FILE"
    echo ""
    echo "When opening https://$LOCAL_IP:8000 on your iPhone Safari:"
    echo "  1. Tap 'Show Details'"
    echo "  2. Tap 'visit this website' (and confirm with Passcode/FaceID)"
    echo "  3. Safari will establish the Secure Context and unlock native Screen Wake Lock!"
fi

echo ""
echo "=== How to run FTMS-Rower with HTTPS ==="
echo "Using python directly:"
echo "  AUTO_HTTPS=true .venv/bin/python3 -m backend.main"
echo ""
echo "Or using uvicorn:"
echo "  uvicorn backend.main:app --host 0.0.0.0 --port 8000 --ssl-certfile ssl/cert.pem --ssl-keyfile ssl/key.pem"
echo ""
