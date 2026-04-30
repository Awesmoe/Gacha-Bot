const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../lib/db');
const config = require('../config.json');
const BANNER_ADMINS = new Set(config.bannerAdmins || []);

const HOYO_GAMES = [
  { name: 'Honkai: Star Rail', value: 'starrail' },
  { name: 'Genshin Impact', value: 'genshin' },
];

const BANNER_TYPES = [
  { name: 'Character', value: 'character' },
  { name: 'Light Cone', value: 'lightcone' },
  { name: 'Weapon', value: 'weapon' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hoyo')
    .setDescription('Manage HSR/Genshin banner schedule for 50/50 detection (HoYoverse)')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a banner schedule entry')
        .addStringOption(opt => opt.setName('game').setDescription('Which game').setRequired(true).addChoices(...HOYO_GAMES))
        .addStringOption(opt => opt.setName('banner_type').setDescription('Banner type').setRequired(true).addChoices(...BANNER_TYPES))
        .addStringOption(opt => opt.setName('start_date').setDescription('Start date (YYYY-MM-DD)').setRequired(true))
        .addStringOption(opt => opt.setName('featured').setDescription('Featured item(s), comma-separated').setRequired(true))
        .addStringOption(opt => opt.setName('end_date').setDescription('End date (YYYY-MM-DD), omit if still active').setRequired(false))
        .addStringOption(opt => opt.setName('name').setDescription('Banner name').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List banner schedule entries')
        .addStringOption(opt => opt.setName('game').setDescription('Which game').setRequired(true).addChoices(...HOYO_GAMES))
        .addStringOption(opt => opt.setName('banner_type').setDescription('Banner type').setRequired(true).addChoices(...BANNER_TYPES))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a schedule entry by ID')
        .addIntegerOption(opt => opt.setName('id').setDescription('Entry ID (from /hoyo list)').setRequired(true))
    )
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!BANNER_ADMINS.has(interaction.user.id)) {
      return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const gameId = interaction.options.getString('game');
      const bannerType = interaction.options.getString('banner_type');
      const startDate = interaction.options.getString('start_date');
      const endDate = interaction.options.getString('end_date') || null;
      const name = interaction.options.getString('name') || null;
      const featuredRaw = interaction.options.getString('featured');
      const featured = featuredRaw.split(',').map(s => s.trim()).filter(Boolean);

      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate))) {
        return interaction.reply({ content: 'Dates must be in YYYY-MM-DD format.', ephemeral: true });
      }

      const result = db.insertScheduleEntry({ game: gameId, bannerType, startDate, endDate, name, featured });

      return interaction.reply({
        content: `✅ Schedule entry added (id: ${result.lastInsertRowid})\n${gameId}/${bannerType} · ${startDate}${endDate ? ` → ${endDate}` : ''} · **${featured.join(', ')}**`,
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const gameId = interaction.options.getString('game');
      const bannerType = interaction.options.getString('banner_type');
      const entries = db.getSchedule(gameId, bannerType);

      if (entries.length === 0) {
        return interaction.reply({ content: `No schedule entries for ${gameId}/${bannerType}.`, ephemeral: true });
      }

      const recent = entries.slice(-25);
      const lines = recent.map(e =>
        `\`${e.id}\` ${e.start}${e.end ? ` → ${e.end}` : ' → ?'} · **${e.featured.join(', ')}**${e.name ? ` *(${e.name})*` : ''}`
      );

      const embed = new EmbedBuilder()
        .setTitle(`Banner Schedule — ${gameId}/${bannerType}`)
        .setColor(gameId === 'starrail' ? 0x9ca3af : 0x1a78c2)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${entries.length} total entries${entries.length > 25 ? ' (showing last 25)' : ''}` });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'remove') {
      const id = interaction.options.getInteger('id');
      const result = db.removeScheduleEntry(id);

      if (result.changes > 0) {
        return interaction.reply({ content: `✅ Removed schedule entry id: **${id}**`, ephemeral: true });
      } else {
        return interaction.reply({ content: `Schedule entry not found: id **${id}**`, ephemeral: true });
      }
    }
  },
};
