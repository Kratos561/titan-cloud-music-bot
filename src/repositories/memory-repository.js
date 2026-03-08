class MemoryRepository {
  constructor() {
    this.guildSettings = new Map();
    this.playbackSnapshots = new Map();
    this.auditEvents = [];
    this.type = "memory";
  }

  async initialize() {}

  async getGuildSettings(guildId) {
    return this.guildSettings.get(guildId) ?? null;
  }

  async saveGuildSettings(guildId, settings) {
    this.guildSettings.set(guildId, settings);
    return settings;
  }

  async getPlaybackSnapshot(guildId) {
    return this.playbackSnapshots.get(guildId) ?? null;
  }

  async savePlaybackSnapshot(guildId, snapshot) {
    this.playbackSnapshots.set(guildId, snapshot);
    return snapshot;
  }

  async listPlaybackSnapshots(limit = 50) {
    return [...this.playbackSnapshots.values()].slice(0, limit);
  }

  async appendAuditEvent(event) {
    const next = {
      id: this.auditEvents.length + 1,
      createdAt: new Date().toISOString(),
      ...event,
    };

    this.auditEvents.unshift(next);
    this.auditEvents = this.auditEvents.slice(0, 200);
    return next;
  }

  async listAuditEvents(limit = 50) {
    return this.auditEvents.slice(0, limit);
  }
}

module.exports = { MemoryRepository };

