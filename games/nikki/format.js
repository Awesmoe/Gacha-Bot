const { EmbedBuilder } = require('discord.js');
const db = require('../../lib/db');

const COLOR = 0xec4899;
const PERMANENT_BANNER_ID = '1';

/**
 * Build a banner_id -> { name, rarity, type, isActive, startDate } map from
 * banner_schedule. The catalog returns one row per (banner, outfit), so a
 * banner with both a 5★ and a 4★ outfit yields two rows; we collapse to one
 * entry per banner_id, taking max rarity, OR'd active flag, and earliest start.
 */
function buildBannerInfo() {
  const rows = db.getSchedule('nikki', 'banner');
  const today = new Date().toISOString().slice(0, 10);
  const info = new Map();
  for (const r of rows) {
    const bid = r.featured?.banner_id;
    if (!bid) continue;
    const rarity = r.featured.rarity || 0;
    const isActive = r.start <= today && (!r.end || today <= r.end);
    const cur = info.get(bid);
    if (!cur) {
      info.set(bid, {
        name: r.name,
        rarity,
        isActive,
        type: bid === PERMANENT_BANNER_ID ? 'permanent' : 'limited',
        startDate: r.start,
      });
    } else {
      if (rarity > cur.rarity) cur.rarity = rarity;
      if (isActive) cur.isActive = true;
      if (r.start < cur.startDate) cur.startDate = r.start;
    }
  }
  return info;
}

/**
 * Return one entry per (banner_id, outfit_name, rarity) — deduped because
 * banner re-runs share card_pool_id and would otherwise double-count outfits.
 */
