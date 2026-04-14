const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load config
const CONFIG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('Missing config.json — copy config.example.json and fill in your values');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Init DB (creates tables on first run, seeds default banners)
const db = require('./lib/db');
const games = require('./games');

// Seed default banners for all registered games
for (const gameId of games.list()) {
  const game = games.get(gameId);
  if (game.defaultBanners) {
    const existing = db.getAllBanners(gameId);
    if (existing.length === 0) {
      for (const [poolName, featured] of Object.entries(game.defaultBanners)) {
        db.upsertBanner(gameId, poolName, featured);
      }
      console.log(`Seeded ${Object.keys(game.defaultBanners).length} default banners for ${gameId}`);
    }
  }
}

// Create client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Load commands
client.commands = new Collection();
const commandDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandDir).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandDir, file));
  client.commands.set(cmd.data.name, cmd);
  console.log(`Loaded command: /${cmd.data.name}`);
}

// Handle interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error executing /${interaction.commandName}:`, err);
    const reply = { content: 'Something went wrong. Try again later.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Serving ${client.guilds.cache.size} guild(s)`);
});

client.login(config.token);
