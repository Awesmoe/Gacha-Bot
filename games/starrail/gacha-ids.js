// Honkai: Star Rail — observed gacha_id mappings
// This is an optional accuracy layer on top of the date-based schedule files.
// If a gacha_id is missing here, the bot falls back to timestamp schedule matching.

module.exports = {
  // Observed in json.txt on 2026-03-03 with featured 5★ Sparxie.
  '2109': {
    type: 'character',
    featured: ['Sparxie'],
  },

  // Observed in json.txt on 2026-02-12 with featured 5★ Yao Guang.
  '2105': {
    type: 'character',
    featured: ['Yao Guang'],
  },

  // Observed in json.txt on 2025-10-15 with featured 5★ Anaxa.
  '2091': {
    type: 'character',
    featured: ['Anaxa'],
  },
};
