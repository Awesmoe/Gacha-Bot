#!/usr/bin/env node
// Import Paimon.moe XLSX wish history export into the gacha DB.
// Usage: node scripts/import-paimon-xlsx.js <xlsx-file> <discord-id>
//
// XLSX sheets: Character Event, Weapon Event, Standard, Beginners' Wish
// Columns: Type, Name, Time, ⭐, Pity, #Roll, Group, Banner, Part
//
// The Character Event sheet contains both Wish 1 (Part="") and Wish 2 (Part="Wish 2"),
// which correspond to Genshin gacha_type 301 and 400 respectively.
//
// Deduplication strategy: only import rows whose timestamp is strictly before the
// earliest pull already in the DB for that pool. This avoids double-counting the
// overlap between paimon history and live API imports.
// Synthetic seq_id format: paimon_{pool_code}_{Group}_{#Roll}

const xlsx = require('xlsx');
const path = require('path');
const dbLib = require('../lib/db');
const db = dbLib.getDb();

const SHEET_MAP = [
  { sheet: 'Character Event', partFilter: (p) => !p,  poolId: '301', poolName: 'Character Event', code: 'ce1' },
  { sheet: 'Character Event', partFilter: (p) => p === 'Wish 2', poolId: '400', poolName: 'Character Event', code: 'ce2' },
  { sheet: 'Weapon Event',    partFilter: () => true,  poolId: '302', poolName: 'Weapon Event',    code: 'we'  },
  { sheet: 'Standard',        partFilter: () => true,  poolId: '200', poolName: 'Standard',        code: 'std' },
  { sheet: "Beginners' Wish", partFilter: () => true,  poolId: '100', poolName: 'Beginner',        code: 'beg' },
];

const [,, xlsxFile, discordId] = process.argv;
if (!xlsxFile || !discordId) {
  console.error('Usage: node scripts/import-paimon-xlsx.js <xlsx-file> <discord-id>');
  process.exit(1);
}

// Get per-pool cutoff timestamps from existing DB data
const cutoffs = {};
const cutoffRows = db.prepare(
  "SELECT pool_id, MIN(CAST(gacha_ts AS INTEGER)) as min_ts FROM pulls WHERE discord_id=? AND game='genshin' GROUP BY pool_id"
).all(discordId);
for (const r of cutoffRows) {
  cutoffs[r.pool_id] = r.min_ts;
}
console.log('Cutoffs (will skip paimon rows at or after these times):');
for (const [poolId, ts] of Object.entries(cutoffs)) {
  console.log(`  pool ${poolId}: ${new Date(ts).toISOString()}`);
}
if (Object.keys(cutoffs).length === 0) {
  console.log('  (none — no existing Genshin data, importing everything)');
}

const wb = xlsx.readFile(path.resolve(xlsxFile));

let totalInserted = 0, totalSkipped = 0, totalCutoff = 0;

for (const { sheet, partFilter, poolId, poolName, code } of SHEET_MAP) {
  if (!wb.Sheets[sheet]) continue;

  const allRows = xlsx.utils.sheet_to_json(wb.Sheets[sheet]);
  const rows = allRows.filter(r => partFilter(r.Part || ''));
  if (rows.length === 0) continue;

  const cutoffTs = cutoffs[poolId] ?? Infinity;

  const pulls = [];
  let cutoffCount = 0;
  let rowIdx = 0;

  for (const r of rows) {
    const ts = new Date(r.Time).getTime();
    if (ts >= cutoffTs) {
      cutoffCount++;
      continue;
    }
    pulls.push({
      seq_id:    `paimon_${code}_${rowIdx++}`,
      is_weapon: r.Type === 'Weapon',
      pool_id:   poolId,
      pool_name: poolName,
      item_name: r.Name,
      rarity:    r['⭐'],
      gacha_ts:  String(ts),
      extra_json: {
        banner: r.Banner,
        source: 'paimon-xlsx',
      },
    });
  }

  const { inserted, skipped } = pulls.length > 0
    ? dbLib.insertPulls(discordId, 'genshin', pulls)
    : { inserted: 0, skipped: 0 };

  const label = sheet + (code === 'ce1' ? ' (Wish 1)' : code === 'ce2' ? ' (Wish 2)' : '');
  console.log(`\n${label}: ${rows.length} rows in export`);
  console.log(`  Skipped (overlap with live data): ${cutoffCount}`);
  console.log(`  Inserted: ${inserted}  Skipped (already in DB): ${skipped}`);

  totalInserted += inserted;
  totalCutoff += cutoffCount;
  totalSkipped += skipped;
}

console.log(`\nTotal inserted: ${totalInserted}  Overlap skipped: ${totalCutoff}  Duplicate skipped: ${totalSkipped}`);
