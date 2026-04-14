const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../lib/db');
const config = require('../config.json');
const BANNER_ADMINS = new Set(config.bannerAdmins || []);

const ENDFIELD = [{ name: 'Arknights: Endfield', value: 'endfield' }];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gryph')
    .setDescription('Manage Endfield banner → featured character mappings (Gryphline)')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add or update a banner mapping')
        .addStringOption(opt => opt.setName('pool_name').setDescription('Banner pool name (exact match from API)').setRequired(true))
        .addStringOption(opt => opt.setName('character').setDescription('Featured character name').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all Endfield banner mappings')
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a banner mapping')
        .addStringOption(opt => opt.setName('pool_name').setDescription('Banner pool name to remove').setRequired(true))
    )
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!BANNER_ADMINS.has(interaction.user.id)) {
      return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const poolName = interaction.options.getString('pool_name');
      const character = interaction.options.getString('character');

      db.upsertBanner('endfield', poolName, character);

      return interaction.reply({
        content: `✅ Banner mapped: **${poolName}** → **${character}**`,
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const banners = db.getAllBanners('endfield');

      if (banners.length === 0) {
        return interaction.reply({ content: 'No Endfield banners configured.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('Banner Mappings — Arknights: Endfield')
        .setColor(0xf59e0b)
        .setDescription(banners.map(b => `**${b.pool_name}** → ${b.featured_item}`).join('\n'));

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'remove') {
      const poolName = interaction.options.getString('pool_name');
      const result = db.removeBanner('endfield', poolName);

      if (result.changes > 0) {
        return interaction.reply({ content: `✅ Removed banner: **${poolName}**`, ephemeral: true });
      } else {
        return interaction.reply({ content: `Banner not found: **${poolName}**`, ephemeral: true });
      }
    }
  },
};
