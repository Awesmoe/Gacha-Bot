const { EmbedBuilder } = require('discord.js');
const { analyzePulls, groupPullsByType } = require('../../lib/analytics');
const { formatServerDate, featuredForPullOnSchedule } = require('../../lib/time');
const config = require('./config');
const db = require('../../lib/db');

const RESULT_LABEL = { won: '✅ Won', lost: '❌ Lost', guaranteed: '🔒 Guaranteed', unknown: '❓' };

function getFeaturedCharactersForPull(pull) {
  return featuredForPullOnSchedule(pull, db.getSchedule('genshin', 'character'));
}

function getFeaturedWeaponsForPull(pull) {
  return featuredForPullOnSchedule(pull, db.getSchedule('genshin', 'weapon'));
}

function buildStatsEmbed(allPulls, bannerMap, discordId) {
  const grouped = groupPullsByType(allPulls, config);

  const total = allPulls.length;
  const overview = new EmbedBuilder()
    .setTitle('📊 Genshin Statistics')
    .setColor(0x1a78c2)
    .setDescription(`**${total}** total wishes across all banners`)
    .setFooter({ text: 'Genshin Impact' });

  db.applyLastImportTimestamp(overview, discordId, 'genshin');

  for (const [key, bt] of Object.entries(config.bannerTypes)) {
    const pulls = grouped[key];
    if (!pulls || pulls.length === 0) continue;

    const analysisOpts = {
      hardPity: bt.hardPity,
      softPity: bt.softPity,
      has5050: bt.has5050,
      guaranteesAfterLoss: bt.guaranteesAfterLoss,
      topRarity: 5,
    };

    if (key === 'character') analysisOpts.getFeatured = getFeaturedCharactersForPull;
    if (key === 'weapon') analysisOpts.getFeatured = getFeaturedWeaponsForPull;

    const analysis = analyzePulls(pulls, analysisOpts);
    const s = analysis.stats;

    let fieldValue = '';
    fieldValue += `Wishes: **${s.total}** · 5★: **${s.r6}** (${s.r6pct}%)`;
    fieldValue += `\nAvg pity: **${s.avgPity || '—'}** · Current: **${analysis.currentPity}**/${bt.hardPity}`;
    fieldValue += `\n4★ pity: **${analysis.fiveStarPity}**/10`;

    if (bt.has5050 && s.r6 > 0) {
      const oddsLabel = bt.isWeapon ? '25/75' : '50/50';
      fieldValue += `\n${oddsLabel}: **${s.won}**W / **${s.lost}**L`;
      if (s.won + s.lost > 0) {
        const winrate = (s.won / (s.won + s.lost) * 100).toFixed(2);
        fieldValue += ` (**${winrate}%**)`;
      }
      if (bt.guaranteesAfterLoss && analysis.nextIsGuarantee) fieldValue += `\nNext 5★: **guaranteed featured**`;
    }

    overview.addFields({ name: bt.label, value: fieldValue, inline: true });
  }

  return [overview];
}

function buildHistoryEmbed(allPulls, bannerMap) {
  const grouped = groupPullsByType(allPulls, config);

  const embeds = [];

  for (const [key, bt] of Object.entries(config.bannerTypes)) {
    const pulls = grouped[key];
    if (!pulls || pulls.length === 0) continue;

    const analysisOpts = {
      hardPity: bt.hardPity,
      softPity: bt.softPity,
      has5050: bt.has5050,
      guaranteesAfterLoss: bt.guaranteesAfterLoss,
      topRarity: 5,
    };

    if (key === 'character') analysisOpts.getFeatured = getFeaturedCharactersForPull;
    if (key === 'weapon') analysisOpts.getFeatured = getFeaturedWeaponsForPull;

    const analysis = analyzePulls(pulls, analysisOpts);
    if (analysis.sixStars.length === 0) continue;

    const embed = new EmbedBuilder()
      .setTitle(`${bt.label} — 5★ History`)
      .setColor(0x1a78c2);

    const recent = [...analysis.sixStars].reverse().slice(0, 20);
    const lines = recent.map(p => {
      const ds = formatServerDate(p.gacha_ts);
      const result = p.result ? ` ${RESULT_LABEL[p.result]}` : '';
      return `**${p.item_name}** — #${p._pity} pity${result} (${ds})`;
    });

    embed.setDescription(lines.join('\n'));
    if (analysis.sixStars.length > 20) {
      embed.setFooter({ text: `Showing 20 of ${analysis.sixStars.length} total 5★ wishes` });
    }
    embeds.push(embed);
  }

  if (embeds.length === 0) {
    embeds.push(new EmbedBuilder().setDescription('No 5★ wishes found').setColor(0x5a6070));
  }

  return embeds;
}

function buildImportEmbed(inserted, skipped, totalByType) {
  const breakdown = Object.entries(totalByType)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: **${v}**`)
    .join(' · ');

  return new EmbedBuilder()
    .setTitle('✅ Import Complete')
    .setColor(0x1a78c2)
    .setDescription(
      `**${inserted}** new wishes imported, **${skipped}** duplicates skipped\n${breakdown}`
    )
    .setFooter({ text: 'Use /stats and /history to see your data' });
}

module.exports = { buildStatsEmbed, buildHistoryEmbed, buildImportEmbed };
