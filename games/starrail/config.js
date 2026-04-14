module.exports = {
  id: 'starrail',
  displayName: 'Honkai: Star Rail',

  // HSR uses authkey-based API, not token+server_id like Endfield
  authType: 'authkey', // vs 'token' for Endfield

  // Default banner→featured mappings will be populated over time via /banner add
  // HSR has too many banners to seed manually, so we start empty
  defaultBanners: {},

  // Banner type definitions
  // gacha_type values: 1=Stellar(Standard), 2=Departure(Beginner), 11=Character Event, 12=Light Cone Event
  bannerTypes: {
    character: {
      label: 'Character Event',
      gachaType: '11',
      hardPity: 90,
      softPity: 73,
      has5050: true,
      guaranteesAfterLoss: true, // HSR guarantees featured after losing 50/50 (unlike Endfield!)
      maxRarity: 5, // HSR uses 5★ as highest, not 6★
    },
    lightcone: {
      label: 'Light Cone Event',
      gachaType: '12',
      hardPity: 80,
      softPity: 65,
      has5050: true,
      guaranteesAfterLoss: true,
      maxRarity: 5,
      isWeapon: true,
    },
    standard: {
      label: 'Standard',
      gachaType: '1',
      hardPity: 90,
      softPity: 73,
      has5050: false,
      maxRarity: 5,
    },
    beginner: {
      label: 'Departure',
      gachaType: '2',
      hardPity: 50,
      softPity: null,
      has5050: false,
      maxRarity: 5,
    },
  },

  /**
   * Classify a pull's banner type from gacha_type.
   */
  classifyPull(pull) {
    const gt = pull.pool_id; // We store gacha_type in pool_id
    for (const [key, bt] of Object.entries(this.bannerTypes)) {
      if (bt.gachaType === gt) return key;
    }
    return 'character'; // fallback
  },

  /**
   * Get the max rarity for this game (5★ system, not 6★)
   */
  maxRarity: 5,
};