function getOutfits() {
  const rows = db.getSchedule('nikki', 'banner');
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const bannerId = r.featured?.banner_id;
    const outfitName = r.featured?.outfit_name;
    const rarity = r.featured?.rarity;
    if (!bannerId || !outfitName) continue;
    const key = `${bannerId}|${outfitName}|${rarity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      bannerId,
      bannerName: r.name,
      outfitName,
      rarity,
      clothIds: (r.featured.cloth_ids || []).map(String),
    });
  }
  return out;
}

/**
 * Returns a Map<cloth_id, count> — count is needed to detect color-scheme
 * unlocks (Nikki gives the alt color scheme when every cloth piece in an
 * outfit has been pulled at least 2x).
 */
function pulledClothIdCounts(pulls) {
  const counts = new Map();
  for (const p of pulls) {
    try {
      const extra = JSON.parse(p.extra_json || '{}');
      if (extra.item_id != null) {
        const id = String(extra.item_id);
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    } catch {
      /* ignore malformed */
    }
  }
  return counts;
}

/**
 * For pulls in a category, compute per-rarity (pieces, avgPerPiece).
 * avgPerPiece = avg of `pulls_since_last_X + 1` across all events of rarity X
 * on each banner — matches Pearpal's Whim-Log "per piece" metric.
 */
function computeCategoryStats(pulls) {
  const byBanner = new Map();
  for (const p of pulls) {
    if (!byBanner.has(p.pool_id)) byBanner.set(p.pool_id, []);
    byBanner.get(p.pool_id).push(p);
  }

  const acc = { 5: { sum: 0, count: 0 }, 4: { sum: 0, count: 0 } };

  for (const ps of byBanner.values()) {
    ps.sort((a, b) => Number(a.gacha_ts) - Number(b.gacha_ts));
    for (const rarity of [5, 4]) {
      let pullsSinceLast = 0;
      for (const p of ps) {
        pullsSinceLast++;
        if (p.rarity === rarity) {
          acc[rarity].sum += pullsSinceLast;
          acc[rarity].count++;
          pullsSinceLast = 0;
        }
      }
    }
  }

  return {
    totalPulls: pulls.length,
    five: { pieces: acc[5].count, avg: acc[5].count ? acc[5].sum / acc[5].count : 0 },
    four: { pieces: acc[4].count, avg: acc[4].count ? acc[4].sum / acc[4].count : 0 },
  };
}

function buildStatsEmbed(allPulls) {
  const bannerInfo = buildBannerInfo();
  const outfits = getOutfits();
  const counts = pulledClothIdCounts(allPulls);

  const limitedBids = new Set();
  const permBids = new Set();
  for (const [bid, info] of bannerInfo.entries()) {
    if (info.type === 'permanent') permBids.add(bid);
    else limitedBids.add(bid);
  }

  const limitedPulls = allPulls.filter(p => limitedBids.has(p.pool_id));
  const permPulls = allPulls.filter(p => permBids.has(p.pool_id));

  const ls = computeCategoryStats(limitedPulls);
  const ps = computeCategoryStats(permPulls);

  // Completed limited outfits by rarity (perma intentionally not counted —
  // not part of Mide's Whim-Log layout).
  const completed = { 5: 0, 4: 0 };
  for (const o of outfits) {
    if (permBids.has(o.bannerId)) continue;
    if (o.clothIds.length === 0) continue;
    if (o.clothIds.every(id => (counts.get(id) || 0) >= 1)) {
      completed[o.rarity] = (completed[o.rarity] || 0) + 1;
    }
  }

  const fmt = n => n.toFixed(1);
  const lines = [];

  if (ls.five.pieces > 0) {
    lines.push(`**Limited 5★** — ${ls.five.pieces} pieces · ${fmt(ls.five.avg)} per piece · ${completed[5]} completed`);
  }
  if (ls.four.pieces > 0) {
    lines.push(`**Limited 4★** — ${ls.four.pieces} pieces · ${fmt(ls.four.avg)} per piece · ${completed[4]} completed`);
  }
  if (ps.five.pieces > 0) {
    lines.push(`**Permanent 5★** — ${ps.five.pieces} pieces · ${fmt(ps.five.avg)} per piece`);
  }
  if (ps.four.pieces > 0) {
    lines.push(`**Permanent 4★** — ${ps.four.pieces} pieces`);
  }

  const embed = new EmbedBuilder()
    .setTitle('📊 Pull Statistics')
    .setColor(COLOR)
    .setDescription(lines.length ? lines.join('\n') : 'No pulls found.')
    .setFooter({ text: `${allPulls.length} pulls in the last ~180 days · Infinity Nikki` });

  return [embed];
}

function buildHistoryEmbed(allPulls) {
  const bannerInfo = buildBannerInfo();
  const outfits = getOutfits();
  const counts = pulledClothIdCounts(allPulls);

  const pullsPerBanner = new Map();
  for (const p of allPulls) {
    pullsPerBanner.set(p.pool_id, (pullsPerBanner.get(p.pool_id) || 0) + 1);
  }

  const outfitsByBanner = new Map();
  for (const o of outfits) {
    if (!outfitsByBanner.has(o.bannerId)) outfitsByBanner.set(o.bannerId, []);
    outfitsByBanner.get(o.bannerId).push(o);
  }

  // Show only banners user has pulled on, newest first by start date.
  const bannersWithPulls = [...pullsPerBanner.keys()]
    .filter(bid => bannerInfo.has(bid))
    .sort((a, b) => {
      const sa = bannerInfo.get(a).startDate || '';
      const sb = bannerInfo.get(b).startDate || '';
      return sb.localeCompare(sa);
    });

  const sections = [];
  for (const bid of bannersWithPulls) {
    const info = bannerInfo.get(bid);
    const total = pullsPerBanner.get(bid) || 0;
    const header = info.type === 'permanent'
      ? `**${info.name}** _(Permanent)_ · ${total} pulls`
      : `**${info.name}** · ${total} pulls`;

    const outfitLines = [];
    const obs = (outfitsByBanner.get(bid) || []).slice().sort((a, b) => b.rarity - a.rarity);

    for (const o of obs) {
      const owned = o.clothIds.filter(id => (counts.get(id) || 0) >= 1).length;
      const colorOwned = o.clothIds.filter(id => (counts.get(id) || 0) >= 2).length;
      const tot = o.clothIds.length;
      // Hide perma outfits with zero pieces — otherwise the perma section
      // would list every standard outfit ever.
      if (info.type === 'permanent' && owned === 0) continue;
      // 🎨 marker = full color scheme unlocked (every piece pulled 2x+).
      const marker = colorOwned === tot ? ' 🎨' : '';
      outfitLines.push(`  · ${o.outfitName} (${o.rarity}★): ${owned}/${tot}${marker}`);
    }

    sections.push([header, ...outfitLines].join('\n'));
  }

  const embed = new EmbedBuilder()
    .setTitle('📜 Per-Banner History')
    .setColor(COLOR);

  if (sections.length === 0) {
    embed.setDescription('No pulls found.');
    embed.setFooter({ text: 'Infinity Nikki' });
    return [embed];
  }

  // Discord embed description cap is 4096 chars.
  let body = sections.join('\n\n');
  let truncated = 0;
  if (body.length > 4000) {
    const kept = [];
    let len = 0;
    for (const s of sections) {
      const addLen = kept.length === 0 ? s.length : len + 2 + s.length;
      if (addLen > 4000) break;
      kept.push(s);
      len = addLen;
    }
    truncated = sections.length - kept.length;
    body = kept.join('\n\n') + (truncated ? `\n\n_… ${truncated} more banner(s) truncated_` : '');
  }

  embed.setDescription(body);
  embed.setFooter({ text: `${bannersWithPulls.length} banners pulled on · Infinity Nikki` });
  return [embed];
}

function buildImportEmbed(inserted, skipped, totalByType) {
  const total = Object.values(totalByType).reduce((a, b) => a + (b || 0), 0);
  return new EmbedBuilder()
    .setTitle('Import Complete')
    .setColor(COLOR)
    .setDescription(
      `**${inserted}** new pulls imported, **${skipped}** duplicates skipped\n` +
      `Total fetched: **${total}**`
    )
    .setFooter({ text: 'Use /stats and /history to see your data · Infinity Nikki' });
}

module.exports = { buildImportEmbed, buildStatsEmbed, buildHistoryEmbed };
