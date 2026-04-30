const { EmbedBuilder } = require('discord.js');
const { analyzePulls, groupPullsByType } = require('../../lib/analytics');
const { formatServerDate, featuredForPullOnSchedule } = require('../../lib/time');
const config = require('./config');
const db = require('../../lib/db');

const RESULT_LABEL = { won: '✅ Won', lost: '❌ Lost', guaranteed: '🔒 Guaranteed', unknown: '❓' };

function getStoredGachaId(pull) {
  if (!pull.extra_json) return null;
  if (typeof pull.extra_json === 'object') return pull.extra_json.gacha_id || null;
  try {
    return JSON.parse(pull.extra_json)?.gacha_id || null;
  } catch {
    return null;
  }
}

function getFeaturedFromGachaId(pull, expectedType) {
  const gachaId = getStoredGachaId(pull);
  if (!gachaId) return null;
  const entry = db.getGachaIdMap(gachaId);
  if (!entry || entry.banner_type !== expectedType) return null;
  return entry.featured.length > 0 ? entry.featured : null;
}

function getFeaturedCharactersForPull(pull) {
  return getFeaturedFromGachaId(pull, 'character')
    || featuredForPullOnSchedule(pull, db.getSchedule('starrail', 'character'));
}

function getFeaturedLightConesForPull(pull) {
  return getFeaturedFromGachaId(pull, 'lightcone')
    || featuredForPullOnSchedule(pull, db.getSchedule('starrail', 'lightcone'));
}

function buildStatsEmbed(allPulls, bannerMap, discordId) {
  const grouped = groupPullsByType(allPulls, config);

  const total = allPulls.length;
  const overview = new EmbedBuilder()
    .setTitle('📊 Star Rail Statistics')
    .setColor(0x9ca3af)
    .setDescription(`**${total}** total warps across all banners`)
    .setFooter({ text: 'Honkai: Star Rail' });

  db.applyLastImportTimestamp(overview, discordId, 'starrail');

  for (const [key, bt] of Object.entries(config.bannerTypes)) {
    const pulls = grouped[key];
    if (!pulls || pulls.length === 0) continue;

    // HSR top rarity is 5★
    const analysisOpts = {
      hardPity: bt.hardPity,
      softPity: bt.softPity,
      has5050: bt.has5050,
      topRarity: 5,
    };

    if (key === 'character') {
      analysisOpts.getFeatured = getFeaturedCharactersForPull;
      analysisOpts.guaranteesAfterLoss = bt.guaranteesAfterLoss;
    }

    if (key === 'lightcone') {
      analysisOpts.getFeatured = getFeaturedLightConesForPull;
      analysisOpts.guaranteesAfterLoss = bt.guaranteesAfterLoss;
    }

    const analysis = analyzePulls(pulls, analysisOpts);

    const s = analysis.stats;
    let fieldValue = '';
    fieldValue += `Warps: **${s.total}** · 5★: **${s.r6}** (${s.r6pct}%)`;
    fieldValue += `\nAvg pity: **${s.avgPity || '—'}** · Current: **${analysis.currentPity}**/${bt.hardPity}`;

    if (bt.has5050 && s.r6 > 0) {
      fieldValue += `\n50/50: **${s.won}**W / **${s.lost}**L`;
      if (s.won + s.lost > 0) {
        const winrate = (s.won / (s.won + s.lost) * 100).toFixed(2);
        fieldValue += ` (**${winrate}%**)`;
      }
      if (analysis.nextIsGuarantee) fieldValue += `\nNext 5★: **guaranteed featured**`;
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
      topRarity: 5,
    };

    if (key === 'character') {
      analysisOpts.getFeatured = getFeaturedCharactersForPull;
      analysisOpts.guaranteesAfterLoss = bt.guaranteesAfterLoss;
    }

    if (key === 'lightcone') {
      analysisOpts.getFeatured = getFeaturedLightConesForPull;
      analysisOpts.guaranteesAfterLoss = bt.guaranteesAfterLoss;
    }

    const analysis = analyzePulls(pulls, analysisOpts);

    if (analysis.sixStars.length === 0) continue;

    const embed = new EmbedBuilder()
      .setTitle(`${bt.label} — 5★ History`)
      .setColor(0x9ca3af);

    const recent = [...analysis.sixStars].reverse().slice(0, 20);
    const lines = recent.map(p => {
      const ds = formatServerDate(p.gacha_ts);
      const result = p.result ? ` ${RESULT_LABEL[p.result]}` : '';
      return `**${p.item_name}** — #${p._pity} pity${result} (${ds})`;
    });

    embed.setDescription(lines.join('\n'));
    if (analysis.sixStars.length > 20) {
      embed.setFooter({ text: `Showing 20 of ${analysis.sixStars.length} total 5★ warps` });
    }
    embeds.push(embed);
  }

  if (embeds.length === 0) {
    embeds.push(new EmbedBuilder().setDescription('No 5★ warps found').setColor(0x5a6070));
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
    .setColor(0x9ca3af)
    .setDescription(
      `**${inserted}** new warps imported, **${skipped}** duplicates skipped\n${breakdown}`
    )
    .setFooter({ text: 'Use /stats and /history to see your data' });
}

module.exports = { buildStatsEmbed, buildHistoryEmbed, buildImportEmbed };
