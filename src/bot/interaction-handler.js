const { reply } = require("../services/music-system");

function formatInteractionError(error) {
  if (!error?.message) {
    return "Ocurrio un error interno.";
  }

  if (error.message.includes("Cannot connect to the voice channel after 30 seconds")) {
    return (
      "No pude completar la conexion de voz con Discord en 30 segundos. " +
      "Si el bot ya tiene permisos `ViewChannel`, `Connect` y `Speak` en ese canal, entonces el problema es del hosting/red del servidor donde esta corriendo el bot."
    );
  }

  if (error.message.includes("I do not have permission to join this voice channel")) {
    return "No tengo permisos para entrar o hablar en ese canal de voz.";
  }

  return error.message;
}

function createInteractionHandler({ musicSystem, logger }) {
  return async function onInteraction(interaction) {
    if (!interaction.isChatInputCommand() || !interaction.inGuild()) {
      return;
    }

    try {
      switch (interaction.commandName) {
        case "play":
          await musicSystem.handlePlay(interaction);
          return;
        case "queue":
          await musicSystem.handleQueue(interaction);
          return;
        case "nowplaying":
          await musicSystem.handleNowPlaying(interaction);
          return;
        case "pause":
          await musicSystem.handlePause(interaction);
          return;
        case "resume":
          await musicSystem.handleResume(interaction);
          return;
        case "skip":
          await musicSystem.handleSkip(interaction);
          return;
        case "stop":
          await musicSystem.handleStop(interaction);
          return;
        case "volume":
          await musicSystem.handleVolume(interaction);
          return;
        case "loop":
          await musicSystem.handleLoop(interaction);
          return;
        case "shuffle":
          await musicSystem.handleShuffle(interaction);
          return;
        case "autoplay":
          await musicSystem.handleAutoplay(interaction);
          return;
        case "filter":
          await musicSystem.handleFilter(interaction);
          return;
        case "seek":
          await musicSystem.handleSeek(interaction);
          return;
        case "disconnect":
          await musicSystem.handleDisconnect(interaction);
          return;
        case "restore":
          await musicSystem.handleRestore(interaction);
          return;
        case "settings":
          await musicSystem.handleSettings(interaction);
          return;
        case "status":
          await musicSystem.handleStatus(interaction);
          return;
        default:
          await reply(interaction, {
            content: "Comando no soportado por el sistema actual.",
            ephemeral: true,
          });
      }
    } catch (error) {
      logger.error("Error procesando interaccion.", {
        commandName: interaction.commandName,
        error: error.message,
      });

      try {
        const errorMessage = `No pude completar el comando: ${formatInteractionError(error)}`;
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: errorMessage }).catch(() => { });
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => { });
        }
      } catch {
        // Silently ignore - interaction may have expired
      }
    }
  };
}

module.exports = { createInteractionHandler };
