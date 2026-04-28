const snappy = require('snappyjs');
const db = require('../../lib/db');
const { refreshCatalog } = require('./refresh-catalog');

const VERIFY_URL = 'https://x6en-clickhouse.infoldgames.com/v1/tlog/verify';
const QUERY_URL  = 'https://x6en-clickhouse.infoldgames.com/v1/tlog/query';
const LIFETIME_URL = 'https://pearpal-api.infoldgames.com/v1/strategy/user/note/book/info';
const CLIENT_ID = 1116;
const DELAY = 500;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseCookieJson(raw) {
  let cookie;
  try {
    cookie = JSON.parse(raw);
  } catch {
    throw new Error('Token must be the JSON object printed by the console one-liner — see /help.');
  }
  const { roleid, token, id } = cookie;
  if (!roleid || !token || !id) {
    throw new Error('JSON must contain roleid, token, and id.');
  }
  return { roleid, token, id };
}

async function verifyCookie({ roleid, token, id }) {
  const params = new URLSearchParams({ token, roleid, id });
  const res = await fetch(`${VERIFY_URL}?${params}`);
  const json = await res.json();
  if (json.code !== 0 || !json.data) {
    throw new Error(`Verify failed: ${json.info || 'unknown error'}`);
  }
  return json.data;
}

async function queryBannerPage(jwt, bannerId, page) {
  const params = new URLSearchParams({
    page: String(page),
    args: String(bannerId),
    name: 'gacha',
    etime: Math.floor(Date.now() / 1000).toString(),
  });
  const res = await fetch(`${QUERY_URL}?${params}`, {
    headers: { 'X-Authority': jwt },
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`Query failed for banner ${bannerId} page ${page}: ${json.info}`);
  }
  return json.data;
}

async function fetchAllPagesForBanner(jwt, bannerId) {
  const all = [];
  let page = 1;
  while (true) {
    const data = await queryBannerPage(jwt, bannerId, page);
    const datas = data?.datas || [];
    all.push(...datas);
    if (data?.end || datas.length === 0) break;
    page++;
    await sleep(DELAY);
  }
  return all;
}

/**
 * Main import entrypoint.
 * @param {string} rawToken - JSON string of {roleid, token, id} pasted by the user
 * @param {string} _serverId - unused for Nikki
 * @param {Function} [onProgress]
 */
async function fetchAllPulls(rawToken, _serverId, onProgress) {
  const log = onProgress || (() => {});
  const cookie = parseCookieJson(rawToken);

  log('Verifying Pearpal token...');
  const jwt = await verifyCookie(cookie);
  log('Token verified.');

  // Refresh catalog if stale (>24h). Catalog is non-user-specific.
  const lastRefresh = db.getCatalogLastRefresh('nikki');
  if (!lastRefresh || (Date.now() - lastRefresh) > CATALOG_TTL_MS) {
    log('Refreshing item catalog...');
    const { items, banners } = await refreshCatalog(cookie);
    log(`Catalog refreshed: ${items} items across ${banners} banners.`);
  } else {
    log('Catalog is fresh, skipping refresh.');
  }

  // Get unique banner_ids from the schedule. The catalog returns one row per
  // banner *run* (re-runs share card_pool_id), so we dedupe before fetching.
  const schedule = db.getSchedule('nikki', 'banner');
  const bannerIds = [...new Set(schedule.map(s => s.featured?.banner_id).filter(Boolean))];
  log(`Fetching pulls across ${bannerIds.length} unique banners (${schedule.length} schedule rows incl. re-runs)...`);

  const allPulls = [];
  for (let i = 0; i < bannerIds.length; i++) {
    const bid = bannerIds[i];
    const pulls = await fetchAllPagesForBanner(jwt, bid);
    if (pulls.length > 0) {
      log(`  banner ${bid}: ${pulls.length} pulls`);
      // Tag each pull with its banner_id so normalizePulls can look it up.
      for (const p of pulls) allPulls.push({ ts: p[0], item_id: p[1], banner_id: bid });
    }
    if (i < bannerIds.length - 1) await sleep(DELAY);
  }

  log(`Total: ${allPulls.length} pulls.`);

  log('Fetching lifetime totals...');
  const { events: lifetimeEvents, summary: lifetimeSummary } = await fetchLifetimeEvents(cookie);
  log(`Lifetime: ${lifetimeEvents.length} 4★/5★ events; ${lifetimeSummary.periodic_draw_num}+${lifetimeSummary.permanent_draw_num} pulls.`);

  return { pulls: allPulls, lifetimeEvents, lifetimeSummary };
}

/**
 * Fetch lifetime 4★/5★ event aggregates from Pearpal's note/book/info endpoint.
 * Response is Snappy-compressed JSON: Record<bannerId, PearpalTrackerItem[]>.
 * Each item has card_pool_id, pool_cnt, result (cloth_id), times_from_last_*_stars, rarity.
 * 3★ events are not included. Items only appear after 4★/5★ pulls; pool_cnt is the
 * global pull index regardless of rarity.
 */
