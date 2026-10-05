/**
 * Adaptive Heart Rate Zones & Dynamic Calibration Engine (Client-Side).
 *
 * Implements:
 * 1. 5 metabolic zones (Zone 1 - Zone 5) computed as exact % of HRmax.
 * 2. High Intensity Points: 1 point earned per cumulative 60s in Zone 4 (84-91%) or Zone 5 (92-100%).
 * 3. Synchronization with backend SQLite user profile and automatic calibration status.
 * 4. Resolving zone targets for structured workouts (e.g. target hr_zone: 2 -> [minBpm, maxBpm]).
 */

class HrZonesManager {
  constructor(options = {}) {
    this.options = options;
    this.onProfileChange = options.onProfileChange || null;

    // Default starting state (30yo Tanaka baseline: 208 - 0.7*30 = 187)
    this.profile = {
      name: "Athlete",
      age: 30,
      gender: "unspecified",
      rest_hr: 60,
      formula: "tanaka",
      calibration_mode: "auto",
      manual_max_hr: 187,
      calibrated_max_hr: 0.0,
      active_max_hr: 187,
    };

    this.activeMaxHr = 187;
    this.isCalibrated = false;
    this.qualifyingCount = 0;
    this.minQualifyingNeeded = 5;
    this.zones = this._generateDefaultZones(187);

    // Load cached profile from localStorage immediately for zero-latency boot
    this._loadLocalCache();
  }

  _generateDefaultZones(maxHr) {
    const hr = Math.max(130, Math.min(225, Math.round(maxHr || 187)));
    return {
      "1": { zone: 1, name: "Zone 1", label: "Active Recovery", min_pct: 50, max_pct: 60, min_bpm: Math.round(hr * 0.50), max_bpm: Math.round(hr * 0.60), color: "#94a3b8", bg_color: "rgba(148, 163, 184, 0.2)", earns_points: false, earns_splats: false },
      "2": { zone: 2, name: "Zone 2", label: "Light Aerobic", min_pct: 61, max_pct: 70, min_bpm: Math.round(hr * 0.61), max_bpm: Math.round(hr * 0.70), color: "#38bdf8", bg_color: "rgba(56, 189, 248, 0.2)", earns_points: false, earns_splats: false },
      "3": { zone: 3, name: "Zone 3", label: "Aerobic Tempo", min_pct: 71, max_pct: 83, min_bpm: Math.round(hr * 0.71), max_bpm: Math.round(hr * 0.83), color: "#10b981", bg_color: "rgba(16, 185, 129, 0.2)", earns_points: false, earns_splats: false },
      "4": { zone: 4, name: "Zone 4", label: "Threshold", min_pct: 84, max_pct: 91, min_bpm: Math.round(hr * 0.84), max_bpm: Math.round(hr * 0.91), color: "#f97316", bg_color: "rgba(249, 115, 22, 0.2)", earns_points: true, earns_splats: true },
      "5": { zone: 5, name: "Zone 5", label: "Peak Effort", min_pct: 92, max_pct: 100, min_bpm: Math.round(hr * 0.92), max_bpm: hr, color: "#ef4444", bg_color: "rgba(239, 68, 68, 0.2)", earns_points: true, earns_splats: true },
    };
  }

