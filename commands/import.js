const { SlashCommandBuilder } = require('discord.js');
const games = require('../games');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('import')
    .setDescription('Import your gacha pull history')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Which game')
        .setRequired(true)
        .addChoices(...games.choices())
    )
    .addStringOption(opt =>
      opt.setName('token')
        .setDescription('Your auth token (from PowerShell script)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('server_id')
        .setDescription('Server ID (default: 3 for global)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const gameId = interaction.options.getString('game');
    const token = interaction.options.getString('token');
    const serverId = interaction.options.getString('server_id') || '3';
    const game = games.get(gameId);

    if (!game) {
      return interaction.reply({ content: `Unknown game: ${gameId}`, ephemeral: true });
    }

    // Defer since API fetching takes a while
    await interaction.deferReply({ ephemeral: true });

    console.log(`[${interaction.user.tag}] Import requested for ${gameId}`);
    console.log(`[${interaction.user.tag}] Server ID: ${serverId}`);

    try {
      // Seed any default banners not yet in the DB
      if (game.defaultBanners) {
        const existing = new Set(db.getAllBanners(gameId).map(b => b.pool_name));
        for (const [poolName, featured] of Object.entries(game.defaultBanners)) {
          if (!existing.has(poolName)) {
            db.upsertBanner(gameId, poolName, featured);
          }
        }
      }

      // Fetch from game API
      const raw = await game.api.fetchAllPulls(token, serverId, (msg) => {
        // Could update deferred reply but that's rate-limited, just log
        console.log(`[${interaction.user.tag}] ${msg}`);
      });

      if (game.observations?.appendUnknownObservations) {
        game.observations.appendUnknownObservations(raw, (msg) => {
          console.log(`[${interaction.user.tag}] ${msg}`);
        });
      }

      // Normalize and insert
      const pulls = game.api.normalizePulls(raw);
      const { inserted, skipped } = db.insertPulls(interaction.user.id, gameId, pulls);

      // Game-specific extras (e.g. Nikki lifetime aggregates)
      if (typeof game.api.persistExtras === 'function') {
        game.api.persistExtras(interaction.user.id, raw);
      }

      const importBreakdown = {};
      for (const [key, value] of Object.entries(raw)) {
        importBreakdown[key] = Array.isArray(value) ? value.length : 0;
      }

      const embed = game.format.buildImportEmbed(inserted, skipped, importBreakdown);
      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error(`Import error for ${interaction.user.tag}:`, err);

      let msg = 'Import failed: ';
      if (err.message.includes('API error')) {
        msg += 'Token may be expired. Open pull history in-game and get a fresh token.';
      } else {
        msg += err.message;
      }

      await interaction.editReply({ content: msg });
    }
  },
};
