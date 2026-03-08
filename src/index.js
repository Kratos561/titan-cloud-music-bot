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
  const eventBus = new EventBus();
  const repository = createRepository(config, logger.child("repository"), eventBus);
  await repository.initialize();
  const cache = new TtlCache();
  const cloudClients = createCloudClients(config, logger.child("cloud"));
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
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
