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
 * Returns a Map<cloth_id, count> from per-pull data — used for the pulls-based
 * (180-day) fallback when no lifetime snapshot exists for the user.
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
 * Same shape, but built from lifetime events. Each event = one cloth piece
 * pulled at that rarity. Counts let us detect color-scheme unlocks across the
 * full lifetime, not just the 180-day window.
 */
function lifetimeClothIdCounts(events) {
  const counts = new Map();
  for (const e of events) {
    const id = String(e.item_id);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

/**
 * For pulls in a category, compute per-rarity (pieces, avgPerPiece).
 * avgPerPiece = avg of `pulls_since_last_X + 1` across all events of rarity X
 * on each banner — matches Pearpal's Whim-Log "per piece" metric.
 */
function computeCategoryStatsFromPulls(pulls) {
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

/**
 * The lifetime endpoint's gacha_list includes upgrade/evolution events as
 * extra entries on the same cloth_id (a piece can be summoned at most 2x in
 * Nikki, so any 3rd+ occurrence is the in-game "upgrade" action firing a new
 * gacha_list event). To reconstruct real summon counts we sort by
 * (banner, pool_cnt) and keep only the first 2 occurrences per cloth_id.
 *
 * Empirically reproduces Pearpal's Whim-Log "pieces" + "per piece" totals
 * exactly for limited 5★, limited 4★, and perma 5★. Perma 4★ still under-
 * counts vs Pearpal's display (cause unknown — likely a display quirk or
 * undocumented backfill on Pearpal's side).
 */
function applyCapAtTwo(events) {
  const sorted = [...events].sort((a, b) => {
    if (a.banner_id !== b.banner_id) return a.banner_id < b.banner_id ? -1 : 1;
    return a.pool_cnt - b.pool_cnt;
  });
  const seen = new Map();
  const out = [];
  for (const e of sorted) {
    const cid = String(e.item_id);
    const n = seen.get(cid) || 0;
    if (n < 2) {
      out.push(e);
      seen.set(cid, n + 1);
    }
  }
  return out;
}

/**
 * Per-rarity pieces + avg-per-piece. Uses cap-at-2 events for piece counts and
 * pulls_to_obtain (so upgrade events don't inflate the piece count or skew the
 * pity average).
 */
function computeCategoryStatsFromLifetime(events) {
  const realPulls = applyCapAtTwo(events);
  const acc = { 5: { sum: 0, count: 0 }, 4: { sum: 0, count: 0 } };
  for (const e of realPulls) {
    if (e.rarity === 5 || e.rarity === 4) {
      acc[e.rarity].sum += e.pulls_to_obtain;
      acc[e.rarity].count++;
    }
  }
  return {
    five: { pieces: acc[5].count, avg: acc[5].count ? acc[5].sum / acc[5].count : 0 },
    four: { pieces: acc[4].count, avg: acc[4].count ? acc[4].sum / acc[4].count : 0 },
  };
}

function countCompleted(outfits, bannerInfo, counts, type, rarity) {
  let n = 0;
  for (const o of outfits) {
    const info = bannerInfo.get(o.bannerId);
    if (!info || info.type !== type) continue;
    if (o.rarity !== rarity) continue;
    if (o.clothIds.length === 0) continue;
    if (o.clothIds.every(id => (counts.get(id) || 0) >= 1)) n++;
  }
  return n;
}

function buildStatsEmbed(allPulls, _bannerMap, discordId) {
  const lifetimeEvents = discordId ? db.getNikkiLifetimeEvents(discordId) : [];
  const useLifetime = lifetimeEvents.length > 0;

  const bannerInfo = buildBannerInfo();
  const outfits = getOutfits();

  const limitedBids = new Set();
  const permBids = new Set();
  for (const [bid, info] of bannerInfo.entries()) {
    if (info.type === 'permanent') permBids.add(bid);
    else limitedBids.add(bid);
  }

  let ls, ps, totalPulls, counts, summary;
  if (useLifetime) {
    const limitedEvents = lifetimeEvents.filter(e => limitedBids.has(e.banner_id));
    const permEvents = lifetimeEvents.filter(e => permBids.has(e.banner_id));
    ls = computeCategoryStatsFromLifetime(limitedEvents);
    ps = computeCategoryStatsFromLifetime(permEvents);
    summary = db.getNikkiLifetimeSummary(discordId);
    totalPulls = (summary?.periodic_draw_num ?? 0) + (summary?.permanent_draw_num ?? 0);
    counts = lifetimeClothIdCounts(lifetimeEvents);
  } else {
    const limitedPulls = allPulls.filter(p => limitedBids.has(p.pool_id));
    const permPulls = allPulls.filter(p => permBids.has(p.pool_id));
    ls = computeCategoryStatsFromPulls(limitedPulls);
    ps = computeCategoryStatsFromPulls(permPulls);
    totalPulls = allPulls.length;
    counts = pulledClothIdCounts(allPulls);
  }

  const completedL5 = countCompleted(outfits, bannerInfo, counts, 'limited', 5);
  const completedL4 = countCompleted(outfits, bannerInfo, counts, 'limited', 4);

  const fmt = n => n.toFixed(1);
  const num = n => n.toLocaleString('en-US');
  const lines = [];

  if (summary) {
    const hours = Math.round((summary.total_play_time || 0) / 3600);
    lines.push(`**${num(summary.login_days || 0)}** days logged in · **${num(hours)}h** played`);
    lines.push(
      `**${num(totalPulls)}** total resonances · Limited **${num(summary.periodic_draw_num || 0)}** · Permanent **${num(summary.permanent_draw_num || 0)}**`
    );
    lines.push(`**${num(summary.cloth_num || 0)}** clothes · **${num(summary.suits_num || 0)}** outfits · **${num(summary.momo_num || 0)}** Momo outfits`);
    lines.push('');
  }

  if (ls.five.pieces > 0) {
    lines.push(`**Limited 5★** — ${ls.five.pieces} pieces · ${fmt(ls.five.avg)} per piece · ${completedL5} completed`);
  }
  if (ls.four.pieces > 0) {
    lines.push(`**Limited 4★** — ${ls.four.pieces} pieces · ${fmt(ls.four.avg)} per piece · ${completedL4} completed`);
  }
  if (ps.five.pieces > 0) {
    lines.push(`**Permanent 5★** — ${ps.five.pieces} pieces · ${fmt(ps.five.avg)} per piece`);
  }
  if (ps.four.pieces > 0) {
    lines.push(`**Permanent 4★** — ${ps.four.pieces} pieces`);
  }

  const footerScope = useLifetime
    ? 'lifetime'
    : `${totalPulls} pulls in the last ~180 days`;

  const embed = new EmbedBuilder()
    .setTitle('📊 Pull Statistics')
    .setColor(COLOR)
    .setDescription(lines.length ? lines.join('\n') : 'No pulls found.')
    .setFooter({ text: `Infinity Nikki · ${footerScope}` });

  return [embed];
}

function buildHistoryEmbed(allPulls, _bannerMap, discordId) {
  const lifetimeEvents = discordId ? db.getNikkiLifetimeEvents(discordId) : [];
  const useLifetime = lifetimeEvents.length > 0;

  const bannerInfo = buildBannerInfo();
  const outfits = getOutfits();

  // Per-banner pull totals + cloth_id counts come from whichever source is
  // available. Lifetime is preferred for accuracy; pulls is the 180-day fallback.
  const pullsPerBanner = new Map();
  let counts;
  if (useLifetime) {
    const maxPoolCnt = new Map();
    for (const e of lifetimeEvents) {
      const cur = maxPoolCnt.get(e.banner_id);
      if (cur == null || e.pool_cnt > cur) maxPoolCnt.set(e.banner_id, e.pool_cnt);
    }
    for (const [bid, mx] of maxPoolCnt.entries()) pullsPerBanner.set(bid, mx + 1);
    counts = lifetimeClothIdCounts(lifetimeEvents);
  } else {
    for (const p of allPulls) {
      pullsPerBanner.set(p.pool_id, (pullsPerBanner.get(p.pool_id) || 0) + 1);
    }
    counts = pulledClothIdCounts(allPulls);
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

  const footerScope = useLifetime ? 'lifetime' : 'last ~180 days';

  if (sections.length === 0) {
    embed.setDescription('No pulls found.');
    embed.setFooter({ text: `Infinity Nikki · ${footerScope}` });
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
  embed.setFooter({ text: `${bannersWithPulls.length} banners pulled on · Infinity Nikki · ${footerScope}` });
  return [embed];
}

function buildImportEmbed(inserted, skipped, totalByType) {
  const pullCount = totalByType.pulls || 0;
  const lifetimeCount = totalByType.lifetimeEvents || 0;

  const desc = [
    `**${inserted}** new pulls imported, **${skipped}** duplicates skipped`,
    `Total fetched: **${pullCount}** pulls (last ~180 days)`,
  ];
  if (lifetimeCount > 0) {
    desc.push(`Lifetime snapshot refreshed: **${lifetimeCount}** 4★/5★ events`);
  }

  return new EmbedBuilder()
    .setTitle('Import Complete')
    .setColor(COLOR)
    .setDescription(desc.join('\n'))
    .setFooter({ text: 'Use /stats and /history to see your data · Infinity Nikki' });
}

module.exports = { buildImportEmbed, buildStatsEmbed, buildHistoryEmbed };
