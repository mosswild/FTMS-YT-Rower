/**
 * Web Bluetooth Client for FTMS Rower (Service 0x1826, Characteristic 0x2AD1)
 * Tested with standard FTMS rowers and Merach Q1S profiles.
 */

export const FTMS_SERVICE_UUID = 0x1826;
export const ROWER_DATA_CHAR_UUID = 0x2ad1;

export class RowerBLE {
  constructor(onDataCallback, onDisconnectCallback) {
    this.onData = onDataCallback;
    this.onDisconnect = onDisconnectCallback;
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.isConnected = false;
  }

  isSupported() {
    return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
  }

  async connect() {
    if (!this.isSupported()) {
      throw new Error("Web Bluetooth is not supported in this browser. Use Google Chrome or Edge.");
    }

    try {
      console.log("[BLE Rower] Requesting FTMS Bluetooth Device...");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FTMS_SERVICE_UUID] }],
        optionalServices: [FTMS_SERVICE_UUID]
      });

      this.device.addEventListener("gattserverdisconnected", () => {
        console.warn("[BLE Rower] GATT Server disconnected");
        this.isConnected = false;
        if (this.onDisconnect) this.onDisconnect();
      });

      console.log("[BLE Rower] Connecting to GATT Server...");
      this.server = await this.device.gatt.connect();

      console.log("[BLE Rower] Getting FTMS Primary Service...");
      const service = await this.server.getPrimaryService(FTMS_SERVICE_UUID);

      console.log("[BLE Rower] Getting Rower Data Characteristic...");
      this.characteristic = await service.getCharacteristic(ROWER_DATA_CHAR_UUID);

      await this.characteristic.startNotifications();
      console.log("[BLE Rower] Notifications started");

      this.characteristic.addEventListener("characteristicvaluechanged", (event) => {
        const parsed = this.parseRowerData(event.target.value);
        if (this.onData) this.onData(parsed);
      });

      this.isConnected = true;
      return this.device.name || "FTMS Rower";
    } catch (err) {
      this.isConnected = false;
      throw err;
    }
  }

  disconnect() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this.isConnected = false;
  }

  /**
   * Parse FTMS Rower Data (0x2AD1)
   * Bitwise flags and field lengths per Bluetooth SIG FTMS specification.
   */
  parseRowerData(value) {
    const data = {
      timestamp: Date.now(),
      rawBytes: []
    };

    for (let i = 0; i < value.byteLength; i++) {
      data.rawBytes.push(value.getUint8(i));
    }

    const flags = value.getUint16(0, true);
    let byteIndex = 2;

    // Flag Bit 0: More Data
    // 0 = Stroke Rate (uint8, 0.5 resolution) and Stroke Count (uint16) present
    if ((flags & (1 << 0)) === 0 && byteIndex < value.byteLength) {
      let rawSpm = value.getUint8(byteIndex);
      byteIndex += 1;
      
      // FTMS standard spec defines Stroke Rate as 0.5 stroke/min units (e.g. 48 = 24 SPM).
      // However, some rowers (e.g. Merach Q1S) directly transmit raw SPM (e.g. 24).
      // Normal rowing stroke rates are 14-40 SPM. If raw > 50, it's 0.5 resolution.
      data.strokeRate = (rawSpm > 50) ? Math.round(rawSpm * 0.5) : rawSpm;

      if (byteIndex + 1 < value.byteLength) {
        data.strokeCount = value.getUint16(byteIndex, true);
        byteIndex += 2;
      }
    }

    // Flag Bit 1: Average Stroke Rate (uint8, 0.5 resolution)
    if ((flags & (1 << 1)) !== 0 && byteIndex < value.byteLength) {
      let rawAvgSpm = value.getUint8(byteIndex);
      byteIndex += 1;
      data.avgStrokeRate = (rawAvgSpm > 50) ? Math.round(rawAvgSpm * 0.5) : rawAvgSpm;
    }

    // Flag Bit 2: Total Distance (uint24) in meters
    if ((flags & (1 << 2)) !== 0 && byteIndex + 2 < value.byteLength) {
      const dLow = value.getUint16(byteIndex, true);
      const dHigh = value.getUint8(byteIndex + 2);
      data.distance = dLow + (dHigh << 16);
      byteIndex += 3;
    }

    // Flag Bit 3: Instantaneous Pace (uint16) in seconds per 500m
    if ((flags & (1 << 3)) !== 0 && byteIndex + 1 < value.byteLength) {
      data.instantaneousPace = value.getUint16(byteIndex, true);
      byteIndex += 2;
    }

    // Flag Bit 4: Average Pace (uint16) in seconds per 500m
    if ((flags & (1 << 4)) !== 0 && byteIndex + 1 < value.byteLength) {
      data.avgPace = value.getUint16(byteIndex, true);
      byteIndex += 2;
    }

    // Flag Bit 5: Instantaneous Power (sint16) in Watts
    if ((flags & (1 << 5)) !== 0 && byteIndex + 1 < value.byteLength) {
      data.watts = value.getInt16(byteIndex, true);
      byteIndex += 2;
    }

    // Flag Bit 6: Average Power (sint16) in Watts
    if ((flags & (1 << 6)) !== 0 && byteIndex + 1 < value.byteLength) {
      data.avgWatts = value.getInt16(byteIndex, true);
      byteIndex += 2;
    }

    // Flag Bit 7: Resistance Level (uint8)
    if ((flags & (1 << 7)) !== 0 && byteIndex < value.byteLength) {
      data.resistance = value.getUint8(byteIndex);
      byteIndex += 1;
    }

    // Flag Bit 8: Total Energy (uint16 kcal), Per Hour (uint16), Per Min (uint8)
    if ((flags & (1 << 8)) !== 0 && byteIndex + 1 < value.byteLength) {
      data.totalKcal = value.getUint16(byteIndex, true);
      byteIndex += 2;
      if (byteIndex + 1 < value.byteLength) {
        data.kcalPerHour = value.getUint16(byteIndex, true);
        byteIndex += 2;
      }
      if (byteIndex < value.byteLength) {
        data.kcalPerMin = value.getUint8(byteIndex);
        byteIndex += 1;
      }
    }

    // Flag Bit 9: Heart Rate (uint8)
    if ((flags & (1 << 9)) !== 0 && byteIndex < value.byteLength) {
      data.heartRate = value.getUint8(byteIndex);
      byteIndex += 1;
    }

    // Flag Bit 10: Metabolic Equivalent (uint8, 0.1 resolution)
    if ((flags & (1 << 10)) !== 0 && byteIndex < value.byteLength) {
      data.mets = value.getUint8(byteIndex) * 0.1;
      byteIndex += 1;
    }

    // Flag Bit 11: Elapsed Time (uint16) in seconds
    if ((flags & (1 << 11)) !== 0 && byteIndex + 1 < value.byteLength) {
      data.elapsedSeconds = value.getUint16(byteIndex, true);
      byteIndex += 2;
    }

    // Flag Bit 12: Remaining Time (uint16) in seconds
    if ((flags & (1 << 12)) !== 0 && byteIndex + 1 < value.byteLength) {
      data.remainingSeconds = value.getUint16(byteIndex, true);
      byteIndex += 2;
    }

    // Fallback: If Watts is missing/0 but Pace is available, calculate Watts using Concept2 standard formula:
    // Watts = 2.80 / (pace_in_sec_per_meter ^ 3)
    if ((!data.watts || data.watts <= 0) && data.instantaneousPace && data.instantaneousPace > 0) {
      const pacePerMeter = data.instantaneousPace / 500.0;
      data.watts = Math.round(2.80 / Math.pow(pacePerMeter, 3));
    }

    return data;
  }
}
