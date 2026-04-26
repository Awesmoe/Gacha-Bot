const { EmbedBuilder } = require('discord.js');
const { analyzePulls } = require('../../lib/analytics');
const config = require('./config');
const db = require('../../lib/db');

const RESULT_LABEL = { won: '✅ Won', lost: '❌ Lost', guaranteed: '🔒 Guaranteed', unknown: '❓' };

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

function getStoredGachaId(pull) {
  if (!pull.extra_json) return null;
  if (typeof pull.extra_json === 'object') return pull.extra_json.gacha_id || null;

  try {
    const extra = JSON.parse(pull.extra_json);
    return extra?.gacha_id || null;
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

function getFeaturedForPullFromSchedule(pull, schedule) {
  const utcPlus8 = new Date(Number(pull.gacha_ts) + 8 * 3600000);
  const pullDate = utcPlus8.toISOString().slice(0, 10);
  const allFeatured = new Set();

  for (const banner of schedule) {
    if (!banner.end) continue;
    if (pullDate >= banner.start && pullDate < banner.end) {
      for (const character of banner.featured) {
        allFeatured.add(character);
      }
    }
  }

  return allFeatured.size > 0 ? [...allFeatured] : null;
}

function getFeaturedCharactersForPull(pull) {
  return getFeaturedFromGachaId(pull, 'character')
    || getFeaturedForPullFromSchedule(pull, db.getSchedule('starrail', 'character'));
}

function getFeaturedLightConesForPull(pull) {
  return getFeaturedFromGachaId(pull, 'lightcone')
    || getFeaturedForPullFromSchedule(pull, db.getSchedule('starrail', 'lightcone'));
}

/**
 * Build stats embeds for HSR.
 * HSR uses 5★ as max rarity (not 6★ like Endfield).
 */
function buildStatsEmbed(allPulls, bannerMap) {
  const grouped = groupPullsByType(allPulls);

  const total = allPulls.length;
  const overview = new EmbedBuilder()
    .setTitle('📊 Warp Statistics')
    .setColor(0x7b68ee)
    .setDescription(`**${total}** total warps across all banners`)
    .setFooter({ text: 'Honkai: Star Rail' });

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

/**
 * Build 5★ history embeds.
 */
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
      .setColor(bt.has5050 ? 0xffd700 : 0x7b68ee);

    const recent = [...analysis.sixStars].reverse().slice(0, 20);
    const lines = recent.map(p => {
      const date = new Date(Number(p.gacha_ts));
      const ds = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
    .setColor(0x22c55e)
    .setDescription(
      `**${inserted}** new warps imported, **${skipped}** duplicates skipped\n${breakdown}`
    )
    .setFooter({ text: 'Use /stats to see your warp statistics' });
}

module.exports = { buildStatsEmbed, buildHistoryEmbed, buildImportEmbed };
