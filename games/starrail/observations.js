const db = require('../../lib/db');

const GACHA_TYPE_TO_BANNER_TYPE = { '11': 'character', '12': 'lightcone' };

function getFeaturedForTime(time, schedule) {
  const utcPlus8 = new Date(new Date(time).getTime() + 8 * 3600000);
  const pullDate = utcPlus8.toISOString().slice(0, 10);
  const featured = new Set();

  for (const banner of schedule) {
    if (!banner.end) continue;
    if (pullDate >= banner.start && pullDate < banner.end) {
      for (const item of banner.featured) featured.add(item);
    }
  }

  return [...featured];
}

function inferFeatured(record) {
  const bannerType = GACHA_TYPE_TO_BANNER_TYPE[record.gacha_type];
  if (!bannerType) return [];
  return getFeaturedForTime(record.time, db.getSchedule('starrail', bannerType));
}

function chooseRepresentativeRecord(records) {
  return records.find(r => r.rank_type === '5') || records[0] || null;
}

function appendUnknownObservations(raw, onProgress) {
  const buckets = new Map();

  for (const records of Object.values(raw)) {
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (!record.gacha_id) continue;
      const key = `${record.gacha_type}:${record.gacha_id}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(record);
    }
  }

  let added = 0;
  for (const records of buckets.values()) {
    const rep = chooseRepresentativeRecord(records);
    if (!rep) continue;
    if (db.getGachaIdMap(rep.gacha_id)) continue;

    const bannerType = GACHA_TYPE_TO_BANNER_TYPE[rep.gacha_type];
    if (!bannerType) continue;

    const inferred = inferFeatured(rep);
    db.upsertGachaIdMap(rep.gacha_id, bannerType, inferred);
    added++;
  }

  if (added > 0 && onProgress) onProgress(`Observed ${added} new HSR gacha_id(s), added to DB`);
  return added;
}

module.exports = { appendUnknownObservations };
