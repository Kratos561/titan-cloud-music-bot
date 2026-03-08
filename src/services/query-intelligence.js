class QueryIntelligenceService {
  constructor({ cache, logger }) {
    this.cache = cache;
    this.logger = logger;
    this.cacheTtlMs = 1000 * 60 * 30;
  }

  analyze(query) {
    const cleaned = query.trim();
    const normalized = cleaned.toLowerCase().replace(/\s+/g, " ").trim();
    const isUrl = /^https?:\/\//i.test(cleaned);
    const modifiers = [];

    for (const token of ["official", "lyrics", "live", "remix", "karaoke", "instrumental", "nightcore"]) {
      if (normalized.includes(token)) {
        modifiers.push(token);
      }
    }

    return {
      original: query,
      cleaned,
      normalized,
      isUrl,
      type: isUrl ? "url" : "search",
      modifiers,
      words: normalized.split(" ").filter(Boolean),
    };
  }

  getCachedResolution(normalizedQuery) {
    return this.cache.get(`resolution:${normalizedQuery}`);
  }

  rememberResolution(normalizedQuery, track) {
    if (!normalizedQuery || !track?.url) {
      return;
    }

    this.cache.set(
      `resolution:${normalizedQuery}`,
      {
        url: track.url,
        title: track.name,
        source: track.source,
      },
      this.cacheTtlMs,
    );

    this.logger.debug("Resolucion cacheada.", { normalizedQuery, url: track.url });
  }
}

module.exports = { QueryIntelligenceService };
