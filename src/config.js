const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Falta la variable de entorno requerida: ${name}`);
  }

  return value.trim();
}

function optionalEnv(name, fallback = null) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function integerEnv(name, fallback) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`La variable ${name} debe ser un numero entero.`);
  }

  return parsed;
}

function readYouTubeCookies() {
  const configuredPath = optionalEnv("YOUTUBE_COOKIES_FILE");

  if (!configuredPath) {
    return undefined;
  }

  const resolvedPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`No existe el archivo de cookies de YouTube: ${resolvedPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

  if (!Array.isArray(parsed)) {
    throw new Error("YOUTUBE_COOKIES_FILE debe contener un arreglo JSON de cookies.");
  }

  return parsed;
}

const config = {
  nodeEnv: optionalEnv("NODE_ENV", "development"),
  botName: optionalEnv("BOT_NAME", "Titan Cloud Music"),
  port: integerEnv("PORT", 3000),
  dashboardAdminToken: optionalEnv("DASHBOARD_ADMIN_TOKEN"),
  discord: {
    token: requireEnv("DISCORD_TOKEN"),
    clientId: requireEnv("DISCORD_CLIENT_ID"),
    guildId: optionalEnv("DISCORD_GUILD_ID"),
  },
  audio: {
    defaultVolume: integerEnv("DEFAULT_VOLUME", 80),
    maxVolume: integerEnv("MAX_VOLUME", 200),
    youtubeCookies: readYouTubeCookies(),
  },
  database: {
    url: optionalEnv("DATABASE_URL"),
  },
  cloud: {
    neonApiKey: optionalEnv("NEON_API_KEY"),
    neonProjectId: optionalEnv("NEON_PROJECT_ID"),
  },
};

module.exports = config;
