class TtlCache {
  constructor() {
    this.items = new Map();
  }

  set(key, value, ttlMs) {
    this.items.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
  }

  get(key) {
    const entry = this.items.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.items.delete(key);
      return null;
    }

    return entry.value;
  }

  delete(key) {
    this.items.delete(key);
  }
}

module.exports = { TtlCache };

