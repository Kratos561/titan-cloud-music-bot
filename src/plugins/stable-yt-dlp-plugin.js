const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ExtractorPlugin, Playlist, Song } = require("distube");

const YOUTUBE_URL_PATTERN =
  /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/|youtu\.be\/)/i;

function toSafeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pickThumbnail(entry) {
  if (entry?.thumbnail) {
    return entry.thumbnail;
  }

  const thumbnails = Array.isArray(entry?.thumbnails) ? entry.thumbnails : [];
  return thumbnails.at(-1)?.url ?? null;
}

function normalizeVideoUrl(entry, fallbackUrl) {
  if (entry?.webpage_url) {
    return entry.webpage_url;
  }

  if (entry?.url && YOUTUBE_URL_PATTERN.test(entry.url)) {
    return entry.url;
  }

  if (entry?.id) {
    return `https://www.youtube.com/watch?v=${entry.id}`;
  }

  return fallbackUrl ?? null;
}

function extractUsefulMessage(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.at(-1) ?? "yt-dlp devolvio una respuesta vacia.";
}

function parseJsonFromOutput(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{") && !line.startsWith("[")) {
      continue;
    }

    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }

  throw new Error(extractUsefulMessage(text));
}

function parseStreamUrlFromOutput(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) => /^https?:\/\//i.test(line)) ?? null;
}

function toNetscapeCookieLine(cookie) {
  const domain = String(cookie.domain ?? "").trim();
  const pathValue = String(cookie.path ?? "/").trim() || "/";
  const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
  const secure = cookie.secure ? "TRUE" : "FALSE";
  const expires =
    cookie.expirationDate ??
    cookie.expires ??
    cookie.expiry ??
    cookie.expire ??
    0;
  const expiresAt = Number.isFinite(Number(expires)) ? Math.trunc(Number(expires)) : 0;
  const name = String(cookie.name ?? "").replace(/\s+/g, " ").trim();
  const value = String(cookie.value ?? "").replace(/\r/g, "").replace(/\n/g, "");

  if (!domain || !name) {
    return null;
  }

  return [domain, includeSubdomains, pathValue, secure, `${expiresAt}`, name, value].join("\t");
}

function writeCookieFile(cookies) {
  const lines = ["# Netscape HTTP Cookie File"];

  for (const cookie of cookies) {
    const line = toNetscapeCookieLine(cookie);
    if (line) {
      lines.push(line);
    }
  }

  const filePath = path.join(os.tmpdir(), `titan-ytdlp-cookies-${process.pid}.txt`);
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

class StableYtDlpPlugin extends ExtractorPlugin {
  constructor({ cookies, logger, ytdlpPath = "yt-dlp" } = {}) {
    super();
    this.logger = logger;
    this.ytdlpPath = ytdlpPath;
    this.cookieFilePath = Array.isArray(cookies) && cookies.length ? writeCookieFile(cookies) : null;

    if (this.cookieFilePath) {
      this.logger?.info("Cookies de YouTube escritas.", {
        count: cookies.length,
      });
    }
  }

  get baseArgs() {
    const args = [
      "--no-warnings",
      "--no-check-certificate",
      "--extractor-args",
      "youtube:player_client=android,web",
    ];

    if (this.cookieFilePath) {
      args.push("--cookies", this.cookieFilePath);
    }

    return args;
  }

  runYtDlp(args, timeoutMs = 45000) {
    const result = spawnSync(this.ytdlpPath, [...this.baseArgs, ...args], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    });

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const combined = [stdout, stderr].filter(Boolean).join("\n");

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(extractUsefulMessage(combined));
    }

    return { combined };
  }

  createSong(entry, options = {}, fallbackUrl = null) {
    return new Song(
      {
        plugin: this,
        source: "youtube",
        playFromSource: true,
        id: entry.id,
        name: entry.title ?? entry.fulltitle ?? "Sin titulo",
        isLive: Boolean(entry.is_live),
        duration: Number.isFinite(Number(entry.duration)) ? Number(entry.duration) : 0,
        url: normalizeVideoUrl(entry, fallbackUrl),
        thumbnail: pickThumbnail(entry),
        views: toSafeInteger(entry.view_count, 0),
        likes: toSafeInteger(entry.like_count, 0),
        uploader: {
          name: entry.uploader ?? entry.channel ?? entry.channel_id ?? undefined,
          url: entry.uploader_url ?? entry.channel_url ?? undefined,
        },
        ageRestricted: Number(entry.age_limit ?? 0) >= 18,
      },
      options,
    );
  }

  async validate(url) {
    return YOUTUBE_URL_PATTERN.test(url);
  }

  async resolve(url, options = {}) {
    const metadata = parseJsonFromOutput(
      this.runYtDlp(["--dump-single-json", "--flat-playlist", url], 45000).combined,
    );

    if (Array.isArray(metadata.entries) && metadata.entries.length) {
      const songs = metadata.entries
        .filter((entry) => entry?.id)
        .map((entry) => this.createSong(entry, options, normalizeVideoUrl(entry, url)));

      return new Playlist(
        {
          source: "youtube",
          songs,
          id: metadata.id ?? undefined,
          name: metadata.title ?? metadata.playlist_title ?? "Playlist",
          url: metadata.webpage_url ?? url,
          thumbnail: pickThumbnail(metadata),
        },
        options,
      );
    }

    return this.createSong(metadata, options, url);
  }

  async searchSong(query, options = {}) {
    const payload = parseJsonFromOutput(
      this.runYtDlp(
        ["--dump-single-json", "--flat-playlist", "--playlist-end", "1", `ytsearch1:${query}`],
        30000,
      ).combined,
    );

    const entry = Array.isArray(payload.entries) ? payload.entries[0] : payload;
    if (!entry?.id) {
      return null;
    }

    return this.createSong(entry, options);
  }

  async getStreamURL(song) {
    if (song.stream.playFromSource && song.stream.url) {
      return song.stream.url;
    }

    const streamUrl = parseStreamUrlFromOutput(
      this.runYtDlp(
        ["-f", "bestaudio[acodec!=none]/bestaudio/best", "--get-url", song.url],
        45000,
      ).combined,
    );

    if (!streamUrl) {
      throw new Error(`yt-dlp no devolvio un stream valido para ${song.url}`);
    }

    if (song.stream.playFromSource) {
      song.stream.url = streamUrl;
    }

    return streamUrl;
  }

  async getRelatedSongs(song) {
    const query = [song.uploader?.name, song.name].filter(Boolean).join(" - ");
    if (!query) {
      return [];
    }

    try {
      const payload = parseJsonFromOutput(
        this.runYtDlp(
          ["--dump-single-json", "--flat-playlist", "--playlist-end", "5", `ytsearch5:${query}`],
          30000,
        ).combined,
      );

      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      return entries
        .filter((entry) => entry?.id && entry.id !== song.id)
        .slice(0, 3)
        .map((entry) => this.createSong(entry));
    } catch (error) {
      this.logger?.warn("No pude obtener canciones relacionadas.", {
        songId: song.id,
        error: error.message,
      });
      return [];
    }
  }
}

module.exports = { StableYtDlpPlugin };
