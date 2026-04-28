const { SlashCommandBuilder } = require('discord.js');
const games = require('../games');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View your gacha pull statistics')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Which game')
        .setRequired(false)
        .addChoices(...games.choices())
    ),

  async execute(interaction) {
    const gameId = interaction.options.getString('game') || 'endfield';
    const game = games.get(gameId);

    if (!game) {
      return interaction.reply({ content: `Unknown game: ${gameId}`, ephemeral: true });
    }

    const allPulls = db.getPulls(interaction.user.id, gameId);

    if (allPulls.length === 0) {
      return interaction.reply({
        content: 'No pulls found. Use `/import` to import your pull history first!',
        ephemeral: true,
      });
    }

    // Build banner map from DB
    const bannerMap = {};
    for (const b of db.getAllBanners(gameId)) {
      bannerMap[b.pool_name] = b.featured_item;
    }

    const embeds = game.format.buildStatsEmbed(allPulls, bannerMap, interaction.user.id);
    return interaction.reply({ embeds, ephemeral: true });
  },
};
