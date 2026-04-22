/**
 * Compute pity for each pull and annotate top-rarity results.
 *
 * @param {Array} pulls - sorted ascending by seq_id
 * @param {Object} opts
 * @param {number} opts.hardPity - hard pity ceiling (e.g. 80)
 * @param {number|null} opts.softPity - soft pity start (e.g. 65)
 * @param {boolean} opts.has5050 - whether this banner type has 50/50
 * @param {Object} opts.bannerMap - poolName → featured character name
 * @param {number} [opts.topRarity=6] - highest rarity tier (6 for Endfield, 5 for HSR)
 * @param {Function} [opts.getFeatured] - pull -> featured item(s) for timestamp-based matching
 * @param {boolean} [opts.guaranteesAfterLoss=false] - next top rarity is guaranteed after a loss
 * @returns {Object} { withPity, sixStars, currentPity, fiveStarPity, nextIsGuarantee, stats }
 */
function analyzePulls(pulls, opts) {
  const {
    hardPity,
    softPity,
    has5050,
    bannerMap = {},
    topRarity = 6,
    getFeatured = null,
    guaranteesAfterLoss = false,
  } = opts;
  const subRarity = topRarity - 1; // e.g. 5 for Endfield, 4 for HSR

  // Compute running pity (toward top rarity)
  let pity = 0;
  const withPity = pulls.map(p => {
    pity++;
    const r = { ...p, _pity: pity };
    if (p.rarity === topRarity) pity = 0;
    return r;
  });

  const currentPity = pity;

  // Sub-rarity pity (pulls since last sub-rarity or higher)
  let fiveStarPity = 0;
  for (let i = pulls.length - 1; i >= 0; i--) {
    if (pulls[i].rarity >= subRarity) break;
    fiveStarPity++;
  }

  // 6★ analysis
  const sixStars = [];
  let won = 0, lost = 0, guaranteed = 0;
  let nextIsGuarantee = false;

  if (has5050) {
    const bannerCumulative = {};
    const gotFeaturedOn = {};

    for (const p of withPity) {
      const bn = p.pool_name;
      if (!bannerCumulative[bn]) { bannerCumulative[bn] = 0; gotFeaturedOn[bn] = false; }
      bannerCumulative[bn]++;

      if (p.rarity === topRarity) {
        const featured = getFeatured ? getFeatured(p) : bannerMap[bn];
        const featuredItems = Array.isArray(featured)
          ? featured
          : (featured ? [featured] : []);

        if (featuredItems.length === 0) {
          sixStars.push({ ...p, result: 'unknown', _bannerPull: bannerCumulative[bn] });
          continue;
        }

        const isFeatured = featuredItems.some(f => f.toLowerCase() === p.item_name.toLowerCase());
        let result;

        if (guaranteesAfterLoss && isFeatured && nextIsGuarantee) {
          result = 'guaranteed';
          guaranteed++;
          nextIsGuarantee = false;
        } else if (isFeatured && !getFeatured && !gotFeaturedOn[bn] && bannerCumulative[bn] >= 120) {
          result = 'guarantee';
          guaranteed++;
          gotFeaturedOn[bn] = true;
        } else if (isFeatured) {
          result = 'won';
          won++;
          gotFeaturedOn[bn] = true;
        } else {
          result = 'lost';
          lost++;
          if (guaranteesAfterLoss) nextIsGuarantee = true;
        }

        sixStars.push({ ...p, result, _bannerPull: bannerCumulative[bn] });
      }
    }
  } else {
    for (const p of withPity) {
      if (p.rarity === topRarity) sixStars.push({ ...p, result: null });
    }
  }

  const total = pulls.length;
  const r6count = sixStars.length;
  const avgPity = r6count > 0
    ? (sixStars.reduce((s, p) => s + p._pity, 0) / r6count).toFixed(1)
    : null;

  let r5count = 0, r4count = 0;
  for (const p of pulls) {
    if (p.rarity === subRarity) r5count++;
    else if (p.rarity === subRarity - 1) r4count++;
  }

  return {
    withPity,
    sixStars,
    currentPity,
    fiveStarPity,
    nextIsGuarantee,
    stats: {
      total,
      r6: r6count,
      r5: r5count,
      r4: r4count,
      r6pct: total > 0 ? (r6count / total * 100).toFixed(2) : '0.00',
      avgPity,
      won,
      lost,
      guaranteed,
    }
  };
}

module.exports = { analyzePulls };
