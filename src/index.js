const { Client, Events, GatewayIntentBits, ActivityType } = require("discord.js");
const config = require("./config");
const { createLogger } = require("./lib/logger");
const { EventBus } = require("./lib/event-bus");
const { TtlCache } = require("./lib/cache");
const { createCloudClients } = require("./lib/cloud-clients");
const { createRepository } = require("./repositories/create-repository");
const { SettingsService } = require("./services/settings-service");
const { QueryIntelligenceService } = require("./services/query-intelligence");
const { MusicSystem } = require("./services/music-system");
const { createInteractionHandler } = require("./bot/interaction-handler");
const { createApiServer } = require("./api/server");

async function main() {
  const logger = createLogger("titan");

  // ── PASO 1: Cargar TODAS las dependencias de voz ANTES del cliente ──
  try {
    // 1a. Cargar sodium para cifrado de voz
    const sodium = require("libsodium-wrappers");
    await sodium.ready;
    logger.info("Cifrado de voz listo (libsodium).");
  } catch (err) {
    logger.error("No se pudo cargar libsodium-wrappers.", { error: err.message });
  }

  try {
    // 1b. Cargar DAVE (Discord Audio Visual Encryption) - OBLIGATORIO desde 2025
    require("@snazzah/davey");
    logger.info("DAVE protocol library loaded.");
  } catch (err) {
    logger.error("No se pudo cargar @snazzah/davey (DAVE). Conexiones de voz pueden fallar.", {
      error: err.message,
    });
  }

  try {
    // 1c. Verificar que las dependencias de voz estan completas
    const { generateDependencyReport } = require("@discordjs/voice");
    logger.info("Voice dependency report:\n" + generateDependencyReport());
  } catch (err) {
    logger.error("Error al generar reporte de dependencias de voz.", { error: err.message });
  }

  // ── Evitar que errores no manejados maten el proceso ──
  process.on("unhandledRejection", (error) => {
    logger.error("Unhandled promise rejection.", { error: error?.message ?? String(error) });
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception.", { error: error?.message ?? String(error) });
  });

  const eventBus = new EventBus();
  const repository = createRepository(config, logger.child("repository"), eventBus);
  await repository.initialize();
  const cache = new TtlCache();
  const cloudClients = createCloudClients(config, logger.child("cloud"));

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
    ],
  });

  const settingsService = new SettingsService({
    repository,
    eventBus,
    logger: logger.child("settings"),
    config,
  });

  const queryIntelligence = new QueryIntelligenceService({
    cache,
    logger: logger.child("query"),
  });

  const musicSystem = new MusicSystem({
    client,
    config,
    repository,
    settingsService,
    queryIntelligence,
    eventBus,
    logger: logger.child("music"),
    cloudClients,
  });

  await musicSystem.initialize();
  musicSystem.markStarted();

  client.once(Events.ClientReady, (readyClient) => {
    logger.info("Discord listo.", { user: readyClient.user.tag });
    readyClient.user.setPresence({
      activities: [{ name: "/play para musica cloud", type: ActivityType.Listening }],
      status: "online",
    });
    eventBus.publish("discord.ready", { user: readyClient.user.tag });
  });

  client.on(
    Events.InteractionCreate,
    createInteractionHandler({
      musicSystem,
      logger: logger.child("interactions"),
    }),
  );

  // Evitar que errores no manejados en el client maten el proceso
  client.on("error", (error) => {
    logger.error("Discord client error.", { error: error.message });
  });

  // Debug logging para diagnosticar problemas de voz
  client.on("debug", (message) => {
    if (message.toLowerCase().includes("voice") || message.includes("4014") || message.includes("4017")) {
      logger.info("Discord debug (voice):", { message });
    }
  });

  const apiServer = createApiServer({
    config,
    logger: logger.child("api"),
    musicSystem,
    settingsService,
    repository,
    eventBus,
  });

  await apiServer.start();
  await client.login(config.discord.token);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
