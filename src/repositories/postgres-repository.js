const { Pool } = require("pg");
const fs = require("node:fs");
const path = require("node:path");

class PostgresRepository {
  constructor(connectionString, logger) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes("sslmode=require")
        ? undefined
        : { rejectUnauthorized: false },
    });
    this.logger = logger;
    this.type = "postgres";
  }

  async initialize() {
    const schemaPath = path.join(__dirname, "..", "..", "database", "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");
    await this.pool.query(schema);
    this.logger.info("Postgres repository listo.");
  }

  async getGuildSettings(guildId) {
    const result = await this.pool.query(
      "SELECT settings FROM guild_settings WHERE guild_id = $1",
      [guildId],
    );

    return result.rows[0]?.settings ?? null;
  }

  async saveGuildSettings(guildId, settings) {
    await this.pool.query(
      `
        INSERT INTO guild_settings (guild_id, settings, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (guild_id)
        DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()
      `,
      [guildId, JSON.stringify(settings)],
    );

    return settings;
  }

  async getPlaybackSnapshot(guildId) {
    const result = await this.pool.query(
      "SELECT snapshot FROM playback_snapshots WHERE guild_id = $1",
      [guildId],
    );

    return result.rows[0]?.snapshot ?? null;
  }

  async savePlaybackSnapshot(guildId, snapshot) {
    await this.pool.query(
      `
        INSERT INTO playback_snapshots (guild_id, snapshot, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (guild_id)
        DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()
      `,
      [guildId, JSON.stringify(snapshot)],
    );

    return snapshot;
  }

  async listPlaybackSnapshots(limit = 50) {
    const result = await this.pool.query(
      `
        SELECT snapshot
        FROM playback_snapshots
        ORDER BY updated_at DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => row.snapshot);
  }

  async appendAuditEvent(event) {
    const result = await this.pool.query(
      `
        INSERT INTO audit_events (event_type, guild_id, user_id, payload)
        VALUES ($1, $2, $3, $4::jsonb)
        RETURNING id, event_type AS "eventType", guild_id AS "guildId", user_id AS "userId",
                  payload, created_at AS "createdAt"
      `,
      [
        event.eventType,
        event.guildId ?? null,
        event.userId ?? null,
        JSON.stringify(event.payload ?? {}),
      ],
    );

    return result.rows[0];
  }

  async listAuditEvents(limit = 50) {
    const result = await this.pool.query(
      `
        SELECT id, event_type AS "eventType", guild_id AS "guildId", user_id AS "userId",
               payload, created_at AS "createdAt"
        FROM audit_events
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows;
  }
}

module.exports = { PostgresRepository };

