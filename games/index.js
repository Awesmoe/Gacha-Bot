const games = {};

function register(id, mod) {
  games[id] = mod;
}

function get(id) {
  return games[id] || null;
}

function list() {
  return Object.keys(games);
}

function choices() {
  return Object.entries(games).map(([id, mod]) => ({
    name: mod.displayName || id,
    value: id,
  }));
}

// Auto-register installed games
register('endfield', require('./endfield'));
register('starrail', require('./starrail'));
register('genshin', require('./genshin'));

module.exports = { register, get, list, choices };
