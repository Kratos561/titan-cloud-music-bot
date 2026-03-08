const { MemoryRepository } = require("./memory-repository");
const { ResilientRepository } = require("./resilient-repository");

function createRepository(config, logger, eventBus) {
  if (config.database.url) {
    return new ResilientRepository(config.database.url, logger.child("resilient"), eventBus);
  }

  logger.warn("DATABASE_URL no configurada. Se usara persistencia en memoria.");
  return new MemoryRepository();
}

module.exports = { createRepository };
