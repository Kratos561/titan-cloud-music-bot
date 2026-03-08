function createLogger(scope) {
  function write(level, message, context = {}) {
    const payload = {
      time: new Date().toISOString(),
      level,
      scope,
      message,
      ...context,
    };

    console.log(JSON.stringify(payload));
  }

  return {
    debug(message, context) {
      write("debug", message, context);
    },
    info(message, context) {
      write("info", message, context);
    },
    warn(message, context) {
      write("warn", message, context);
    },
    error(message, context) {
      write("error", message, context);
    },
    child(childScope) {
      return createLogger(`${scope}:${childScope}`);
    },
  };
}

module.exports = { createLogger };