  _loadLocalCache() {
    try {
      const cached = localStorage.getItem("ftms_hr_profile");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.profile) this.profile = Object.assign(this.profile, parsed.profile);
        if (parsed.active_max_hr) this.activeMaxHr = parsed.active_max_hr;
        if (parsed.zones) this.zones = parsed.zones;
        if (parsed.is_calibrated !== undefined) this.isCalibrated = parsed.is_calibrated;
        if (parsed.qualifying_workouts_count !== undefined) this.qualifyingCount = parsed.qualifying_workouts_count;
      }
    } catch (e) {
      console.warn("[HrZones] Could not load localStorage cache:", e);
    }
  }

  _saveLocalCache(data) {
    try {
      localStorage.setItem("ftms_hr_profile", JSON.stringify(data));
    } catch (e) {
      console.warn("[HrZones] Could not save localStorage cache:", e);
    }
  }

  async init() {
    try {
      const res = await fetch("/api/profile");
      if (res.ok) {
        const data = await res.json();
        this.applyProfileData(data);
      }
    } catch (e) {
      console.log("[HrZones] Offline or backend unreachable, using cached HR profile:", e);
    }
    return this.profile;
  }

  applyProfileData(data) {
    if (data.profile) this.profile = Object.assign(this.profile, data.profile);
    if (data.active_max_hr) this.activeMaxHr = data.active_max_hr;
    if (data.zones) this.zones = data.zones;
    if (data.is_calibrated !== undefined) this.isCalibrated = Boolean(data.is_calibrated);
    if (data.qualifying_workouts_count !== undefined) this.qualifyingCount = data.qualifying_workouts_count;
    if (data.min_qualifying_needed !== undefined) this.minQualifyingNeeded = data.min_qualifying_needed;

    this._saveLocalCache(data);
    if (this.onProfileChange) {
      this.onProfileChange(this.getSummary());
    }
  }

  getSummary() {
    return {
      profile: this.profile,
      activeMaxHr: this.activeMaxHr,
      isCalibrated: this.isCalibrated,
      qualifyingCount: this.qualifyingCount,
      minQualifyingNeeded: this.minQualifyingNeeded,
      zones: this.zones,
    };
  }

  /**
   * Returns zone details for a given BPM telemetry reading.
   */
  getZoneForBpm(bpm) {
    const val = Number(bpm) || 0;
    const maxHr = this.activeMaxHr || 187;
    if (val <= 0 || maxHr <= 0) return null;

    const pct = Math.round((val / maxHr) * 100);

    if (pct < 50) {
      return {
        zone: 0,
        name: "Rest",
        label: "Resting / Idle",
        pct,
        color: "#64748b",
        bg_color: "rgba(100, 116, 139, 0.2)",
        earns_points: false,
        earns_splats: false,
        min_bpm: 0,
        max_bpm: this.zones["1"] ? this.zones["1"].min_bpm - 1 : 90,
      };
    }

    for (const zNum of [5, 4, 3, 2, 1]) {
      const z = this.zones[String(zNum)];
      if (z && val >= z.min_bpm) {
        const earnsPts = Boolean(z.earns_points !== undefined ? z.earns_points : z.earns_splats);
        return {
          zone: z.zone,
          name: z.name,
          label: z.label,
          pct,
          color: z.color,
          bg_color: z.bg_color,
          earns_points: earnsPts,
          earns_splats: earnsPts,
          min_bpm: z.min_bpm,
          max_bpm: z.max_bpm,
        };
      }
    }

    const z1 = this.zones["1"];
    const earnsZ1 = Boolean(z1.earns_points !== undefined ? z1.earns_points : z1.earns_splats);
    return {
      zone: 1,
      name: z1.name,
      label: z1.label,
      pct,
      color: z1.color,
      bg_color: z1.bg_color,
      earns_points: earnsZ1,
      earns_splats: earnsZ1,
      min_bpm: z1.min_bpm,
      max_bpm: z1.max_bpm,
    };
  }

  /**
   * Resolves target BPM range [minBpm, maxBpm] for a workout step target specifying hr_zone.
   * e.g. hr_zone: 2 -> returns [114, 131]
   */
  getBpmRangeForZone(zoneNum) {
    const key = String(zoneNum);
    if (this.zones[key]) {
      return [this.zones[key].min_bpm, this.zones[key].max_bpm];
    }
    // Default fallback
    return [Math.round(this.activeMaxHr * 0.6), Math.round(this.activeMaxHr * 0.7)];
  }

  /**
   * Calculates High Intensity Points and zone time distribution from an array of samples.
   */
  calculateSessionZones(samples) {
    const zoneSeconds = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 0: 0 };
    let intensitySeconds = 0;

    if (!Array.isArray(samples) || samples.length === 0) {
      return {
        intensityPoints: 0,
        intensitySeconds: 0,
        splatPoints: 0,
        splatSeconds: 0,
        zoneMinutes: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        pctInZones: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      };
    }

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const hr = Number(s.hr || s.heart_rate || 0);
      if (hr <= 0) continue;

      let dt = 1.0;
      if (i < samples.length - 1) {
        const nextT = Number(samples[i + 1].elapsed_seconds || samples[i + 1].elapsed || 0);
        const currT = Number(s.elapsed_seconds || s.elapsed || 0);
        dt = Math.max(0.2, Math.min(5.0, nextT - currT));
      }

      const z = this.getZoneForBpm(hr);
      if (z) {
        zoneSeconds[z.zone] = (zoneSeconds[z.zone] || 0) + dt;
        if (z.earns_points || z.earns_splats) {
          intensitySeconds += dt;
        }
      }
    }

    const intensityPoints = Math.floor(intensitySeconds / 60.0);
    const totalValid = (zoneSeconds[1] || 0) + (zoneSeconds[2] || 0) + (zoneSeconds[3] || 0) + (zoneSeconds[4] || 0) + (zoneSeconds[5] || 0);

    const zoneMinutes = {};
    const pctInZones = {};
    for (const k of [1, 2, 3, 4, 5]) {
      const sDur = zoneSeconds[k] || 0;
      zoneMinutes[k] = Math.round((sDur / 60.0) * 10) / 10;
      pctInZones[k] = totalValid > 0 ? Math.round((sDur / totalValid) * 100) : 0;
    }

    return {
      intensityPoints,
      intensitySeconds: Math.round(intensitySeconds),
      splatPoints: intensityPoints, // compatibility alias
      splatSeconds: Math.round(intensitySeconds), // compatibility alias
      zoneMinutes,
      pctInZones,
      zoneSeconds,
    };
  }

  async updateProfile(updates) {
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        this.applyProfileData(data);
        return { success: true, data };
      }
      return { success: false, error: "Failed to update profile" };
    } catch (e) {
      console.error("[HrZones] Failed to update profile:", e);
      // Fallback local update
      this.profile = Object.assign(this.profile, updates);
      if (updates.manual_max_hr && this.profile.calibration_mode === "manual") {
        this.activeMaxHr = updates.manual_max_hr;
      }
      this.zones = this._generateDefaultZones(this.activeMaxHr);
      this._saveLocalCache(this.getSummary());
      if (this.onProfileChange) this.onProfileChange(this.getSummary());
      return { success: true, offline: true };
    }
  }

  async recalibrate() {
    try {
      const res = await fetch("/api/profile/recalibrate", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        this.activeMaxHr = data.active_max_hr;
        this.isCalibrated = data.is_calibrated;
        this.zones = data.zones;
        this.profile.calibrated_max_hr = data.calibrated_max_hr;
        this.profile.active_max_hr = data.active_max_hr;
        this._saveLocalCache(this.getSummary());
        if (this.onProfileChange) this.onProfileChange(this.getSummary());
        return { success: true, data };
      }
      return { success: false, error: "Recalibration failed" };
    } catch (e) {
      console.error("[HrZones] Recalibration network error:", e);
      return { success: false, error: e.message };
    }
  }
}

// Export for module systems or attach to window
if (typeof module !== "undefined" && module.exports) {
  module.exports = { HrZonesManager };
}
if (typeof window !== "undefined") {
  window.HrZonesManager = HrZonesManager;
}
