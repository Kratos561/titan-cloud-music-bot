class SettingsService {
  constructor({ repository, eventBus, logger, config }) {
    this.repository = repository;
    this.eventBus = eventBus;
    this.logger = logger;
    this.config = config;
  }

  getDefaults() {
    return {
      defaultVolume: this.config.audio.defaultVolume,
      djRoleId: null,
      commandChannelId: null,
      autoplay: false,
      allowFilters: true,
      maxTrackMinutes: 30,
    };
  }

  normalize(settings = {}) {
    return {
      ...this.getDefaults(),
      ...settings,
    };
  }

  async getGuildSettings(guildId) {
    const stored = await this.repository.getGuildSettings(guildId);
    return this.normalize(stored ?? {});
  }

  async updateGuildSettings(guildId, patch, actor = {}) {
    const current = await this.getGuildSettings(guildId);
    const next = this.normalize({
      ...current,
      ...patch,
    });

    await this.repository.saveGuildSettings(guildId, next);
    await this.repository.appendAuditEvent({
      eventType: "guild_settings.updated",
      guildId,
      userId: actor.userId ?? null,
      payload: { patch, next },
    });

    this.eventBus.publish("guild.settings.updated", {
      guildId,
      actor,
      settings: next,
    });

    this.logger.info("Configuracion del guild actualizada.", { guildId });
    return next;
  }
}

module.exports = { SettingsService };

