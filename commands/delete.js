const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const games = require('../games');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Delete all your pull history for a game')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Which game to delete data for')
        .setRequired(true)
        .addChoices(...games.choices())
    ),

  async execute(interaction) {
    const gameId = interaction.options.getString('game');
    const game = games.get(gameId);

    const summary = db.getPullSummary(interaction.user.id, gameId);

    if (!summary || summary.length === 0) {
      return interaction.reply({ content: `You have no pull data for **${game.displayName}**.`, ephemeral: true });
    }

    const chars = summary.find(r => r.is_weapon === 0)?.total ?? 0;
    const weapons = summary.find(r => r.is_weapon === 1)?.total ?? 0;
    const total = chars + weapons;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('confirm_delete')
        .setLabel('Yes, delete my data')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel_delete')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    const response = await interaction.reply({
      content:
        `⚠️ **Are you sure?**\n` +
        `This will permanently delete your **${game.displayName}** pull history:\n` +
        `**${total}** pulls (Characters: **${chars}**, Weapons: **${weapons}**)\n\n` +
        `This cannot be undone.`,
      components: [row],
      ephemeral: true,
    });

    const confirmation = await response
      .awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 15_000 })
      .catch(() => null);

    if (!confirmation || confirmation.customId === 'cancel_delete') {
      return response.edit({ content: 'Cancelled.', components: [] });
    }

    db.deletePulls(interaction.user.id, gameId);
    return confirmation.update({ content: `✅ Deleted **${total}** pulls for **${game.displayName}**.`, components: [] });
  },
};
