const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load config
const CONFIG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('Missing config.json — copy config.example.json and fill in your values');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Collect command data
const commands = [];
const commandDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandDir).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandDir, file));
  commands.push(cmd.data.toJSON());
}

const rest = new REST().setToken(config.token);

(async () => {
  try {
    console.log(`Registering ${commands.length} commands...`);

    if (config.guildId) {
      // Guild commands (instant, good for dev)
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commands },
      );
      console.log(`Registered to guild ${config.guildId}`);
    } else {
      // Global commands (takes ~1hr to propagate)
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commands },
      );
      console.log('Registered globally');
    }
  } catch (err) {
    console.error('Registration failed:', err);
  }
})();
