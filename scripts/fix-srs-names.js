#!/usr/bin/env node
// Resolve [id:XXXXX] placeholder item names left by the starrailstation CSV import.
// Two-pass: first builds a lookup from existing real-name records in the DB,
// then falls back to a hardcoded table for items that only exist in old history.
// Usage: node scripts/fix-srs-names.js <discord-id>

const db = require('../lib/db').getDb();

// Hardcoded fallback for items that don't appear in live API history.
// Source: Mar-7th/StarRailRes index_new/en/characters.json + light_cones.json
const FALLBACK = {
  // Characters
  '1004': 'Welt',
  '1009': 'Asta',
  '1109': 'Hook',
  '1104': 'Gepard',
  '1107': 'Clara',
  '1202': 'Tingyun',
  '1207': 'Yukong',
  '1208': 'Fu Xuan',
  '1209': 'Yanqing',
  '1210': 'Guinaifen',
  '1214': 'Xueyi',
  '1220': 'Feixiao',
  '1301': 'Gallagher',
  '1303': 'Ruan Mei',
  '1308': 'Acheron',
  '1309': 'Robin',
  '1310': 'Firefly',
  '1312': 'Misha',
  '1401': 'The Herta',
  '1406': 'Cipher',
  '1407': 'Castorice',
  '1410': 'Hysilens',
  '1413': 'Evernight',
  // 4★ Light Cones
  '21002': 'Day One of My New Life',
  '21005': 'The Moles Welcome You',
  '21008': 'Eyes of the Prey',
  '21009': "Landau's Choice",
  '21011': 'Planetary Rendezvous',
  '21012': 'A Secret Vow',
  '21017': 'Subscribe for More!',
  '21020': "Geniuses' Repose",
  '21046': 'Poised to Bloom',
  '21047': 'Shadowed by Night',
  // 5★ Light Cones
  '23003': 'But the Battle Isn\'t Over',
  '23013': 'Time Waits for No One',
  '23017': 'Night of Fright',
  '23037': 'Into the Unreachable Veil',
  '23040': 'Make Farewells More Beautiful',
  '23042': 'Long May Rainbows Adorn the Sky',
  '23047': 'Why Does the Ocean Sing',
};

const [,, discordId] = process.argv;
if (!discordId) {
  console.error('Usage: node scripts/fix-srs-names.js <discord-id>');
  process.exit(1);
}

// Pass 1: build lookup from existing real-name records in DB
const realRows = db.prepare(
  "SELECT item_name, extra_json FROM pulls WHERE discord_id=? AND game='starrail' AND item_name NOT LIKE '[id:%'"
).all(discordId);

const lookup = { ...FALLBACK };
for (const r of realRows) {
  try {
    const ej = JSON.parse(r.extra_json);
    if (ej?.item_id && !lookup[ej.item_id]) {
      lookup[ej.item_id] = r.item_name;
    }
  } catch {}
}
console.log(`Lookup table: ${Object.keys(lookup).length} items (${Object.keys(FALLBACK).length} hardcoded + ${Object.keys(lookup).length - Object.keys(FALLBACK).length} from DB)`);

// Pass 2: update placeholder records
const placeholders = db.prepare(
  "SELECT rowid, item_name, extra_json FROM pulls WHERE discord_id=? AND game='starrail' AND item_name LIKE '[id:%'"
).all(discordId);

console.log(`Placeholder records to fix: ${placeholders.length}`);

const updateStmt = db.prepare("UPDATE pulls SET item_name=? WHERE rowid=?");

let fixed = 0, skipped = 0;
const update = db.transaction(() => {
  for (const row of placeholders) {
    try {
      const ej = JSON.parse(row.extra_json);
      const name = ej?.item_id ? lookup[ej.item_id] : null;
      if (name) {
        updateStmt.run(name, row.rowid);
        fixed++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }
});
update();

console.log(`Fixed: ${fixed}  Still unresolved: ${skipped}`);
if (skipped > 0) {
  // Show what's still unresolved
  const still = db.prepare(
    "SELECT item_name, extra_json FROM pulls WHERE discord_id=? AND game='starrail' AND item_name LIKE '[id:%'"
  ).all(discordId);
  const ids = {};
  for (const r of still) {
    try { const ej = JSON.parse(r.extra_json); if (ej?.item_id) ids[ej.item_id] = (ids[ej.item_id]||0)+1; } catch {}
  }
  console.log('Unresolved item IDs:', ids);
}
