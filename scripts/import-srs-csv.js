#!/usr/bin/env node
// Import starrailstation.com CSV export into the gacha DB.
// Usage: node scripts/import-srs-csv.js <csv-file> <discord-id>
//
// CSV format: uid,id,rarity,time,banner,type,manual
//   uid    = unique pull ID (= HoYoverse's `id` field, our seq_id)
//   id     = item game ID (character: 4-digit 1xxx, light cone: 5-digit 2xxxx)
//   rarity = 3/4/5
//   time   = ISO timestamp
//   banner = gacha_id (specific banner instance, e.g. 2109)
//   type   = gacha_type (1=Standard, 11=Char Event, 12=LC Event)
//   manual = true if manually entered — we skip these

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const POOL_NAMES = {
  '1':  'Standard',
  '2':  'Departure',
  '11': 'Character Event',
  '12': 'Light Cone Event',
};

const [,, csvFile, discordId] = process.argv;
if (!csvFile || !discordId) {
  console.error('Usage: node scripts/import-srs-csv.js <csv-file> <discord-id>');
  process.exit(1);
}

const text = fs.readFileSync(path.resolve(csvFile), 'utf8');
const lines = text.trim().split('\n');
const headers = lines[0].split(',').map(h => h.trim());
const rows = lines.slice(1).map(line => {
  const vals = line.split(',');
  return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim()]));
});

console.log(`Parsed ${rows.length} rows from CSV`);

const manual = rows.filter(r => r.manual === 'true');
if (manual.length > 0) {
  console.log(`Skipping ${manual.length} manually-entered rows`);
}

const pulls = rows
  .filter(r => r.manual !== 'true')
  .map(r => ({
    seq_id:    r.uid,
    is_weapon: r.id.length >= 5, // 4-digit = character, 5-digit = light cone
    pool_id:   r.type,
    pool_name: POOL_NAMES[r.type] ?? `type:${r.type}`,
    item_name: `[id:${r.id}]`,   // placeholder — item name lookup not yet implemented
    rarity:    parseInt(r.rarity, 10),
    gacha_ts:  String(new Date(r.time).getTime()),
    extra_json: {
      item_id:  r.id,
      gacha_id: r.banner,
      source:   'srs-csv',
    },
  }));

// Show breakdown before inserting
const byType = {};
for (const p of pulls) {
  const label = POOL_NAMES[p.pool_id] ?? p.pool_id;
  byType[label] = (byType[label] || { total: 0, r5: 0 });
  byType[label].total++;
  if (p.rarity === 5) byType[label].r5++;
}
console.log('\nBreakdown:');
for (const [label, s] of Object.entries(byType)) {
  console.log(`  ${label}: ${s.total} pulls (${s.r5} five-star)`);
}

const { inserted, skipped } = db.insertPulls(discordId, 'starrail', pulls);
console.log(`\nInserted: ${inserted}  Skipped (already in DB): ${skipped}`);
