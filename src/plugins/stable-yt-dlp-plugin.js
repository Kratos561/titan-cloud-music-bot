const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { ExtractorPlugin, Playlist, Song } = require("distube");

const YOUTUBE_URL_PATTERN =
  /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/|youtu\.be\/)/i;
const DEFAULT_PIPED_API_BASES = ["https://pipedapi.kavin.rocks"];
const DEFAULT_INVIDIOUS_API_BASES = [
  "https://inv.nadeko.net",
  "https://yewtu.be",
  "https://invidious.nerdvpn.de",
];

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

function parseFilePathFromOutput(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines[index].replace(/^filepath:/i, "").trim();
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function sanitizeFilePart(value) {
  return String(value ?? "track")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "track";
}

function splitConfiguredBases(value, fallback) {
  if (Array.isArray(value) && value.length) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [...fallback];
}

function extractYouTubeVideoId(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.replace(/^\/+/, "").trim() || null;
    }

    if (parsed.searchParams.get("v")) {
      return parsed.searchParams.get("v");
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const embedIndex = parts.findIndex((part) => part === "embed" || part === "shorts" || part === "live");
    if (embedIndex >= 0 && parts[embedIndex + 1]) {
      return parts[embedIndex + 1];
    }
  } catch {
    return null;
  }

  return null;
}

