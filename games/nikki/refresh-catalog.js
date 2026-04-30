const db = require('../../lib/db');
const config = require('./config');

const CATALOG_URL = 'https://pearpal-api.infoldgames.com/v1/strategy/main/suit/list';

function pickEn(multilang) {
  if (!Array.isArray(multilang)) return null;
  return multilang.find(x => x.lang === 'en')?.text || multilang[0]?.text || null;
}

/**
 * Fetch the Pearpal item/banner catalog and upsert into:
 *   - item_catalog (cloth_id -> name + rarity + slot + banner_id)
 *   - banner_schedule (one row per banner with start/end + featured cloth_ids)
 *
 * The catalog is non-user-specific. Any valid Pearpal cookie works.
 *
 * @param {{token: string, id: string}} cookie - Pearpal credentials
 * @returns {{items: number, banners: number}}
 */
async function refreshCatalog(cookie) {
  const res = await fetch(CATALOG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.pearpalClientId,
      token: cookie.token,
      openid: cookie.id,
    }),
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`Catalog fetch failed: ${json.info || 'unknown'}`);
  }
  const banners = json.data?.list || [];

  // Replace the banner schedule for nikki — catalog is the source of truth.
  const dbh = db.getDb();
  dbh.prepare(`DELETE FROM banner_schedule WHERE game = 'nikki'`).run();

  const items = [];
  let bannerCount = 0;

  for (const b of banners) {
    const bannerName = pickEn(b.card_pool_name);
    const outfitName = pickEn(b.name);
    const bannerId = String(b.card_pool_id);
    const rarity = b.level; // 4 or 5

    // Featured cloths for this banner (the items pity-relevant for /stats).
    // `cloths` arrives either as a JSON-encoded string or already as an array,
    // depending on the response.
    let cloths = b.cloths;
    if (typeof cloths === 'string') {
      try { cloths = JSON.parse(cloths); } catch { cloths = []; }
    }
    if (!Array.isArray(cloths)) cloths = [];
    const featuredIds = cloths.map(c => c.cloth_id);

    // Banner schedule entry (one per banner). Phase 2 stats logic will read this
    // to determine 50/50 wins/losses and active banners.
    db.insertScheduleEntry({
      game: 'nikki',
      bannerType: 'banner',
      startDate: new Date(b.card_start_timestamp).toISOString().slice(0, 10),
      endDate: new Date(b.card_end_timestamp).toISOString().slice(0, 10),
      name: bannerName || `Banner ${bannerId}`,
      featured: {
        banner_id: bannerId,
        rarity,
        outfit_name: outfitName,
        cloth_ids: featuredIds,
      },
    });
    bannerCount++;

    // Catalog rows for each cloth.
    for (const c of cloths) {
      items.push({
        item_id: c.cloth_id,
        name: outfitName || `Outfit ${b.suit_id}`,
        rarity,
        slot: c.display_type || null,
        banner_id: bannerId,
        extra: { banner_name: bannerName, suit_id: b.suit_id },
      });
    }
  }

  const itemCount = db.upsertCatalogItems('nikki', items);
  return { items: itemCount, banners: bannerCount };
}

module.exports = { refreshCatalog };
