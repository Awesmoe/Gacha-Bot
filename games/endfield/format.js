const { EmbedBuilder } = require('discord.js');
const { analyzePulls, groupPullsByType } = require('../../lib/analytics');
const db = require('../../lib/db');
const config = require('./config');

const RESULT_LABEL = { won: '✅ Won', lost: '❌ Lost', guarantee: '🔒 Guarantee', guaranteed: '🔒 Guaranteed', unknown: '❓ Unknown' };

function buildStatsEmbed(allPulls, bannerMap, discordId) {
  const grouped = groupPullsByType(allPulls, config);

  const embeds = [];

  // Overview embed
  const total = allPulls.length;
  const overview = new EmbedBuilder()
    .setTitle('📊 Endfield Statistics')
    .setColor(0xdc2626)
    .setDescription(`**${total}** total pulls across all banners`)
    .setFooter({ text: 'Arknights: Endfield' });

  db.applyLastImportTimestamp(overview, discordId, 'endfield');

  // Per banner type
  for (const [key, bt] of Object.entries(config.bannerTypes)) {
    const pulls = grouped[key];
    if (!pulls || pulls.length === 0) continue;

    const analysis = analyzePulls(pulls, {
      hardPity: bt.hardPity,
      softPity: bt.softPity,
      has5050: bt.has5050,
      guaranteesAfterLoss: bt.guaranteesAfterLoss,
      bannerMap,
    });

    const s = analysis.stats;
    let fieldValue = '';
    fieldValue += `Pulls: **${s.total}** · 6★: **${s.r6}** (${s.r6pct}%)`;
    fieldValue += `\nAvg pity: **${s.avgPity || '—'}** · Current: **${analysis.currentPity}**/${bt.hardPity}`;
    fieldValue += `\n5★ pity: **${analysis.fiveStarPity}**/10`;

    if (bt.has5050 && s.r6 > 0) {
      const oddsLabel = bt.isWeapon ? '25/75' : '50/50';
      fieldValue += `\n${oddsLabel}: **${s.won}**W / **${s.lost}**L`;
      if (s.won + s.lost > 0) {
        const winrate = (s.won / (s.won + s.lost) * 100).toFixed(2);
        fieldValue += ` (**${winrate}%**)`;
      }
      if (s.guaranteed > 0) fieldValue += ` · **${s.guaranteed}**G`;
      if (bt.guaranteesAfterLoss && analysis.nextIsGuarantee) fieldValue += `\nNext 6★: **guaranteed featured**`;
    }

    overview.addFields({ name: `${bt.label}`, value: fieldValue, inline: true });
  }

  embeds.push(overview);
  return embeds;
}

function buildHistoryEmbed(allPulls, bannerMap) {
  const grouped = groupPullsByType(allPulls, config);

  const embeds = [];

  for (const [key, bt] of Object.entries(config.bannerTypes)) {
    const pulls = grouped[key];
    if (!pulls || pulls.length === 0) continue;

    const analysis = analyzePulls(pulls, {
      hardPity: bt.hardPity,
      softPity: bt.softPity,
      has5050: bt.has5050,
      guaranteesAfterLoss: bt.guaranteesAfterLoss,
      bannerMap,
    });

    if (analysis.sixStars.length === 0) continue;

    const embed = new EmbedBuilder()
      .setTitle(`${bt.label} — 6★ History`)
      .setColor(0xdc2626);

    // Show most recent first, cap at 20
    const recent = [...analysis.sixStars].reverse().slice(0, 20);
    const lines = recent.map(p => {
      const date = new Date(Number(p.gacha_ts));
      const ds = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const result = p.result ? ` ${RESULT_LABEL[p.result]}` : '';
      const banner = p.pool_name ? ` · _${p.pool_name}_` : '';
      const bannerCount = bt.hasSpark && p._bannerPull != null ? ` · banner #${p._bannerPull}` : '';
      return `**${p.item_name}** — pity #${p._pity}${bannerCount}${result}${banner} (${ds})`;
    });

    embed.setDescription(lines.join('\n'));

    if (analysis.sixStars.length > 20) {
      embed.setFooter({ text: `Showing 20 of ${analysis.sixStars.length} total 6★ pulls` });
    }

    embeds.push(embed);
  }

  if (embeds.length === 0) {
    embeds.push(new EmbedBuilder()
      .setDescription('No 6★ pulls found')
      .setColor(0x5a6070));
  }

  return embeds;
}

function buildImportEmbed(inserted, skipped, totalByType) {
  return new EmbedBuilder()
    .setTitle('✅ Import Complete')
    .setColor(0xdc2626)
    .setDescription(
      `**${inserted}** new pulls imported, **${skipped}** duplicates skipped\n` +
      `Characters: **${totalByType.characters ?? 0}** · Weapons: **${totalByType.weapons ?? 0}**`
    )
    .setFooter({ text: 'Use /stats and /history to see your data' });
}

module.exports = { buildStatsEmbed, buildHistoryEmbed, buildImportEmbed };
