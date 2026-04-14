module.exports = {
  id: 'genshin',
  displayName: 'Genshin Impact',

  authType: 'authkey',

  defaultBanners: {},

  bannerTypes: {
    character: {
      label: 'Character Event',
      // gacha_type 301 (Wish-1) and 400 (Wish-2) are both classified here
      hardPity: 90,
      softPity: 74,
      has5050: true,
      guaranteesAfterLoss: true, // losing 50/50 guarantees next 5★ is featured
      hasSpark: false,
      maxRarity: 5,
    },
    weapon: {
      label: 'Weapon Event',
      hardPity: 80,
      softPity: 65,
      has5050: true,
      guaranteesAfterLoss: false, // Epitomized Path is 2-fate-point system, not modeled yet
      hasSpark: false,
      maxRarity: 5,
      isWeapon: true,
    },
    standard: {
      label: 'Standard',
      hardPity: 90,
      softPity: 74,
      has5050: false,
      guaranteesAfterLoss: false,
      hasSpark: false,
      maxRarity: 5,
    },
    beginner: {
      label: 'Beginner',
      hardPity: 50,
      softPity: null,
      has5050: false,
      guaranteesAfterLoss: false,
      hasSpark: false,
      maxRarity: 5,
    },
  },

  /**
   * Classify a pull's banner type from pool_id (gacha_type).
   */
  classifyPull(pull) {
    const gt = pull.pool_id;
    if (gt === '301' || gt === '400') return 'character';
    if (gt === '302') return 'weapon';
    if (gt === '200') return 'standard';
    if (gt === '100') return 'beginner';
    return 'character'; // fallback
  },

  maxRarity: 5,
};
