// gacha_ts is stored as the UTC ms epoch of the server-time wall clock; +8h
// recovers the server-side calendar date regardless of the host's local TZ.
function serverDateKey(gachaTs) {
  return new Date(Number(gachaTs) + 8 * 3600000).toISOString().slice(0, 10);
}

function formatServerDate(gachaTs) {
  return new Date(Number(gachaTs) + 8 * 3600000)
    .toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

function featuredForPullOnSchedule(pull, schedule) {
  const pullDate = serverDateKey(pull.gacha_ts);
  const found = new Set();
  for (const banner of schedule) {
    if (pullDate >= banner.start && (!banner.end || pullDate < banner.end)) {
      for (const item of banner.featured) found.add(item);
    }
  }
  return found.size > 0 ? [...found] : null;
}

module.exports = { serverDateKey, formatServerDate, featuredForPullOnSchedule };
