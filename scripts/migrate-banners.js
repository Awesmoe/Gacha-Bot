// One-time migration: import banner schedule data from JS files into the DB.
// Run once: node scripts/migrate-banners.js
// After verifying counts, the JS files (banners.js, lightcones.js, weapons.js) can be deleted.

const db = require('../lib/db');

const hsrCharacters = require('../games/starrail/banners');
const hsrLightcones = require('../games/starrail/lightcones');
const genshinCharacters = require('../games/genshin/banners');
const genshinWeapons = require('../games/genshin/weapons');

function migrate(game, bannerType, schedule) {
  let count = 0;
  for (const entry of schedule) {
    db.insertScheduleEntry({
      game,
      bannerType,
      startDate: entry.start,
      endDate: entry.end || null,
      name: entry.name || null,
      featured: entry.featured,
    });
    count++;
  }
  console.log(`  ${game}/${bannerType}: inserted ${count} entries`);
  return count;
}

console.log('Migrating banner schedules to DB...');
let total = 0;
total += migrate('starrail', 'character', hsrCharacters);
total += migrate('starrail', 'lightcone', hsrLightcones);
total += migrate('genshin', 'character', genshinCharacters);
total += migrate('genshin', 'weapon', genshinWeapons);
console.log(`Done — ${total} total entries inserted.`);
