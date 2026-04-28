const API_BASE = 'https://ef-webview.gryphline.com/api/record';
const LANG = 'en-us';
const DELAY = 300; // ms between requests

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch records from a single endpoint, paginating through all results.
 * @param {string} endpoint - 'weapon' or 'char'
 * @param {string} token
 * @param {string} serverId
 * @param {string} [poolType] - required for char endpoint
 * @returns {Array} all records
 */
async function fetchEndpoint(endpoint, token, serverId, poolType) {
  const records = [];
  let seq = 0;

  while (true) {
    // Build URL manually — token may already be URL-encoded from the cache,
    // and URLSearchParams would double-encode it
    let url = `${API_BASE}/${endpoint}?lang=${LANG}&token=${token}&server_id=${serverId}`;
    if (poolType) url += `&pool_type=${poolType}`;
    if (seq !== 0) url += `&seq_id=${seq}`;

    console.log(`[API] ${endpoint} seq=${seq} url_length=${url.length}`);

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!resp.ok) {
      throw new Error(`API returned ${resp.status}: ${resp.statusText}`);
    }

    const json = await resp.json();

    if (json.code !== 0) {
      throw new Error(`API error (code ${json.code}): ${json.message || 'unknown'}`);
    }

    const list = json.data?.list || [];
    if (list.length === 0) break;

    records.push(...list);

    if (!json.data.hasMore) break;

    seq = list[list.length - 1].seqId;
    await sleep(DELAY);
  }

  return records;
}

/**
 * Discover character pool types by sending a bad request and parsing the error.
 */
async function discoverCharPools(serverId) {
  try {
    const url = `${API_BASE}/char?lang=${LANG}&token=A&server_id=${serverId}`;
    console.log(`[API] Discovering pools: ${url}`);
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const text = await resp.text();
    console.log(`[API] Pool discovery response: ${text.substring(0, 300)}`);
    const json = JSON.parse(text);
    const msg = Array.isArray(json.message) ? json.message.join(' ') : (json.message || '');
    const match = msg.match(/values:\s*(.+)/);
    if (match) {
      return match[1].split(',').map(s => s.trim()).filter(Boolean);
    }
  } catch (e) {
    console.log(`[API] Pool discovery error: ${e.message}`);
  }
  return [];
}

/**
 * Fetch all pulls for a user.
 * @param {string} token - auth token from game cache
 * @param {string} serverId - server_id from game cache
 * @param {Function} [onProgress] - callback(message) for status updates
 * @returns {{ weapons: Array, characters: Array }}
 */
async function fetchAllPulls(token, serverId, onProgress) {
  const log = onProgress || (() => {});

  // Weapons
  log('Fetching weapon pulls...');
  const weapons = await fetchEndpoint('weapon', token, serverId);
  log(`Found ${weapons.length} weapon pulls`);

  // Character pools
  log('Discovering character pools...');
  const pools = await discoverCharPools(serverId);

  let characters = [];
  if (pools.length === 0) {
    log('No character pools found');
  } else {
    for (const pool of pools) {
      log(`Fetching ${pool}...`);
      const records = await fetchEndpoint('char', token, serverId, pool);
      characters.push(...records);
      log(`Found ${records.length} pulls in ${pool}`);
    }
  }

  return { weapons, characters };
}

/**
 * Normalize raw API data into our DB format.
 */
function normalizePulls(raw) {
  const pulls = [];

  for (const w of raw.weapons || []) {
    pulls.push({
      seq_id: w.seqId,
      is_weapon: true,
      pool_id: w.poolId,
      pool_name: w.poolName,
      item_name: w.weaponName,
      rarity: w.rarity,
      gacha_ts: w.gachaTs,
      extra_json: { weaponType: w.weaponType, weaponId: w.weaponId, isNew: w.isNew },
    });
  }

  for (const c of raw.characters || []) {
    pulls.push({
      seq_id: c.seqId,
      is_weapon: false,
      pool_id: c.poolId,
      pool_name: c.poolName,
      item_name: c.charName,
      rarity: c.rarity,
      gacha_ts: c.gachaTs,
      extra_json: { charId: c.charId, isNew: c.isNew, isFree: c.isFree },
    });
  }

  return pulls;
}

module.exports = { fetchAllPulls, normalizePulls };
