/**
 * Web Bluetooth Client for BLE Heart Rate Monitors (Polar, Garmin, Wahoo, OTbeat, etc.)
 * Standard Service: 0x180D, Characteristic: 0x2A37
 */

export const HR_SERVICE_UUID = 0x180d;
export const HR_MEASUREMENT_CHAR_UUID = 0x2a37;

export class HeartRateBLE {
  constructor(onHeartRateCallback, onDisconnectCallback) {
    this.onHeartRate = onHeartRateCallback;
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
      throw new Error("Web Bluetooth is not supported in this browser.");
    }

    try {
      console.log("[BLE HR] Requesting Heart Rate Device...");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [HR_SERVICE_UUID] }],
        optionalServices: [HR_SERVICE_UUID]
      });

      this.device.addEventListener("gattserverdisconnected", () => {
        console.warn("[BLE HR] GATT Server disconnected");
        this.isConnected = false;
        if (this.onDisconnect) this.onDisconnect();
      });

      console.log("[BLE HR] Connecting to GATT Server...");
      this.server = await this.device.gatt.connect();

      console.log("[BLE HR] Getting Heart Rate Service...");
      const service = await this.server.getPrimaryService(HR_SERVICE_UUID);

      console.log("[BLE HR] Getting Measurement Characteristic...");
      this.characteristic = await service.getCharacteristic(HR_MEASUREMENT_CHAR_UUID);

      await this.characteristic.startNotifications();
      console.log("[BLE HR] Notifications started");

      this.characteristic.addEventListener("characteristicvaluechanged", (event) => {
        const bpm = this.parseHeartRate(event.target.value);
        if (this.onHeartRate && bpm > 0) {
          this.onHeartRate(bpm);
        }
      });

      this.isConnected = true;
      return this.device.name || "BLE Heart Rate Monitor";
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

  parseHeartRate(value) {
    const flags = value.getUint8(0);
    // Bit 0 determines whether HR value is UINT8 (0) or UINT16 (1)
    const is16Bit = (flags & 0x01) !== 0;
    let bpm = 0;
    if (is16Bit && value.byteLength >= 3) {
      bpm = value.getUint16(1, true);
    } else if (value.byteLength >= 2) {
      bpm = value.getUint8(1);
    }
    return bpm;
  }
}
