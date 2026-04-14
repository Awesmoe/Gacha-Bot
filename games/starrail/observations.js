const fs = require('fs');
const path = require('path');

const db = require('../../lib/db');
const gachaIds = require('./gacha-ids');

const OBSERVATION_PATH = path.join(__dirname, '..', '..', 'HSR_UNKNOWN_GACHA_IDS.txt');

function getFeaturedForTime(time, schedule) {
  const utcPlus8 = new Date(new Date(time).getTime() + 8 * 3600000);
  const pullDate = utcPlus8.toISOString().slice(0, 10);
  const featured = new Set();

  for (const banner of schedule) {
    if (!banner.end) continue;
    if (pullDate >= banner.start && pullDate < banner.end) {
      for (const item of banner.featured) {
        featured.add(item);
      }
    }
  }

  return [...featured];
}

function inferFeatured(record) {
  if (record.gacha_type === '11') {
    return getFeaturedForTime(record.time, db.getSchedule('starrail', 'character'));
  }

  if (record.gacha_type === '12') {
    return getFeaturedForTime(record.time, db.getSchedule('starrail', 'lightcone'));
  }

  return [];
}

function chooseRepresentativeRecord(records) {
  const topRarity = records.find(record => record.rank_type === '5');
  return topRarity || records[0] || null;
}

function getKnownIds() {
  return new Set(Object.keys(gachaIds));
}

function getAlreadyLoggedIds() {
  if (!fs.existsSync(OBSERVATION_PATH)) return new Set();

  const content = fs.readFileSync(OBSERVATION_PATH, 'utf8');
  const ids = new Set();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/gacha_id=([^\s]+)/);
    if (match) ids.add(match[1]);
  }
  return ids;
}

function collectUnknownObservations(raw) {
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

  const knownIds = getKnownIds();
  const alreadyLogged = getAlreadyLoggedIds();
  const observations = [];

  for (const records of buckets.values()) {
    const representative = chooseRepresentativeRecord(records);
    if (!representative) continue;
    if (knownIds.has(representative.gacha_id)) continue;
    if (alreadyLogged.has(representative.gacha_id)) continue;

    const inferred = inferFeatured(representative);
    observations.push({
      gachaId: representative.gacha_id,
      gachaType: representative.gacha_type,
      firstSeen: representative.time,
      inferred,
    });
  }

  observations.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
  return observations;
}

function appendUnknownObservations(raw, onProgress) {
  const observations = collectUnknownObservations(raw);
  if (observations.length === 0) return [];

  const lines = observations.map(observation => {
    const inferredText = observation.inferred.length > 0
      ? observation.inferred.join(', ')
      : 'unknown';
    return `[${new Date().toISOString()}] gacha_id=${observation.gachaId} gacha_type=${observation.gachaType} first_seen="${observation.firstSeen}" inferred_featured="${inferredText}"`;
  });

  fs.appendFileSync(OBSERVATION_PATH, `${lines.join('\n')}\n`, 'utf8');

  if (onProgress) {
    onProgress(`Observed ${observations.length} unknown HSR gacha_id(s)`);
  }

  return observations;
}

module.exports = {
  OBSERVATION_PATH,
  appendUnknownObservations,
};
