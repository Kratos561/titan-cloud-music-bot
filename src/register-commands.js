const { REST, Routes } = require("discord.js");
const commands = require("./commands");
const config = require("./config");

async function main() {
  const rest = new REST({ version: "10" }).setToken(config.discord.token);
  const body = commands.map((command) => command.toJSON());

  console.log(`Registrando ${body.length} slash commands...`);

  if (config.discord.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), {
      body,
    });

    console.log(`Slash commands registradas en el servidor ${config.discord.guildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.discord.clientId), { body });
  console.log("Slash commands globales registradas.");
}

main().catch((error) => {
  console.error("No se pudieron registrar las slash commands.");
  console.error(error);
  process.exitCode = 1;
});
