const config = require('./config');

// Global server endpoint. CN would use a different base URL.
const API_BASE = 'https://public-operation-hkrpg-sg.hoyoverse.com/common/hkrpg_gacha_record/api/getGachaLog';
const DELAY = 300; // ms between requests — HoYoverse is stricter about rate limiting

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch warp records for a specific gacha_type.
 * @param {string} authkey - URL-encoded authkey from game cache
 * @param {string} gachaType - '1', '2', '11', or '12'
 * @returns {Array} all records for this gacha type
 */
async function fetchGachaType(authkey, gachaType) {
  const records = [];
  let endId = '0';

  while (true) {
    const url = `${API_BASE}?authkey_ver=1&sign_type=2&auth_appid=webview_gacha` +
      `&lang=en&game_biz=hkrpg_global&authkey=${authkey}&gacha_type=${gachaType}&page=1&size=20&end_id=${endId}`;

    console.log(`[HSR API] gacha_type=${gachaType} end_id=${endId} records_so_far=${records.length}`);

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

    // Use the last item's id as cursor for next page
    endId = list[list.length - 1].id;
    await sleep(DELAY);
  }

  return records;
}

/**
 * Fetch all warp records across all banner types.
 * @param {string} authkey - the authkey from game cache (URL-encoded)
 * @param {string} _serverId - unused for HSR (kept for interface compatibility)
 * @param {Function} [onProgress] - callback(message)
 * @returns {{ characters: Array, lightcones: Array, standard: Array, beginner: Array }}
 */
async function fetchAllPulls(authkey, _serverId, onProgress) {
  const log = onProgress || (() => {});
  const result = {};

  for (const [key, bt] of Object.entries(config.bannerTypes)) {
    log(`Fetching ${bt.label} warps...`);
    const records = await fetchGachaType(authkey, bt.gachaType);
    result[key] = records;
    log(`Found ${records.length} ${bt.label} warps`);
  }

  return result;
}

/**
 * Normalize raw HSR API data into our DB format.
 * HSR response items look like:
 * { uid, gacha_type, item_id, count, time, name, lang, item_type, rank_type, id }
 */
// HoYo `time` is server wall-clock (UTC+8). Parsing without an explicit offset
// would interpret it as the host's local timezone, which on a Pi running UTC
// shifts pulls by 8h and misclassifies banner-boundary 50/50s.
function parseServerTimeToEpochMs(time) {
  return Date.parse(time.replace(' ', 'T') + '+08:00');
}

function normalizePulls(raw) {
  const pulls = [];

  for (const [bannerKey, records] of Object.entries(raw)) {
    const bt = config.bannerTypes[bannerKey];
    if (!bt) continue;

    for (const r of records) {
      pulls.push({
        seq_id: r.id, // unique ID from HoYoverse, works as seq
        is_weapon: r.item_type === 'Light Cone',
        pool_id: r.gacha_type, // store gacha_type as pool_id
        pool_name: bt.label, // we don't get banner-specific names from the API
        item_name: r.name,
        rarity: parseInt(r.rank_type, 10),
        gacha_ts: String(parseServerTimeToEpochMs(r.time)),
        extra_json: {
          uid: r.uid,
          item_type: r.item_type,
          item_id: r.item_id,
          gacha_id: r.gacha_id,
        },
      });
    }
  }

  return pulls;
}

module.exports = { fetchAllPulls, normalizePulls };
