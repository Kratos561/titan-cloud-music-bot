function createCloudClients(config, logger) {
  logger.info("Cloud clients preparados.", {
    neonApiConfigured: Boolean(config.cloud.neonApiKey),
    neonProjectIdConfigured: Boolean(config.cloud.neonProjectId),
    databaseUrlConfigured: Boolean(config.database.url),
  });

  return {
    neonApiConfigured: Boolean(config.cloud.neonApiKey),
    neonProjectId: config.cloud.neonProjectId,
  };
}

module.exports = { createCloudClients };
