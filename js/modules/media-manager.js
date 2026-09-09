/**
 * Media Manager: YouTube Ingestion & Local Library Client
 */

export class MediaManager {
  constructor(options = {}) {
    this.onSelectVideo = options.onSelectVideo || null;
    this.onSelectAudio = options.onSelectAudio || null;
    this.activePollInterval = null;
  }

  async fetchLibrary() {
    try {
      const res = await fetch("/api/library");
      if (!res.ok) throw new Error("Failed to load library");
      return await res.json();
    } catch (err) {
      console.error("[MediaManager] Error fetching library:", err);
      return { videos: [], audio: [] };
    }
  }

  async startDownload(url, type = "both") {
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, type })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Download failed to initiate");
      }
      return await res.json();
    } catch (err) {
      console.error("[MediaManager] Download request error:", err);
      throw err;
    }
  }

  async getTasks() {
    try {
      const res = await fetch("/api/download/status");
      if (!res.ok) return [];
      const data = await res.json();
      return data.tasks || [];
    } catch (err) {
      return [];
    }
  }

  async cancelTask(taskId) {
    try {
      const res = await fetch(`/api/download/${taskId}/cancel`, { method: "POST" });
      return res.ok;
    } catch (err) {
      console.error("[MediaManager] Cancel task error:", err);
      return false;
    }
  }

  async deleteTask(taskId) {
    try {
      const res = await fetch(`/api/download/${taskId}`, { method: "DELETE" });
      return res.ok;
    } catch (err) {
      console.error("[MediaManager] Delete task error:", err);
      return false;
    }
  }

  async clearInactiveTasks() {
    try {
      const res = await fetch("/api/download/queue/clear", { method: "DELETE" });
      return res.ok;
    } catch (err) {
      console.error("[MediaManager] Clear inactive tasks error:", err);
      return false;
    }
  }

  async renameMedia(mediaType, itemId, newTitle) {
    try {
      const res = await fetch(`/api/media/${mediaType}/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to rename media");
      }
      return await res.json();
    } catch (err) {
      console.error("[MediaManager] Rename media error:", err);
      throw err;
    }
  }

  async deleteMedia(mediaType, itemId) {
    try {
      const res = await fetch(`/api/media/${mediaType}/${itemId}`, { method: "DELETE" });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  startPolling(onTasksUpdate, intervalMs = 2000) {
    if (this.activePollInterval) clearInterval(this.activePollInterval);
    this.activePollInterval = setInterval(async () => {
      const tasks = await this.getTasks();
      if (onTasksUpdate) onTasksUpdate(tasks);

      const hasActive = tasks.some(t => 
        t.status === "pending" ||
        t.status === "downloading" || 
        t.status === "processing" || 
        t.status === "extracting_metadata" || 
        t.status === "downloading_video" || 
        t.status === "downloading_audio"
      );

      // If no tasks are currently downloading, stop polling
      if (!hasActive) {
        this.stopPolling();
      }
    }, intervalMs);
  }

  stopPolling() {
    if (this.activePollInterval) {
      clearInterval(this.activePollInterval);
      this.activePollInterval = null;
    }
  }
}
