const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { DisTube, RepeatMode } = require("distube");
const { YtDlpPlugin } = require("@distube/yt-dlp");

function truncate(text, maxLength = 1800) {
  if (!text) {
    return "Sin detalles adicionales.";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function formatMissingPermissions(missingPermissions) {
  return missingPermissions
    .map((permission) => {
      switch (permission) {
        case PermissionFlagsBits.ViewChannel:
          return "ViewChannel";
        case PermissionFlagsBits.Connect:
          return "Connect";
        case PermissionFlagsBits.Speak:
          return "Speak";
        default:
          return permission.toString();
      }
    })
    .join(", ");
}

function formatLoopMode(mode) {
  if (mode === RepeatMode.SONG) {
    return "Cancion";
  }

  if (mode === RepeatMode.QUEUE) {
    return "Cola";
  }

  return "Off";
}

function mapSong(song) {
  return {
    name: song?.name ?? "Sin titulo",
    url: song?.url ?? null,
    duration: song?.duration ?? 0,
    formattedDuration: song?.formattedDuration ?? "Desconocida",
    source: song?.source ?? "unknown",
    thumbnail: song?.thumbnail ?? null,
    isLive: Boolean(song?.isLive),
  };
}

function buildSongEmbed(color, title, song, extraFields = []) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(song.url ? `[${song.name}](${song.url})` : song.name)
    .addFields(
      { name: "Duracion", value: song.formattedDuration || "En vivo", inline: true },
      { name: "Fuente", value: song.source || "Desconocida", inline: true },
      ...extraFields,
    );

  if (song.thumbnail) {
    embed.setThumbnail(song.thumbnail);
  }

  return embed;
}

async function reply(interaction, payload) {
  if (interaction.deferred) {
    return interaction.editReply(payload);
  }

  if (interaction.replied) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

class MusicSystem {
  constructor({ client, config, repository, settingsService, queryIntelligence, eventBus, logger, cloudClients }) {
    this.client = client;
    this.config = config;
    this.repository = repository;
    this.settingsService = settingsService;
    this.queryIntelligence = queryIntelligence;
    this.eventBus = eventBus;
    this.logger = logger;
    this.cloudClients = cloudClients;
    this.sessions = new Map();
    this.snapshotCatalog = new Map();

    const ytDlpOptions = {};

    // Convertir cookies JSON a formato Netscape (cookies.txt) para yt-dlp
    if (config.audio.youtubeCookies && Array.isArray(config.audio.youtubeCookies)) {
      const fs = require("node:fs");
      const path = require("node:path");
      const cookiesTxtPath = path.resolve(process.cwd(), "cookies.txt");

      const lines = ["# Netscape HTTP Cookie File"];
      for (const c of config.audio.youtubeCookies) {
        const domain = c.domain || ".youtube.com";
        const flag = domain.startsWith(".") ? "TRUE" : "FALSE";
        const cookiePath = c.path || "/";
        const secure = c.secure ? "TRUE" : (c.name?.startsWith("__Secure") ? "TRUE" : "FALSE");
        const expiry = c.expirationDate ? Math.floor(c.expirationDate) : "0";
        lines.push(`${domain}\t${flag}\t${cookiePath}\t${secure}\t${expiry}\t${c.name}\t${c.value}`);
      }

      fs.writeFileSync(cookiesTxtPath, lines.join("\n"), "utf8");
      logger.info(`Cookies de YouTube escritas en formato Netscape (${config.audio.youtubeCookies.length} cookies).`);
      ytDlpOptions.flags = ["--cookies", cookiesTxtPath];
    }

    this.distube = new DisTube(client, {
      plugins: [new YtDlpPlugin(ytDlpOptions)],
      emitNewSongOnly: true,
      savePreviousSongs: true,
    });
  }

  async initialize() {
    await this.loadSnapshots();
    this.bindEvents();
  }

  async loadSnapshots() {
    const snapshots = await this.repository.listPlaybackSnapshots(100);

    for (const snapshot of snapshots) {
      this.snapshotCatalog.set(snapshot.guildId, snapshot);
    }

    this.logger.info("Snapshots precargados.", { count: snapshots.length });
  }

  bindEvents() {
    this.distube
      .on("playSong", async (queue, song) => {
        try {
          const guildId = queue.textChannel?.guildId;
          const settings = guildId
            ? await this.settingsService.getGuildSettings(guildId)
            : this.settingsService.getDefaults();

          if (queue.volume !== settings.defaultVolume) {
            queue.setVolume(settings.defaultVolume);
          }

          this.updateLiveSession(queue, "playing");
          await this.persistSnapshot(queue);

          const normalizedQuery = queue.metadata?.analysis?.normalized;
          this.queryIntelligence.rememberResolution(normalizedQuery, song);

          this.eventBus.publish("music.playSong", {
            guildId,
            song: mapSong(song),
          });

          queue.textChannel?.send({
            embeds: [
              buildSongEmbed(0x57f287, "Reproduciendo ahora", mapSong(song), [
                {
                  name: "Estado",
                  value: `Volumen ${queue.volume}% | Loop ${formatLoopMode(queue.repeatMode)}`,
                },
              ]),
            ],
          });
        } catch (error) {
          this.logger.error("Error procesando playSong.", { error: error.message });
        }
      })
      .on("addSong", async (queue, song) => {
        this.updateLiveSession(queue, "queueing");
        await this.persistSnapshot(queue);
        this.eventBus.publish("music.addSong", {
          guildId: queue.textChannel?.guildId,
          song: mapSong(song),
        });
        queue.textChannel?.send({
          embeds: [buildSongEmbed(0xfee75c, "Agregada a la cola", mapSong(song))],
        });
      })
      .on("addList", async (queue, playlist) => {
        this.updateLiveSession(queue, "queueing");
        await this.persistSnapshot(queue);
        this.eventBus.publish("music.addList", {
          guildId: queue.textChannel?.guildId,
          playlist: {
            name: playlist.name,
            url: playlist.url,
            count: playlist.songs.length,
          },
        });

        const embed = new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle("Playlist agregada")
          .setDescription(playlist.url ? `[${playlist.name}](${playlist.url})` : playlist.name)
          .addFields(
            { name: "Canciones", value: `${playlist.songs.length}`, inline: true },
            { name: "Duracion", value: playlist.formattedDuration || "Desconocida", inline: true },
          );

        if (playlist.thumbnail) {
          embed.setThumbnail(playlist.thumbnail);
        }

        queue.textChannel?.send({ embeds: [embed] });
      })
      .on("finish", async (queue) => {
        await this.persistSnapshot(queue);
        this.updateLiveSession(queue, "finished");
        this.eventBus.publish("music.finish", { guildId: queue.textChannel?.guildId });
        queue.textChannel?.send("La cola termino. Usa `/play` para seguir.");
      })
      .on("disconnect", (queue) => {
        this.removeLiveSession(queue.textChannel?.guildId, "disconnect");
        this.eventBus.publish("music.disconnect", { guildId: queue.textChannel?.guildId });
        queue.textChannel?.send("Me desconecte del canal de voz.");
      })
      .on("deleteQueue", (queue) => {
        this.removeLiveSession(queue.textChannel?.guildId, "deleteQueue");
      })
      .on("noRelated", (queue) => {
        this.eventBus.publish("music.noRelated", { guildId: queue.textChannel?.guildId });
        queue.textChannel?.send("No encontre mas canciones relacionadas para autoplay.");
      })
      .on("error", (error, queue) => {
        this.logger.error("DisTube error.", {
          error: error.message,
          guildId: queue?.textChannel?.guildId ?? null,
        });

        this.eventBus.publish("music.error", {
          guildId: queue?.textChannel?.guildId ?? null,
          message: error.message,
        });

        queue?.textChannel?.send(`Error reproduciendo musica: ${truncate(error.message)}`);
      })
      .on("debug", (message) => {
        this.logger.info("DisTube debug.", { message });
      });
  }

  updateLiveSession(queue, state) {
    const snapshot = this.queueToSnapshot(queue, state);
    this.sessions.set(snapshot.guildId, snapshot);
    this.snapshotCatalog.set(snapshot.guildId, snapshot);
  }

  removeLiveSession(guildId, reason) {
    if (!guildId) {
      return;
    }

    this.sessions.delete(guildId);
    this.eventBus.publish("music.session.closed", { guildId, reason });
  }

  queueToSnapshot(queue, state = "active") {
    return {
      guildId: queue.textChannel?.guildId,
      textChannelId: queue.textChannel?.id ?? null,
      voiceChannelId: queue.voiceChannel?.id ?? null,
      state,
      volume: queue.volume,
      repeatMode: queue.repeatMode,
      repeatModeLabel: formatLoopMode(queue.repeatMode),
      autoplay: queue.autoplay,
      filters: queue.filters.names,
      currentTrack: mapSong(queue.songs[0]),
      items: queue.songs.map(mapSong),
      updatedAt: new Date().toISOString(),
    };
  }

  async persistSnapshot(queue) {
    const snapshot = this.queueToSnapshot(queue);

    if (!snapshot.guildId) {
      return;
    }

    this.snapshotCatalog.set(snapshot.guildId, snapshot);
    await this.repository.savePlaybackSnapshot(snapshot.guildId, snapshot);
  }

  async getMember(interaction) {
    return interaction.guild.members.fetch(interaction.user.id);
  }

  async getBotMember(interaction) {
    return interaction.guild.members.me ?? interaction.guild.members.fetchMe();
  }

  async enforceCommandContext(interaction, options = {}) {
    const settings = await this.settingsService.getGuildSettings(interaction.guildId);

    if (
      settings.commandChannelId &&
      interaction.channelId !== settings.commandChannelId &&
      interaction.commandName !== "status"
    ) {
      await reply(interaction, {
        content: `Este servidor solo permite comandos en <#${settings.commandChannelId}>.`,
        ephemeral: true,
      });
      return null;
    }

    const member = await this.getMember(interaction);

    if (options.requireDj && settings.djRoleId) {
      const hasDjRole = member.roles.cache.has(settings.djRoleId);
      const hasAdminPower = member.permissions.has(PermissionFlagsBits.ManageGuild);

      if (!hasDjRole && !hasAdminPower) {
        await reply(interaction, {
          content: "Necesitas el rol DJ o permisos de gestion para usar este comando.",
          ephemeral: true,
        });
        return null;
      }
    }

    if (!options.requireVoice) {
      return { member, settings };
    }

    const voiceChannel = member.voice?.channel;

    if (!voiceChannel) {
      await reply(interaction, {
        content: "Debes entrar a un canal de voz para usar este comando.",
        ephemeral: true,
      });
      return null;
    }

    const botMember = await this.getBotMember(interaction);
    const botPermissions = voiceChannel.permissionsFor(botMember);
    const requiredPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
    ];
    const missingPermissions = requiredPermissions.filter((permission) => !botPermissions?.has(permission));

    if (missingPermissions.length) {
      await reply(interaction, {
        content: `No puedo entrar a <#${voiceChannel.id}> porque me faltan permisos: ${formatMissingPermissions(
          missingPermissions,
        )}.`,
        ephemeral: true,
      });
      return null;
    }

    if (options.requireSameVoiceChannel) {
      const botChannel = botMember.voice?.channel;

      if (botChannel && botChannel.id !== voiceChannel.id) {
        await reply(interaction, {
          content: `Debes estar en el mismo canal de voz que ${this.config.botName}.`,
          ephemeral: true,
        });
        return null;
      }
    }

    return { member, settings, voiceChannel };
  }

  async getQueueOrReply(interaction) {
    const queue = this.distube.getQueue(interaction.guildId);

    if (!queue || !queue.songs.length) {
      await reply(interaction, {
        content: "No hay musica sonando en este momento.",
        ephemeral: true,
      });
      return null;
    }

    return queue;
  }

  getQueueEmbed(queue) {
    const lines = queue.songs.slice(0, 10).map((song, index) => {
      const label = index === 0 ? "Sonando" : `#${index}`;
      return `${label} - **${song.name}** \`${song.formattedDuration}\``;
    });

    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Cola actual")
      .setDescription(lines.join("\n") || "Sin canciones.")
      .addFields(
        { name: "Total", value: `${queue.songs.length} pistas`, inline: true },
        { name: "Volumen", value: `${queue.volume}%`, inline: true },
        { name: "Loop", value: formatLoopMode(queue.repeatMode), inline: true },
        { name: "Autoplay", value: queue.autoplay ? "Activo" : "Off", inline: true },
        {
          name: "Filtros",
          value: queue.filters.names.length ? queue.filters.names.join(", ") : "Sin filtros",
          inline: false,
        },
      );
  }

  async handlePlay(interaction) {
    const context = await this.enforceCommandContext(interaction, { requireVoice: true });

    if (!context) {
      return;
    }

    const rawQuery = interaction.options.getString("busqueda", true);
    const analysis = this.queryIntelligence.analyze(rawQuery);
    const cached = this.queryIntelligence.getCachedResolution(analysis.normalized);
    const effectiveQuery = cached?.url ?? rawQuery;

    await interaction.deferReply();

    try {
      this.logger.info("Intentando reproducir.", {
        query: effectiveQuery,
        voiceChannel: context.voiceChannel.id,
        guild: interaction.guildId,
      });

      await this.distube.play(context.voiceChannel, effectiveQuery, {
        member: context.member,
        textChannel: interaction.channel,
        metadata: {
          requestedBy: interaction.user.id,
          analysis,
        },
      });

      await this.repository.appendAuditEvent({
        eventType: "command.play",
        guildId: interaction.guildId,
        userId: interaction.user.id,
        payload: {
          rawQuery,
          effectiveQuery,
          cached: Boolean(cached),
        },
      });

      await interaction.editReply(
        cached
          ? `Usando cache inteligente para: **${rawQuery}**`
          : `Buscando en YouTube: **${rawQuery}**`,
      );
    } catch (playError) {
      this.logger.error("Error en distube.play().", {
        error: playError.message,
        code: playError.code,
        errorName: playError.name,
        stack: playError.stack?.split("\n").slice(0, 5).join("\n"),
      });

      const userMessage = playError.message?.includes("30 seconds")
        ? "No pude conectar al canal de voz en 30 segundos. Error interno: " + playError.message
        : `Error al reproducir: ${playError.message}`;

      await interaction.editReply(userMessage).catch(() => { });
    }
  }

  async handleQueue(interaction) {
    const context = await this.enforceCommandContext(interaction);

    if (!context) {
      return;
    }

    const queue = await this.getQueueOrReply(interaction);

    if (!queue) {
      return;
    }

    await reply(interaction, { embeds: [this.getQueueEmbed(queue)] });
  }

  async handleNowPlaying(interaction) {
    const context = await this.enforceCommandContext(interaction);

    if (!context) {
      return;
    }

    const queue = await this.getQueueOrReply(interaction);

    if (!queue) {
      return;
    }

    await reply(interaction, {
      embeds: [buildSongEmbed(0x5865f2, "Sonando ahora", mapSong(queue.songs[0]))],
    });
  }

  async handlePause(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireSameVoiceChannel: true,
      requireDj: true,
    });

    if (!context) return;
    const queue = await this.getQueueOrReply(interaction);
    if (!queue) return;
    await queue.pause();
    await reply(interaction, { content: "Reproduccion pausada." });
  }

  async handleResume(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireSameVoiceChannel: true,
      requireDj: true,
    });

    if (!context) return;
    const queue = await this.getQueueOrReply(interaction);
    if (!queue) return;
    await queue.resume();
    await reply(interaction, { content: "Reproduccion reanudada." });
  }

  async handleSkip(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireSameVoiceChannel: true,
      requireDj: true,
    });

    if (!context) return;
    const queue = await this.getQueueOrReply(interaction);
    if (!queue) return;
    const nextSong = await queue.skip();
    await reply(interaction, {
      content: `Saltada. Ahora sigue **${nextSong.name ?? "la siguiente pista"}**.`,
    });
  }

  async handleStop(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireSameVoiceChannel: true,
      requireDj: true,
    });

    if (!context) return;
    const queue = await this.getQueueOrReply(interaction);
    if (!queue) return;
    await queue.stop();
    await reply(interaction, { content: "Musica detenida y cola limpiada." });
  }

  async handleVolume(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireSameVoiceChannel: true,
      requireDj: true,
    });

    if (!context) return;
    const queue = await this.getQueueOrReply(interaction);
    if (!queue) return;

    const volume = interaction.options.getInteger("porcentaje", true);
    queue.setVolume(volume);
    await this.persistSnapshot(queue);
    await reply(interaction, { content: `Volumen ajustado a ${volume}%.` });
  }

  async handleLoop(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireSameVoiceChannel: true,
      requireDj: true,
    });

    if (!context) return;
    const queue = await this.getQueueOrReply(interaction);
    if (!queue) return;

    const mode = interaction.options.getString("modo", true);
    const repeatMode =
      mode === "song" ? RepeatMode.SONG : mode === "queue" ? RepeatMode.QUEUE : RepeatMode.DISABLED;

    queue.setRepeatMode(repeatMode);
    await this.persistSnapshot(queue);
    await reply(interaction, {
      content: `Modo loop actualizado: **${formatLoopMode(repeatMode)}**.`,
    });
  }

  async handleShuffle(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireSameVoiceChannel: true,
      requireDj: true,
    });

    if (!context) return;
    const queue = await this.getQueueOrReply(interaction);
    if (!queue) return;
    await queue.shuffle();
    await this.persistSnapshot(queue);
    await reply(interaction, { content: "Cola mezclada." });
  }

  async handleAutoplay(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireSameVoiceChannel: true,
      requireDj: true,
    });

    if (!context) return;
    const queue = await this.getQueueOrReply(interaction);
    if (!queue) return;
    const enabled = queue.toggleAutoplay();
    await this.persistSnapshot(queue);
    await reply(interaction, { content: `Autoplay ${enabled ? "activado" : "desactivado"}.` });
  }

  async handleFilter(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireSameVoiceChannel: true,
      requireDj: true,
    });

    if (!context) return;
    const queue = await this.getQueueOrReply(interaction);
    if (!queue) return;

    const filter = interaction.options.getString("modo", true);

    if (filter === "clear") {
      queue.filters.clear();
      await this.persistSnapshot(queue);
      await reply(interaction, { content: "Todos los filtros fueron quitados." });
      return;
    }

    if (queue.filters.has(filter)) {
      queue.filters.remove(filter);
      await this.persistSnapshot(queue);
      await reply(interaction, { content: `Filtro **${filter}** desactivado.` });
      return;
    }

    queue.filters.add(filter);
    await this.persistSnapshot(queue);
    await reply(interaction, { content: `Filtro **${filter}** activado.` });
  }

  async handleSeek(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireSameVoiceChannel: true,
      requireDj: true,
    });

    if (!context) return;
    const queue = await this.getQueueOrReply(interaction);
    if (!queue) return;

    const seconds = interaction.options.getInteger("segundos", true);
    await queue.seek(seconds);
    await reply(interaction, { content: `Movido al segundo ${seconds}.` });
  }

  async handleDisconnect(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireSameVoiceChannel: true,
      requireDj: true,
    });

    if (!context) return;
    this.distube.voices.get(interaction.guildId)?.leave();
    await reply(interaction, { content: "Sali del canal de voz." });
  }

  async handleRestore(interaction) {
    const context = await this.enforceCommandContext(interaction, {
      requireVoice: true,
      requireDj: true,
    });

    if (!context) return;

    const snapshot =
      (await this.repository.getPlaybackSnapshot(interaction.guildId)) ??
      this.snapshotCatalog.get(interaction.guildId);

    if (!snapshot?.items?.length) {
      await reply(interaction, {
        content: "No hay snapshot guardado para restaurar en este servidor.",
        ephemeral: true,
      });
      return;
    }

    const recoverableItems = snapshot.items.filter((item) => item.url).slice(0, 25);

    if (!recoverableItems.length) {
      await reply(interaction, {
        content: "El snapshot existe, pero no contiene URLs restaurables.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const currentQueue = this.distube.getQueue(interaction.guildId);

    if (currentQueue) {
      await currentQueue.stop();
    }

    await this.distube.play(context.voiceChannel, recoverableItems[0].url, {
      member: context.member,
      textChannel: interaction.channel,
      metadata: {
        requestedBy: interaction.user.id,
        restored: true,
      },
    });

    for (const item of recoverableItems.slice(1)) {
      await this.distube.play(context.voiceChannel, item.url, {
        member: context.member,
        textChannel: interaction.channel,
        metadata: {
          requestedBy: interaction.user.id,
          restored: true,
        },
      });
    }

    await this.repository.appendAuditEvent({
      eventType: "command.restore",
      guildId: interaction.guildId,
      userId: interaction.user.id,
      payload: { count: recoverableItems.length },
    });

    await interaction.editReply(`Cola restaurada con ${recoverableItems.length} pistas.`);
  }

  async handleSettings(interaction) {
    const context = await this.enforceCommandContext(interaction, { requireDj: true });
    if (!context) return;

    const patch = {};
    const defaultVolume = interaction.options.getInteger("default-volume");
    const djRoleId = interaction.options.getString("dj-role-id");
    const commandChannelId = interaction.options.getString("command-channel-id");

    if (defaultVolume !== null) patch.defaultVolume = defaultVolume;
    if (djRoleId !== null) patch.djRoleId = djRoleId || null;
    if (commandChannelId !== null) patch.commandChannelId = commandChannelId || null;

    if (!Object.keys(patch).length) {
      const settings = await this.settingsService.getGuildSettings(interaction.guildId);
      await reply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("Configuracion actual")
            .setDescription(JSON.stringify(settings, null, 2)),
        ],
      });
      return;
    }

    const next = await this.settingsService.updateGuildSettings(interaction.guildId, patch, {
      userId: interaction.user.id,
      source: "discord",
    });

    await reply(interaction, {
      content: `Configuracion actualizada: \`${JSON.stringify(next)}\``,
      ephemeral: true,
    });
  }

  async handleStatus(interaction) {
    const status = this.getSystemHealth();
    await reply(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("Estado del sistema")
          .addFields(
            { name: "Bot", value: this.client.isReady() ? "Conectado" : "Desconectado", inline: true },
            { name: "Ping", value: `${this.client.ws.ping} ms`, inline: true },
            { name: "Sesiones activas", value: `${status.activeSessions}`, inline: true },
            { name: "Repositorio", value: status.repository, inline: true },
            { name: "Neon DB", value: status.neonConfigured ? "Listo" : "No configurado", inline: true },
            { name: "Modo degradado", value: status.repositoryDegraded ? "Si" : "No", inline: true },
          ),
      ],
      ephemeral: true,
    });
  }

  getSystemHealth() {
    return {
      repository: this.repository.type,
      activeSessions: this.sessions.size,
      cachedSnapshots: this.snapshotCatalog.size,
      discordReady: this.client.isReady(),
      discordPing: this.client.ws.ping,
      neonConfigured: this.cloudClients.neonApiConfigured || Boolean(this.config.database.url),
      repositoryDegraded: Boolean(this.repository.isDegraded),
      pendingWrites: this.repository.pendingWrites?.length ?? 0,
      startedAt: this.startedAt ?? null,
    };
  }

  listSessions() {
    return [...this.sessions.values()];
  }

  getSession(guildId) {
    return this.sessions.get(guildId) ?? this.snapshotCatalog.get(guildId) ?? null;
  }

  markStarted() {
    this.startedAt = new Date().toISOString();
  }
}

module.exports = { MusicSystem, reply };
