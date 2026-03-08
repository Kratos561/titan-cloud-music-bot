const { SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Busca la cancion en YouTube y la reproduce o la agrega a la cola.")
    .addStringOption((option) =>
      option
        .setName("busqueda")
        .setDescription("Nombre de la cancion, artista o enlace.")
        .setRequired(true),
    )
    .setDMPermission(false),
  new SlashCommandBuilder().setName("queue").setDescription("Muestra la cola actual.").setDMPermission(false),
  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Muestra la pista que suena ahora.")
    .setDMPermission(false),
  new SlashCommandBuilder().setName("pause").setDescription("Pausa la reproduccion.").setDMPermission(false),
  new SlashCommandBuilder().setName("resume").setDescription("Reanuda la reproduccion.").setDMPermission(false),
  new SlashCommandBuilder().setName("skip").setDescription("Salta a la siguiente pista.").setDMPermission(false),
  new SlashCommandBuilder().setName("stop").setDescription("Detiene la musica y limpia la cola.").setDMPermission(false),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Ajusta el volumen del bot.")
    .addIntegerOption((option) =>
      option
        .setName("porcentaje")
        .setDescription("Valor entre 1 y 200.")
        .setMinValue(1)
        .setMaxValue(200)
        .setRequired(true),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Configura el modo loop.")
    .addStringOption((option) =>
      option
        .setName("modo")
        .setDescription("Modo de repeticion.")
        .setRequired(true)
        .addChoices(
          { name: "Off", value: "off" },
          { name: "Cancion", value: "song" },
          { name: "Cola", value: "queue" },
        ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder().setName("shuffle").setDescription("Mezcla la cola.").setDMPermission(false),
  new SlashCommandBuilder().setName("autoplay").setDescription("Activa o desactiva autoplay.").setDMPermission(false),
  new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Activa o desactiva filtros de audio.")
    .addStringOption((option) =>
      option
        .setName("modo")
        .setDescription("Filtro a aplicar.")
        .setRequired(true)
        .addChoices(
          { name: "Quitar filtros", value: "clear" },
          { name: "Bassboost", value: "bassboost" },
          { name: "Nightcore", value: "nightcore" },
          { name: "Vaporwave", value: "vaporwave" },
          { name: "Karaoke", value: "karaoke" },
          { name: "Echo", value: "echo" },
          { name: "3D", value: "3d" },
        ),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Mueve la cancion a un segundo exacto.")
    .addIntegerOption((option) =>
      option
        .setName("segundos")
        .setDescription("Segundo objetivo.")
        .setMinValue(0)
        .setRequired(true),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Saca al bot del canal de voz.")
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("restore")
    .setDescription("Restaura la ultima cola guardada para este servidor.")
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Actualiza la configuracion del servidor.")
    .addIntegerOption((option) =>
      option
        .setName("default-volume")
        .setDescription("Volumen inicial para nuevas colas.")
        .setMinValue(1)
        .setMaxValue(200)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("dj-role-id")
        .setDescription("ID del rol DJ autorizado para controles avanzados.")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("command-channel-id")
        .setDescription("ID del canal permitido para comandos.")
        .setRequired(false),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Muestra el estado tecnico del sistema.")
    .setDMPermission(false),
];

module.exports = commands;
