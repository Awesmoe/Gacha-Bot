const db = require('../../lib/db');
const { refreshCatalog } = require('./refresh-catalog');

const VERIFY_URL = 'https://x6en-clickhouse.infoldgames.com/v1/tlog/verify';
const QUERY_URL  = 'https://x6en-clickhouse.infoldgames.com/v1/tlog/query';
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
  return { pulls: allPulls };
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

module.exports = { fetchAllPulls, normalizePulls };
