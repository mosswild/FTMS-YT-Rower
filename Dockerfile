# FTMS-Rower Container
FROM python:3.12-alpine

WORKDIR /app

# Install system dependencies: ffmpeg for media transcoding, su-exec for runtime PUID/PGID, curl for healthchecks, openssl for optional HTTPS
RUN apk add --no-cache \
    ffmpeg \
    su-exec \
    curl \
    tzdata \
    ca-certificates \
    openssl

# Copy and install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh

# Copy application files
COPY backend/ ./backend/
COPY css/ ./css/
COPY js/ ./js/
COPY scripts/ ./scripts/
COPY index.html ./

# Environment defaults matching centrd / LinuxServer convention
ENV PYTHONUNBUFFERED=1 \
    PORT=8000 \
    DATA_DIR=/config/data \
    MEDIA_DIR=/config/media \
    PUID=1000 \
    PGID=1000

# Persistent volume mount point
VOLUME ["/config"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:${PORT}/ || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["start"]