function toAbsoluteUrl(baseUrl, value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cleanupCacheDir(cacheDir, maxAgeMs = 6 * 60 * 60 * 1000) {
  if (!fs.existsSync(cacheDir)) {
    return;
  }

  const cutoff = Date.now() - maxAgeMs;
  for (const entry of fs.readdirSync(cacheDir)) {
    const filePath = path.join(cacheDir, entry);

    try {
      const stats = fs.statSync(filePath);
      if (stats.isFile() && stats.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore cache cleanup errors; they should not block playback.
    }
  }
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
  constructor({ cookies, logger, ytdlpPath = "yt-dlp", poTokenGvs = null, poTokenPlayer = null } = {}) {
    super();
    this.logger = logger;
    this.ytdlpPath = ytdlpPath;
    this.poTokenGvs = poTokenGvs;
    this.poTokenPlayer = poTokenPlayer;
    this.pipedApiBases = splitConfiguredBases(process.env.PIPED_API_BASES, DEFAULT_PIPED_API_BASES);
    this.invidiousApiBases = splitConfiguredBases(process.env.INVIDIOUS_API_BASES, DEFAULT_INVIDIOUS_API_BASES);
    this.cookieFilePath = Array.isArray(cookies) && cookies.length ? writeCookieFile(cookies) : null;

    if (this.cookieFilePath) {
      this.logger?.info("Cookies de YouTube escritas.", {
        count: cookies.length,
      });
    }
  }

  get baseArgs() {
    const args = ["--no-warnings", "--no-check-certificate"];

    if (this.cookieFilePath) {
      args.push("--cookies", this.cookieFilePath);
    }

    return args;
  }

  get streamBaseArgs() {
    return this.buildExtractorArgs({
      playerClient: "tv,tv_simply,android_sdkless,ios,-web,-web_safari,-web_creator,-mweb",
      includeMissingPoFormats: true,
    });
  }

  buildExtractorArgs({ playerClient, includeMissingPoFormats = false, poTokenClient = null } = {}) {
    const pieces = [];

    if (playerClient) {
      pieces.push(`player_client=${playerClient}`);
    }

    if (includeMissingPoFormats) {
      pieces.push("formats=missing_pot");
    }

    const poTokens = [];
    if (poTokenClient && this.poTokenGvs) {
      poTokens.push(`${poTokenClient}.gvs+${this.poTokenGvs}`);
    }
    if (poTokenClient && this.poTokenPlayer) {
      poTokens.push(`${poTokenClient}.player+${this.poTokenPlayer}`);
    }
    if (poTokens.length) {
      pieces.push(`po_token=${poTokens.join(",")}`);
    }

    const args = ["--no-warnings", "--no-check-certificate"];
    if (pieces.length) {
      args.push("--extractor-args", `youtube:${pieces.join(";")}`);
    }

    return args;
  }

  runYtDlp(args, timeoutMs = 45000, options = {}) {
    const baseArgs = options.customBaseArgs ?? (options.streamMode ? this.streamBaseArgs : this.baseArgs);
    const finalArgs = [...baseArgs];

    if (options.includeCookies !== false && !options.streamMode && this.cookieFilePath && !finalArgs.includes("--cookies")) {
      finalArgs.push("--cookies", this.cookieFilePath);
    }

    if (options.includeCookies && options.streamMode && this.cookieFilePath && !finalArgs.includes("--cookies")) {
      finalArgs.push("--cookies", this.cookieFilePath);
    }

    const result = spawnSync(this.ytdlpPath, [...finalArgs, ...args], {
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

  async fetchJson(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  pickPipedStream(baseUrl, payload) {
    const streams = Array.isArray(payload?.audioStreams) ? payload.audioStreams : [];
    const candidates = streams
      .map((entry) => ({
        url: toAbsoluteUrl(baseUrl, entry?.url),
        bitrate: toFiniteNumber(entry?.bitrate ?? entry?.quality ?? entry?.audioQuality, 0),
      }))
      .filter((entry) => entry.url);

    if (!candidates.length) {
      return null;
    }

    candidates.sort((left, right) => right.bitrate - left.bitrate);
    return candidates[0].url;
  }

  pickInvidiousStream(baseUrl, payload) {
    const adaptiveFormats = Array.isArray(payload?.adaptiveFormats) ? payload.adaptiveFormats : [];
    const audioFormats = adaptiveFormats
      .filter((entry) => String(entry?.type ?? "").startsWith("audio/"))
      .map((entry) => ({
        url: toAbsoluteUrl(baseUrl, entry?.url),
        bitrate: toFiniteNumber(entry?.bitrate ?? entry?.audioSampleRate, 0),
      }))
      .filter((entry) => entry.url);

    if (audioFormats.length) {
      audioFormats.sort((left, right) => right.bitrate - left.bitrate);
      return audioFormats[0].url;
    }

    const muxedStreams = Array.isArray(payload?.formatStreams) ? payload.formatStreams : [];
    const muxedCandidates = muxedStreams
      .map((entry) => ({
        url: toAbsoluteUrl(baseUrl, entry?.url),
        bitrate: toFiniteNumber(entry?.bitrate ?? entry?.qualityLabel, 0),
      }))
      .filter((entry) => entry.url);

    if (!muxedCandidates.length) {
      return null;
    }

    muxedCandidates.sort((left, right) => right.bitrate - left.bitrate);
    return muxedCandidates[0].url;
  }

  async tryProxyFallback(song) {
    const videoId = extractYouTubeVideoId(song.url);
    if (!videoId) {
      return null;
    }

    let lastError = null;

    for (const baseUrl of this.pipedApiBases) {
      try {
        const payload = await this.fetchJson(`${baseUrl.replace(/\/+$/, "")}/streams/${videoId}`);
        const streamUrl = this.pickPipedStream(baseUrl, payload);
        if (streamUrl) {
          this.logger?.warn("Usando fallback proxy de Piped.", {
            songId: song.id,
            baseUrl,
          });
          return streamUrl;
        }
      } catch (error) {
        lastError = error;
      }
    }

    for (const baseUrl of this.invidiousApiBases) {
      try {
        const payload = await this.fetchJson(`${baseUrl.replace(/\/+$/, "")}/api/v1/videos/${videoId}`);
        const streamUrl = this.pickInvidiousStream(baseUrl, payload);
        if (streamUrl) {
          this.logger?.warn("Usando fallback proxy de Invidious.", {
            songId: song.id,
            baseUrl,
          });
          return streamUrl;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return null;
  }

  downloadToTempFile(song, selector = null, options = {}) {
    const cacheDir = path.join(os.tmpdir(), "titan-ytdlp-cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    cleanupCacheDir(cacheDir);

    const baseName = `${Date.now()}-${sanitizeFilePart(song.id)}-${sanitizeFilePart(song.name)}`;
    const outputTemplate = path.join(cacheDir, `${baseName}.%(ext)s`);
    const args = ["--ignore-config", "--print", "after_move:filepath", "-o", outputTemplate];

    if (selector) {
      args.push("-f", selector);
    }

    args.push(song.url);

    const filePath = parseFilePathFromOutput(this.runYtDlp(args, 120000, options).combined);
    if (!filePath) {
      throw new Error(`yt-dlp no devolvio un archivo reproducible para ${song.url}`);
    }

    return pathToFileURL(filePath).href;
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

    const selectors = song.isLive
      ? ["b/best"]
      : [
          "ba[ext=webm]/ba[ext=m4a]/ba",
          "b[acodec!=none]/best[acodec!=none]",
          "b/best",
        ];

    let streamUrl = null;
    let lastError = null;
    const streamModes = [
      {
        label: "stream-safari-hls",
        options: {
          streamMode: true,
          includeCookies: false,
          customBaseArgs: this.buildExtractorArgs({
            playerClient: "web_safari,-web,-web_creator,-mweb",
            includeMissingPoFormats: true,
          }),
        },
      },
      { label: "stream-no-cookies", options: { streamMode: true, includeCookies: false } },
      { label: "stream-with-cookies", options: { streamMode: true, includeCookies: true } },
      { label: "default-with-cookies", options: { streamMode: false, includeCookies: true } },
    ];

    if (this.poTokenGvs || this.poTokenPlayer) {
      streamModes.unshift({
        label: "stream-po-token-mweb",
        options: {
          streamMode: true,
          includeCookies: true,
          customBaseArgs: this.buildExtractorArgs({
            playerClient: "mweb,default,-web,-web_creator",
            includeMissingPoFormats: true,
            poTokenClient: "mweb",
          }),
        },
      });
    }

    const downloadSelectors = song.isLive
      ? ["b/best", null]
      : ["ba/b", "b/best", null];
    const downloadModes = [
        {
          label: "download-safari-hls",
          options: {
            streamMode: true,
            includeCookies: false,
            customBaseArgs: this.buildExtractorArgs({
              playerClient: "web_safari,-web,-web_creator,-mweb",
              includeMissingPoFormats: true,
            }),
          },
        },
        { label: "download-no-cookies", options: { streamMode: true, includeCookies: false } },
        { label: "download-with-cookies", options: { streamMode: true, includeCookies: true } },
        { label: "download-default", options: { streamMode: false, includeCookies: true } },
    ];

    if (this.poTokenGvs || this.poTokenPlayer) {
      downloadModes.unshift({
        label: "download-po-token-mweb",
        options: {
          streamMode: true,
          includeCookies: true,
          customBaseArgs: this.buildExtractorArgs({
            playerClient: "mweb,default,-web,-web_creator",
            includeMissingPoFormats: true,
            poTokenClient: "mweb",
          }),
        },
      });
    }

    if (!song.isLive) {
      for (const mode of downloadModes) {
        for (const selector of downloadSelectors) {
          try {
            const filePath = this.downloadToTempFile(song, selector, mode.options);
            this.logger?.warn("Usando fallback por descarga temporal para reproducir.", {
              songId: song.id,
              mode: mode.label,
              selector: selector ?? "default",
              filePath,
            });
            streamUrl = filePath;
            break;
          } catch (error) {
            lastError = error;
            this.logger?.warn("Fallback por descarga temporal no disponible; probando siguiente.", {
              songId: song.id,
              mode: mode.label,
              selector: selector ?? "default",
              error: error.message,
            });
          }
        }

        if (streamUrl) {
          break;
        }
      }
    }

    if (!streamUrl) {
      for (const mode of streamModes) {
        for (const selector of selectors) {
          try {
            streamUrl = parseStreamUrlFromOutput(
              this.runYtDlp(["-f", selector, "--get-url", song.url], 45000, mode.options).combined,
            );

            if (streamUrl) {
              break;
            }
          } catch (error) {
            lastError = error;
            this.logger?.warn("Selector de formato no disponible; probando fallback.", {
              songId: song.id,
              mode: mode.label,
              selector,
              error: error.message,
            });
          }
        }

        if (streamUrl) {
          break;
        }
      }
    }

    if (!streamUrl && song.isLive) {
      for (const mode of downloadModes) {
        for (const selector of downloadSelectors) {
          try {
            const filePath = this.downloadToTempFile(song, selector, mode.options);
            this.logger?.warn("Usando fallback por descarga temporal para reproducir.", {
              songId: song.id,
              mode: mode.label,
              selector: selector ?? "default",
              filePath,
            });
            streamUrl = filePath;
            break;
          } catch (error) {
            lastError = error;
            this.logger?.warn("Fallback por descarga temporal no disponible; probando siguiente.", {
              songId: song.id,
              mode: mode.label,
              selector: selector ?? "default",
              error: error.message,
            });
          }
        }

        if (streamUrl) {
          break;
        }
      }
    }

    if (!streamUrl) {
      try {
        streamUrl = await this.tryProxyFallback(song);
      } catch (error) {
        lastError = error;
        this.logger?.warn("Fallback proxy no disponible.", {
          songId: song.id,
          error: error.message,
        });
      }
    }

    if (!streamUrl) {
      throw lastError ?? new Error(`yt-dlp no devolvio un stream valido para ${song.url}`);
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
