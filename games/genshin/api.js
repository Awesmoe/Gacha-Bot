const config = require('./config');

const API_BASE = 'https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog';
const DELAY = 300; // ms between requests

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch wish records for a specific gacha_type.
 */
async function fetchGachaType(authkey, gachaType) {
  const records = [];
  let endId = '0';

  while (true) {
    const url = `${API_BASE}?authkey_ver=1&sign_type=2&auth_appid=webview_gacha` +
      `&lang=en&game_biz=hk4e_global&authkey=${authkey}&gacha_type=${gachaType}&page=1&size=20&end_id=${endId}`;

    console.log(`[Genshin API] gacha_type=${gachaType} end_id=${endId} records_so_far=${records.length}`);

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!resp.ok) {
      throw new Error(`API returned ${resp.status}: ${resp.statusText}`);
    }

    const json = await resp.json();

    if (json.retcode !== 0) {
      throw new Error(`API error (code ${json.retcode}): ${json.message || 'unknown'}`);
    }

    const list = json.data?.list || [];
    if (list.length === 0) break;

    records.push(...list);
    endId = list[list.length - 1].id;
    await sleep(DELAY);
  }

  return records;
}

/**
 * Fetch all wish records across all banner types.
 * Character event wishes (gacha_type 301 and 400) are combined into one array.
 */
async function fetchAllPulls(authkey, _serverId, onProgress) {
  const log = onProgress || (() => {});
  const result = {};

  // Character event: fetch both gacha_type 301 and 400, combine
  log('Fetching Character Event wishes (part 1)...');
  const char1 = await fetchGachaType(authkey, '301');
  log(`Found ${char1.length} Character Event wishes (type 301)`);

  log('Fetching Character Event wishes (part 2)...');
  const char2 = await fetchGachaType(authkey, '400');
  log(`Found ${char2.length} Character Event wishes (type 400)`);

  // Combine and sort by id ascending (chronological)
  result.character = [...char1, ...char2].sort((a, b) =>
    BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0
  );
  log(`Combined: ${result.character.length} Character Event wishes`);

  log('Fetching Weapon Event wishes...');
  result.weapon = await fetchGachaType(authkey, '302');
  log(`Found ${result.weapon.length} Weapon Event wishes`);

  log('Fetching Standard wishes...');
  result.standard = await fetchGachaType(authkey, '200');
  log(`Found ${result.standard.length} Standard wishes`);

  log('Fetching Beginner wishes...');
  result.beginner = await fetchGachaType(authkey, '100');
  log(`Found ${result.beginner.length} Beginner wishes`);

  return result;
}

// HoYo `time` is server wall-clock (UTC+8). Parsing without an explicit offset
// would interpret it as the host's local timezone, which on a Pi running UTC
// shifts pulls by 8h and misclassifies banner-boundary 50/50s.
function parseServerTimeToEpochMs(time) {
  return Date.parse(time.replace(' ', 'T') + '+08:00');
}

/**
 * Normalize raw Genshin API data into the shared DB format.
 * Genshin items: { uid, gacha_type, item_id, count, time, name, lang, item_type, rank_type, id }
 */
function normalizePulls(raw) {
  const pulls = [];

  for (const [bannerKey, records] of Object.entries(raw)) {
    const bt = config.bannerTypes[bannerKey];
    if (!bt) continue;

    for (const r of records) {
      pulls.push({
        seq_id: r.id,
        is_weapon: r.item_type === 'Weapon',
        pool_id: r.gacha_type,
        pool_name: bt.label,
        item_name: r.name,
        rarity: parseInt(r.rank_type, 10),
        gacha_ts: String(parseServerTimeToEpochMs(r.time)),
        extra_json: {
          uid: r.uid,
          item_type: r.item_type,
          item_id: r.item_id,
        },
      });
    }
  }

  return pulls;
}

module.exports = { fetchAllPulls, normalizePulls };
