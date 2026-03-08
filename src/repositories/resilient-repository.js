const { MemoryRepository } = require("./memory-repository");
const { PostgresRepository } = require("./postgres-repository");

class ResilientRepository {
  constructor(connectionString, logger, eventBus) {
    this.primary = new PostgresRepository(connectionString, logger.child("primary"));
    this.fallback = new MemoryRepository();
    this.logger = logger;
    this.eventBus = eventBus;
    this.type = "resilient-postgres";
    this.isDegraded = false;
    this.pendingWrites = [];

    setInterval(() => {
      void this.flushPendingWrites();
    }, 15000).unref?.();
  }

  async initialize() {
    await this.fallback.initialize();

    try {
      await this.primary.initialize();
      this.markHealthy();
    } catch (error) {
      this.markDegraded(error);
    }
  }

  markDegraded(error) {
    if (!this.isDegraded) {
      this.logger.warn("Repositorio principal degradado. Se usara fallback en memoria.", {
        error: error?.message ?? "unknown",
      });
      this.eventBus?.publish("repository.degraded", {
        error: error?.message ?? "unknown",
      });
    }

    this.isDegraded = true;
  }

  markHealthy() {
    if (this.isDegraded) {
      this.logger.info("Repositorio principal recuperado.");
      this.eventBus?.publish("repository.recovered", {});
    }

    this.isDegraded = false;
  }

  enqueueWrite(method, args) {
    this.pendingWrites.push({ method, args });
  }

  async flushPendingWrites() {
    if (!this.pendingWrites.length) {
      return;
    }

    const queue = [...this.pendingWrites];
    this.pendingWrites = [];

    for (const job of queue) {
      try {
        await this.primary[job.method](...job.args);
        this.markHealthy();
      } catch (error) {
        this.markDegraded(error);
        this.pendingWrites.unshift(job);
        break;
      }
    }
  }

  async read(primaryMethod, fallbackMethod, args) {
    try {
      const value = await this.primary[primaryMethod](...args);
      this.markHealthy();

      if (value) {
        await this.fallback[fallbackMethod](...args.slice(0, -1), value);
      }

      return value ?? this.fallback[fallbackMethod === "getGuildSettings" ? "getGuildSettings" : fallbackMethod](...args);
    } catch (error) {
      this.markDegraded(error);
      return this.fallback[fallbackMethod](...args);
    }
  }

  async getGuildSettings(guildId) {
    try {
      const value = await this.primary.getGuildSettings(guildId);
      this.markHealthy();

      if (value) {
        await this.fallback.saveGuildSettings(guildId, value);
      }

      return value ?? this.fallback.getGuildSettings(guildId);
    } catch (error) {
      this.markDegraded(error);
      return this.fallback.getGuildSettings(guildId);
    }
  }

  async saveGuildSettings(guildId, settings) {
    await this.fallback.saveGuildSettings(guildId, settings);

    try {
      const result = await this.primary.saveGuildSettings(guildId, settings);
      this.markHealthy();
      return result;
    } catch (error) {
      this.markDegraded(error);
      this.enqueueWrite("saveGuildSettings", [guildId, settings]);
      return settings;
    }
  }

  async getPlaybackSnapshot(guildId) {
    try {
      const value = await this.primary.getPlaybackSnapshot(guildId);
      this.markHealthy();

      if (value) {
        await this.fallback.savePlaybackSnapshot(guildId, value);
      }

      return value ?? this.fallback.getPlaybackSnapshot(guildId);
    } catch (error) {
      this.markDegraded(error);
      return this.fallback.getPlaybackSnapshot(guildId);
    }
  }

  async savePlaybackSnapshot(guildId, snapshot) {
    await this.fallback.savePlaybackSnapshot(guildId, snapshot);

    try {
      const result = await this.primary.savePlaybackSnapshot(guildId, snapshot);
      this.markHealthy();
      return result;
    } catch (error) {
      this.markDegraded(error);
      this.enqueueWrite("savePlaybackSnapshot", [guildId, snapshot]);
      return snapshot;
    }
  }

  async listPlaybackSnapshots(limit = 50) {
    try {
      const value = await this.primary.listPlaybackSnapshots(limit);
      this.markHealthy();

      for (const snapshot of value) {
        await this.fallback.savePlaybackSnapshot(snapshot.guildId, snapshot);
      }

      return value;
    } catch (error) {
      this.markDegraded(error);
      return this.fallback.listPlaybackSnapshots(limit);
    }
  }

  async appendAuditEvent(event) {
    await this.fallback.appendAuditEvent(event);

    try {
      const result = await this.primary.appendAuditEvent(event);
      this.markHealthy();
      return result;
    } catch (error) {
      this.markDegraded(error);
      this.enqueueWrite("appendAuditEvent", [event]);
      return event;
    }
  }

  async listAuditEvents(limit = 50) {
    try {
      const value = await this.primary.listAuditEvents(limit);
      this.markHealthy();
      return value;
    } catch (error) {
      this.markDegraded(error);
      return this.fallback.listAuditEvents(limit);
    }
  }
}

module.exports = { ResilientRepository };