async function fetchLifetimeEvents(cookie) {
  const res = await fetch(LIFETIME_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      token: cookie.token,
      openid: cookie.id,
    }),
  });
  const buf = await res.arrayBuffer();

  // Auth/server errors come back as plain JSON, not Snappy. Try snappy first; if
  // that throws, parse buf as JSON to surface the actual error.
  let json;
  try {
    const decoded = snappy.uncompress(new Uint8Array(buf));
    json = JSON.parse(new TextDecoder().decode(decoded));
  } catch (snappyErr) {
    const text = new TextDecoder().decode(buf);
    try {
      const errJson = JSON.parse(text);
      throw new Error(`Lifetime fetch failed: ${errJson.info || errJson.message || text.slice(0, 200)}`);
    } catch (parseErr) {
      if (parseErr.message.startsWith('Lifetime fetch failed:')) throw parseErr;
      throw new Error(`Lifetime fetch returned ${buf.byteLength}b non-snappy non-JSON: ${text.slice(0, 100)}`);
    }
  }

  // Response shape: { flag, info_from_self, info_from_gm }.
  // Each is a Record<bannerId, PearpalTrackerItem[]>. We ingest both and tag
  // them so we can decide downstream whether to include gm-granted events.
  const sources = [];
  if (json && typeof json === 'object') {
    if (json.info_from_self && typeof json.info_from_self === 'object') {
      sources.push(['self', json.info_from_self]);
    }
    if (json.info_from_gm && typeof json.info_from_gm === 'object') {
      sources.push(['gm', json.info_from_gm]);
    }
    // Older/alternate shapes — fall back to the raw map if neither key present.
    if (sources.length === 0 && !json.info_from_self && !json.info_from_gm) {
      const candidate = (json.data && typeof json.data === 'object') ? json.data : json;
      sources.push(['self', candidate]);
    }
  }

  // Walk every array we find under each source (the relevant data lives in
  // info_from_self.gacha_list — every other array is profile/state data with
  // no rarity field, which our filter below skips).
  const events = [];
  for (const [source, map] of sources) {
    for (const [outerKey, items] of Object.entries(map || {})) {
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const rarity = parseInt(it.rarity, 10);
        if (rarity !== 4 && rarity !== 5) continue;
        const pulls_to_obtain = rarity === 5
          ? (it.times_from_last_five_stars ?? 0) + 1
          : (it.times_from_last_four_stars ?? 0) + 1;
        // Each event carries its own card_pool_id; the outer key (gacha_list)
        // is a category name, not a banner id.
        const bannerId = it.card_pool_id != null
          ? String(it.card_pool_id)
          : String(outerKey);
        events.push({
          banner_id: bannerId,
          pool_cnt: it.pool_cnt ?? 0,
          item_id: String(it.result),
          rarity,
          pulls_to_obtain,
          source,
        });
      }
    }
  }

  // Lifetime pull totals — limited (periodic) + permanent. These two ints in
  // info_from_gm match Pearpal's displayed totals exactly, including the 3★
  // tail after the last 4★/5★ that's invisible to event-based math.
  const summary = {
    periodic_draw_num: json?.info_from_gm?.periodic_draw_num ?? 0,
    permanent_draw_num: json?.info_from_gm?.permanent_draw_num ?? 0,
  };

  return { events, summary };
}

/**
 * Hook called by /import after the main pulls are inserted. Persists the lifetime
 * snapshot (full replace, since the endpoint returns the complete list each time).
 */
function persistExtras(discordId, raw) {
  if (Array.isArray(raw.lifetimeEvents)) {
    db.replaceNikkiLifetimeEvents(discordId, raw.lifetimeEvents);
  }
  if (raw.lifetimeSummary && typeof raw.lifetimeSummary === 'object') {
    db.replaceNikkiLifetimeSummary(discordId, raw.lifetimeSummary);
  }
}

/**
 * Convert raw API records into our DB pull shape.
 * Resolves item_id -> name + rarity via item_catalog. Items not in the catalog
 * are 3★ (catalog only contains 4★ and 5★).
 *
 * seq_id format: `${banner_id}-${ts}-${item_id}-${idx}` where idx is the
 * position of this item_id within a same-timestamp group on this banner.
 * Including item_id in the key means re-feeding the same batch produces the
 * same seq_ids and INSERT OR IGNORE catches it.
 */
function normalizePulls(raw) {
  const out = [];

  // Build banner_id -> banner_name map from the schedule (covers 3★ pulls
  // where the item itself isn't in the catalog).
  const schedule = db.getSchedule('nikki', 'banner');
  const bannerNames = new Map();
  for (const s of schedule) {
    const bid = s.featured?.banner_id;
    if (bid && s.name) bannerNames.set(bid, s.name);
  }

  // Group by banner so we can compute idx-within-(item,ts) per banner.
  const byBanner = new Map();
  for (const p of raw.pulls || []) {
    if (!byBanner.has(p.banner_id)) byBanner.set(p.banner_id, []);
    byBanner.get(p.banner_id).push(p);
  }

  for (const [bannerId, pulls] of byBanner.entries()) {
    const itemTsCount = new Map();
    for (const p of pulls) {
      const key = `${p.item_id}|${p.ts}`;
      const idx = itemTsCount.get(key) || 0;
      itemTsCount.set(key, idx + 1);

      const cat = db.getCatalogItem('nikki', p.item_id);
      const item_name = cat?.name || `3★ Item ${p.item_id}`;
      const rarity = cat?.rarity || 3; // catalog only holds 4★/5★; rest is 3★
      const banner_name = bannerNames.get(bannerId) || `Banner ${bannerId}`;

      // Convert "2026-04-27 06:32:41" -> ms epoch (UTC+8 server time).
      const ts_ms = Date.parse(p.ts.replace(' ', 'T') + '+08:00');

      out.push({
        seq_id: `${bannerId}-${p.ts}-${p.item_id}-${idx}`,
        is_weapon: false,
        pool_id: String(bannerId),
        pool_name: banner_name,
        item_name,
        rarity,
        gacha_ts: String(ts_ms),
        extra_json: { item_id: p.item_id, slot: cat?.slot },
      });
    }
  }

  return out;
}

module.exports = { fetchAllPulls, normalizePulls, persistExtras };
