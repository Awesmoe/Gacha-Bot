const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'gacha.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    init();
  }
  return db;
}

function init() {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS pulls (
      discord_id TEXT NOT NULL,
      game TEXT NOT NULL,
      seq_id TEXT NOT NULL,
      is_weapon INTEGER NOT NULL DEFAULT 0,
      pool_id TEXT,
      pool_name TEXT,
      item_name TEXT NOT NULL,
      rarity INTEGER NOT NULL,
      gacha_ts TEXT,
      extra_json TEXT,
      PRIMARY KEY (discord_id, game, seq_id, is_weapon)
    );

    CREATE TABLE IF NOT EXISTS banners (
      game TEXT NOT NULL,
      pool_name TEXT NOT NULL,
      featured_item TEXT NOT NULL,
      PRIMARY KEY (game, pool_name)
    );

    CREATE INDEX IF NOT EXISTS idx_pulls_user_game
      ON pulls (discord_id, game, is_weapon, seq_id);

    CREATE TABLE IF NOT EXISTS banner_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game TEXT NOT NULL,
      banner_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      name TEXT,
      featured TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_banner_schedule_game_type
      ON banner_schedule (game, banner_type);

    CREATE TABLE IF NOT EXISTS gacha_id_map (
      gacha_id TEXT PRIMARY KEY,
      banner_type TEXT NOT NULL,
      featured TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS item_catalog (
      game TEXT NOT NULL,
      item_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rarity INTEGER,
      slot TEXT,
      banner_id TEXT,
      extra_json TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (game, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_item_catalog_banner
      ON item_catalog (game, banner_id);

    CREATE TABLE IF NOT EXISTS nikki_lifetime_events (
      discord_id TEXT NOT NULL,
      banner_id TEXT NOT NULL,
      event_idx INTEGER NOT NULL,
      pool_cnt INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      rarity INTEGER NOT NULL,
      pulls_to_obtain INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'self',
      PRIMARY KEY (discord_id, banner_id, event_idx)
    );

    CREATE INDEX IF NOT EXISTS idx_nikki_lifetime_user
      ON nikki_lifetime_events (discord_id);

    CREATE TABLE IF NOT EXISTS imports (
      discord_id TEXT NOT NULL,
      game TEXT NOT NULL,
      last_import_ts INTEGER NOT NULL,
      PRIMARY KEY (discord_id, game)
    );

    CREATE TABLE IF NOT EXISTS nikki_lifetime_summary (
      discord_id TEXT PRIMARY KEY,
      periodic_draw_num INTEGER NOT NULL,
      permanent_draw_num INTEGER NOT NULL,
      cloth_num INTEGER NOT NULL DEFAULT 0,
      momo_num INTEGER NOT NULL DEFAULT 0,
      suits_num INTEGER NOT NULL DEFAULT 0,
      login_days INTEGER NOT NULL DEFAULT 0,
      total_play_time INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migrate pre-existing nikki_lifetime_summary tables to add columns introduced later.
  const summaryCols = new Set(
    d.prepare(`PRAGMA table_info(nikki_lifetime_summary)`).all().map(r => r.name)
  );
  for (const [name, type] of [
    ['cloth_num', 'INTEGER NOT NULL DEFAULT 0'],
    ['momo_num', 'INTEGER NOT NULL DEFAULT 0'],
    ['suits_num', 'INTEGER NOT NULL DEFAULT 0'],
    ['login_days', 'INTEGER NOT NULL DEFAULT 0'],
    ['total_play_time', 'INTEGER NOT NULL DEFAULT 0'],
  ]) {
    if (!summaryCols.has(name)) {
      d.exec(`ALTER TABLE nikki_lifetime_summary ADD COLUMN ${name} ${type}`);
    }
  }

  // Seed known HSR gacha_id mappings (previously in gacha-ids.js)
  const seedStmt = d.prepare(`
    INSERT OR IGNORE INTO gacha_id_map (gacha_id, banner_type, featured)
    VALUES (?, ?, ?)
  `);
  const seeds = [
    ['2109', 'character', JSON.stringify(['Sparxie'])],
    ['2105', 'character', JSON.stringify(['Yao Guang'])],
    ['2091', 'character', JSON.stringify(['Anaxa'])],
  ];
  for (const [id, type, featured] of seeds) seedStmt.run(id, type, featured);
}

// ---- Pull operations ----

/**
 * Insert pulls, skipping duplicates.
 * Returns { inserted, skipped }
 */
function insertPulls(discordId, game, pulls) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR IGNORE INTO pulls
      (discord_id, game, seq_id, is_weapon, pool_id, pool_name, item_name, rarity, gacha_ts, extra_json)
    VALUES
      (@discord_id, @game, @seq_id, @is_weapon, @pool_id, @pool_name, @item_name, @rarity, @gacha_ts, @extra_json)
  `);

  let inserted = 0;
  const tx = d.transaction((rows) => {
    for (const row of rows) {
      const result = stmt.run({
        discord_id: discordId,
        game,
        seq_id: row.seq_id,
        is_weapon: row.is_weapon ? 1 : 0,
        pool_id: row.pool_id || null,
        pool_name: row.pool_name || null,
        item_name: row.item_name,
        rarity: row.rarity,
        gacha_ts: row.gacha_ts || null,
        extra_json: row.extra_json ? JSON.stringify(row.extra_json) : null,
      });
      if (result.changes > 0) inserted++;
    }
  });

  tx(pulls);
  return { inserted, skipped: pulls.length - inserted };
}

/**
 * Get all pulls for a user+game, sorted by seq_id ascending.
 * filter: 'all' | 'character' | 'weapon'
 */
function getPulls(discordId, game, filter = 'all') {
  const d = getDb();
  let sql = `SELECT * FROM pulls WHERE discord_id = ? AND game = ?`;
  const params = [discordId, game];

  if (filter === 'weapon') {
    sql += ` AND is_weapon = 1`;
  } else if (filter === 'character') {
    sql += ` AND is_weapon = 0`;
  }

  sql += ` ORDER BY CAST(seq_id AS INTEGER) ASC`;
  return d.prepare(sql).all(...params);
}

/**
 * Get pull counts summary for a user+game.
 */
function getPullSummary(discordId, game) {
  const d = getDb();
  return d.prepare(`
    SELECT
      is_weapon,
      COUNT(*) as total,
      SUM(CASE WHEN rarity = 6 THEN 1 ELSE 0 END) as r6,
      SUM(CASE WHEN rarity = 5 THEN 1 ELSE 0 END) as r5,
      SUM(CASE WHEN rarity = 4 THEN 1 ELSE 0 END) as r4
    FROM pulls
    WHERE discord_id = ? AND game = ?
    GROUP BY is_weapon
  `).all(discordId, game);
}

// ---- Banner operations ----

function getBanner(game, poolName) {
  const d = getDb();
  return d.prepare(`SELECT * FROM banners WHERE game = ? AND pool_name = ?`).get(game, poolName);
}

function getAllBanners(game) {
  const d = getDb();
  return d.prepare(`SELECT * FROM banners WHERE game = ?`).all(game);
}

function upsertBanner(game, poolName, featuredItem) {
  const d = getDb();
  d.prepare(`
    INSERT INTO banners (game, pool_name, featured_item)
    VALUES (?, ?, ?)
    ON CONFLICT (game, pool_name)
    DO UPDATE SET featured_item = excluded.featured_item
  `).run(game, poolName, featuredItem);
}

function removeBanner(game, poolName) {
  const d = getDb();
  return d.prepare(`DELETE FROM banners WHERE game = ? AND pool_name = ?`).run(game, poolName);
}

function deletePulls(discordId, game) {
  const d = getDb();
  const deletePullRows = d.prepare(`DELETE FROM pulls WHERE discord_id = ? AND game = ?`);
  const deleteImportRow = d.prepare(`DELETE FROM imports WHERE discord_id = ? AND game = ?`);
  const deleteNikkiEvents = d.prepare(`DELETE FROM nikki_lifetime_events WHERE discord_id = ?`);
  const deleteNikkiSummary = d.prepare(`DELETE FROM nikki_lifetime_summary WHERE discord_id = ?`);

  return d.transaction(() => {
    const pullsResult = deletePullRows.run(discordId, game);
    deleteImportRow.run(discordId, game);
    let extraDeleted = 0;
    if (game === 'nikki') {
      extraDeleted += deleteNikkiEvents.run(discordId).changes;
      extraDeleted += deleteNikkiSummary.run(discordId).changes;
    }
    return {
      changes: pullsResult.changes + extraDeleted,
      pullsDeleted: pullsResult.changes,
      extraDeleted,
    };
  })();
}

// ---- Banner schedule operations ----

/**
 * Get all schedule entries for a game+bannerType, sorted by start_date ascending.
 * Returns objects with { id, start, end, name, featured } where featured is a parsed array.
 */
function getSchedule(game, bannerType) {
  const d = getDb();
  const rows = d.prepare(`
    SELECT * FROM banner_schedule WHERE game = ? AND banner_type = ? ORDER BY start_date ASC
  `).all(game, bannerType);
  return rows.map(r => ({
    id: r.id,
    start: r.start_date,
    end: r.end_date,
    name: r.name,
    featured: JSON.parse(r.featured),
  }));
}

/**
 * Insert a new banner schedule entry.
 */
function insertScheduleEntry({ game, bannerType, startDate, endDate, name, featured }) {
  const d = getDb();
  return d.prepare(`
    INSERT INTO banner_schedule (game, banner_type, start_date, end_date, name, featured)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(game, bannerType, startDate, endDate || null, name || null, JSON.stringify(featured));
}

/**
 * Remove a schedule entry by ID.
 */
function removeScheduleEntry(id) {
  const d = getDb();
  return d.prepare(`DELETE FROM banner_schedule WHERE id = ?`).run(id);
}

// ---- Gacha ID map (HSR) ----

function getGachaIdMap(gachaId) {
  const row = getDb().prepare(`SELECT * FROM gacha_id_map WHERE gacha_id = ?`).get(gachaId);
  if (!row) return null;
  return { banner_type: row.banner_type, featured: JSON.parse(row.featured) };
}

function upsertGachaIdMap(gachaId, bannerType, featured) {
  getDb().prepare(`
    INSERT OR REPLACE INTO gacha_id_map (gacha_id, banner_type, featured)
    VALUES (?, ?, ?)
  `).run(gachaId, bannerType, JSON.stringify(featured));
}

// ---- Item catalog (game-agnostic itemId -> name/rarity/slot lookup) ----

function getCatalogItem(game, itemId) {
  const row = getDb().prepare(
    `SELECT * FROM item_catalog WHERE game = ? AND item_id = ?`
  ).get(game, itemId);
  if (!row) return null;
  return {
    item_id: row.item_id,
    name: row.name,
    rarity: row.rarity,
    slot: row.slot,
    banner_id: row.banner_id,
    extra: row.extra_json ? JSON.parse(row.extra_json) : null,
  };
}

function upsertCatalogItems(game, items) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO item_catalog (game, item_id, name, rarity, slot, banner_id, extra_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (game, item_id) DO UPDATE SET
      name = excluded.name,
      rarity = excluded.rarity,
      slot = excluded.slot,
      banner_id = excluded.banner_id,
      extra_json = excluded.extra_json,
      updated_at = excluded.updated_at
  `);
  const now = Date.now();
  const tx = d.transaction((rows) => {
    for (const r of rows) {
      stmt.run(
        game, r.item_id, r.name, r.rarity ?? null, r.slot ?? null,
        r.banner_id ?? null, r.extra ? JSON.stringify(r.extra) : null, now
      );
    }
  });
  tx(items);
  return items.length;
}

function getCatalogMap(game) {
  const rows = getDb().prepare(
    `SELECT item_id, name, rarity, slot, banner_id FROM item_catalog WHERE game = ?`
  ).all(game);
  const map = new Map();
  for (const r of rows) map.set(r.item_id, r);
  return map;
}

function getCatalogLastRefresh(game) {
  const row = getDb().prepare(
    `SELECT MAX(updated_at) AS ts FROM item_catalog WHERE game = ?`
  ).get(game);
  return row?.ts || null;
}

// ---- Nikki lifetime events ----

function replaceNikkiLifetimeEvents(discordId, events) {
  const d = getDb();
  const del = d.prepare(`DELETE FROM nikki_lifetime_events WHERE discord_id = ?`);
  const ins = d.prepare(`
    INSERT INTO nikki_lifetime_events
      (discord_id, banner_id, event_idx, pool_cnt, item_id, rarity, pulls_to_obtain, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Per-banner counter so each row has a stable, unique event_idx within (user, banner).
  const tx = d.transaction((rows) => {
    del.run(discordId);
    const idxByBanner = new Map();
    for (const e of rows) {
      const idx = idxByBanner.get(e.banner_id) || 0;
      idxByBanner.set(e.banner_id, idx + 1);
      ins.run(discordId, e.banner_id, idx, e.pool_cnt, e.item_id, e.rarity, e.pulls_to_obtain, e.source || 'self');
    }
  });
  tx(events);
  return events.length;
}

function getNikkiLifetimeEvents(discordId) {
  return getDb().prepare(
    `SELECT banner_id, event_idx, pool_cnt, item_id, rarity, pulls_to_obtain, source
       FROM nikki_lifetime_events WHERE discord_id = ?`
  ).all(discordId);
}

function replaceNikkiLifetimeSummary(discordId, summary) {
  getDb().prepare(`
    INSERT OR REPLACE INTO nikki_lifetime_summary
      (discord_id, periodic_draw_num, permanent_draw_num,
       cloth_num, momo_num, suits_num, login_days, total_play_time, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    discordId,
    summary.periodic_draw_num,
    summary.permanent_draw_num,
    summary.cloth_num ?? 0,
    summary.momo_num ?? 0,
    summary.suits_num ?? 0,
    summary.login_days ?? 0,
    summary.total_play_time ?? 0,
    Date.now(),
  );
}

function recordImport(discordId, game) {
  getDb().prepare(`
    INSERT INTO imports (discord_id, game, last_import_ts)
    VALUES (?, ?, ?)
    ON CONFLICT (discord_id, game)
    DO UPDATE SET last_import_ts = excluded.last_import_ts
  `).run(discordId, game, Date.now());
}

function getLastImport(discordId, game) {
  const row = getDb().prepare(
    `SELECT last_import_ts FROM imports WHERE discord_id = ? AND game = ?`
  ).get(discordId, game);
  return row?.last_import_ts || null;
}

function applyLastImportTimestamp(embed, discordId, game) {
  if (!discordId) return embed;
  const ts = getLastImport(discordId, game);
  if (ts) embed.setTimestamp(ts);
  return embed;
}

function getNikkiLifetimeSummary(discordId) {
  return getDb().prepare(
    `SELECT periodic_draw_num, permanent_draw_num,
            cloth_num, momo_num, suits_num, login_days, total_play_time, updated_at
       FROM nikki_lifetime_summary WHERE discord_id = ?`
  ).get(discordId) || null;
}

module.exports = {
  getDb,
  insertPulls,
  getPulls,
  getPullSummary,
  deletePulls,
  getBanner,
  getAllBanners,
  upsertBanner,
  removeBanner,
  getSchedule,
  insertScheduleEntry,
  removeScheduleEntry,
  getGachaIdMap,
  upsertGachaIdMap,
  getCatalogItem,
  getCatalogMap,
  upsertCatalogItems,
  getCatalogLastRefresh,
  replaceNikkiLifetimeEvents,
  getNikkiLifetimeEvents,
  replaceNikkiLifetimeSummary,
  getNikkiLifetimeSummary,
  recordImport,
  getLastImport,
  applyLastImportTimestamp,
};
