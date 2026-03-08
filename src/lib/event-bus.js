const { EventEmitter } = require("node:events");

class EventBus extends EventEmitter {
  constructor(limit = 100) {
    super();
    this.limit = limit;
    this.history = [];
  }

  publish(type, payload = {}) {
    const event = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    this.history.unshift(event);
    this.history = this.history.slice(0, this.limit);
    this.emit("event", event);
    return event;
  }

  getHistory() {
    return [...this.history];
  }
}

module.exports = { EventBus };

