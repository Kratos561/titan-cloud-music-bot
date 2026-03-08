const path = require("node:path");
const express = require("express");
const cors = require("cors");

function createApiServer({ config, logger, musicSystem, settingsService, repository, eventBus }) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  function requireAdminToken(req, res, next) {
    if (!config.dashboardAdminToken) {
      next();
      return;
    }

    if (req.get("x-admin-token") !== config.dashboardAdminToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  }

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: config.botName,
      ...musicSystem.getSystemHealth(),
    });
  });

  app.get("/api/system/health", (_req, res) => {
    res.json(musicSystem.getSystemHealth());
  });

  app.get("/api/sessions", (_req, res) => {
    res.json({
      sessions: musicSystem.listSessions(),
    });
  });

  app.get("/api/sessions/:guildId", (req, res) => {
    const session = musicSystem.getSession(req.params.guildId);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(session);
  });

  app.get("/api/guilds/:guildId/settings", async (req, res, next) => {
    try {
      const settings = await settingsService.getGuildSettings(req.params.guildId);
      res.json(settings);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/guilds/:guildId/settings", requireAdminToken, async (req, res, next) => {
    try {
      const settings = await settingsService.updateGuildSettings(req.params.guildId, req.body ?? {}, {
        source: "dashboard",
        userId: "dashboard",
      });
      res.json(settings);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/audit-events", async (req, res, next) => {
    try {
      const limit = Number.parseInt(req.query.limit ?? "50", 10);
      const events = await repository.listAuditEvents(Number.isNaN(limit) ? 50 : limit);
      res.json({ events });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    for (const event of eventBus.getHistory()) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const listener = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventBus.on("event", listener);

    req.on("close", () => {
      eventBus.off("event", listener);
    });
  });

  app.use(express.static(path.join(__dirname, "public")));

  app.use((error, _req, res, _next) => {
    logger.error("API error.", { error: error.message });
    res.status(500).json({ error: error.message });
  });

  return {
    start() {
      return new Promise((resolve) => {
        const server = app.listen(config.port, () => {
          logger.info("API online.", { port: config.port });
          resolve(server);
        });
      });
    },
  };
}

module.exports = { createApiServer };
