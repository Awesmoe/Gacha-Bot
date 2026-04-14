const { EmbedBuilder } = require('discord.js');
const { analyzePulls } = require('../../lib/analytics');
const config = require('./config');
const db = require('../../lib/db');

const RESULT_LABEL = { won: '✅ Won', lost: '❌ Lost', guaranteed: '🔒 Guaranteed', unknown: '❓' };

function getFeaturedForPullFromSchedule(pull, schedule) {
  const utcPlus8 = new Date(Number(pull.gacha_ts) + 8 * 3600000);
  const pullDate = utcPlus8.toISOString().slice(0, 10);
  const allFeatured = new Set();

  for (const banner of schedule) {
    if (!banner.end) continue;
    if (pullDate >= banner.start && pullDate < banner.end) {
      for (const item of banner.featured) {
        allFeatured.add(item);
      }
    }
  }

  return allFeatured.size > 0 ? [...allFeatured] : null;
}

function getFeaturedCharactersForPull(pull) {
  return getFeaturedForPullFromSchedule(pull, db.getSchedule('genshin', 'character'));
}

function getFeaturedWeaponsForPull(pull) {
  return getFeaturedForPullFromSchedule(pull, db.getSchedule('genshin', 'weapon'));
}

function groupPullsByType(allPulls) {
  const grouped = {};
  for (const key of Object.keys(config.bannerTypes)) grouped[key] = [];
  for (const p of allPulls) {
    const type = config.classifyPull(p);
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(p);
  }
  return grouped;
}

function buildStatsEmbed(allPulls, bannerMap) {
  const grouped = groupPullsByType(allPulls);

  const total = allPulls.length;
  const overview = new EmbedBuilder()
    .setTitle('📊 Wish Statistics')
    .setColor(0x1a78c2)
    .setDescription(`**${total}** total wishes across all banners`)
    .setFooter({ text: 'Genshin Impact' });

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
      if (s.guaranteed > 0) fieldValue += ` / **${s.guaranteed}** guaranteed`;
      if (bt.guaranteesAfterLoss && analysis.nextIsGuarantee) fieldValue += `\nNext 5★: **guaranteed featured**`;
    }

    overview.addFields({ name: bt.label, value: fieldValue, inline: true });
  }

  return [overview];
}

function buildHistoryEmbed(allPulls, bannerMap) {
  const grouped = groupPullsByType(allPulls);

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
      .setColor(bt.has5050 ? 0x1a78c2 : 0x7b68ee);

    const recent = [...analysis.sixStars].reverse().slice(0, 20);
    const lines = recent.map(p => {
      const date = new Date(Number(p.gacha_ts));
      const ds = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
    .setColor(0x22c55e)
    .setDescription(
      `**${inserted}** new wishes imported, **${skipped}** duplicates skipped\n${breakdown}`
    )
    .setFooter({ text: 'Use /stats to see your wish statistics' });
}

module.exports = { buildStatsEmbed, buildHistoryEmbed, buildImportEmbed };
