// Nikki pity is per-banner-instance (does NOT carry over between banners),
// so the bannerTypes/classifyPull pattern from other games doesn't apply.
// format.js does its own banner classification by reading banner_schedule.
module.exports = {
  id: 'nikki',
  displayName: 'Infinity Nikki',
  bannerTypes: {},
  classifyPull(_pull) {
    return 'unknown';
  },
};
