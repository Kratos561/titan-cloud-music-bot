const { reply } = require("../services/music-system");

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

      await reply(interaction, {
        content: `No pude completar el comando: ${error.message}`,
        ephemeral: true,
      });
    }
  };
}

module.exports = { createInteractionHandler };
