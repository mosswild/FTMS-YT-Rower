/**
 * WebSocket Telemetry Receiver & Relay Client
 * Enables browser clients (including standard iOS Safari over Wi-Fi)
 * to receive live metrics broadcast by a Bluetooth relay bridge or external gateway.
 */

export class WebSocketTelemetry {
  constructor(onDataCallback, onStatusCallback) {
    this.onData = onDataCallback;
    this.onStatus = onStatusCallback;
    this.ws = null;
    this.isConnected = false;
    this.shouldReconnect = true;
    this.reconnectTimeout = null;
    this.reconnectInterval = 3000;
  }

  getWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const isPrefix = window.location.pathname.startsWith("/ftms-rower");
    const endpoint = isPrefix ? "/ftms-rower/ws/telemetry" : "/ws/telemetry";
    return `${protocol}//${host}${endpoint}`;
  }

  normalizeTelemetry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const clean = {
      timestamp: raw.timestamp || Date.now(),
      source: raw.source || "relay"
    };

    if (raw.strokeRate !== undefined) clean.strokeRate = raw.strokeRate;
    else if (raw.stroke_rate !== undefined) clean.strokeRate = raw.stroke_rate;

    if (raw.instantaneousPace !== undefined) clean.instantaneousPace = raw.instantaneousPace;
    else if (raw.split_seconds !== undefined) clean.instantaneousPace = raw.split_seconds;
    else if (raw.pace !== undefined) clean.instantaneousPace = raw.pace;

    if (raw.watts !== undefined) clean.watts = raw.watts;
    if (raw.distance !== undefined) clean.distance = raw.distance;

    if (raw.elapsedSeconds !== undefined) clean.elapsedSeconds = raw.elapsedSeconds;
    else if (raw.elapsed_seconds !== undefined) clean.elapsedSeconds = raw.elapsed_seconds;

    if (raw.heartRate !== undefined) clean.heartRate = raw.heartRate;
    else if (raw.hr !== undefined) clean.heartRate = raw.hr;
    else if (raw.heart_rate !== undefined) clean.heartRate = raw.heart_rate;

    if (raw.totalStrokes !== undefined) clean.totalStrokes = raw.totalStrokes;
    else if (raw.total_strokes !== undefined) clean.totalStrokes = raw.total_strokes;

    return clean;
  }

  connect() {
    this.shouldReconnect = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const url = this.getWebSocketUrl();
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log("[WS Telemetry] Connected to gateway:", url);
        if (this.onStatus) this.onStatus(true, "Gateway Connected");
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload && typeof payload === "object") {
            const normalized = this.normalizeTelemetry(payload);
            if (normalized && this.onData) this.onData(normalized);
          }
        } catch (err) {
          console.warn("[WS Telemetry] Failed to parse message:", err);
        }
      };

      this.ws.onclose = () => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        if (wasConnected && this.onStatus) {
          this.onStatus(false, "Gateway Disconnected");
        }
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        if (this.ws) {
          this.ws.close();
        }
      };
    } catch (err) {
      console.warn("[WS Telemetry] Connection error:", err);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, this.reconnectInterval);
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    if (this.onStatus) this.onStatus(false, "Disconnected");
  }
}
