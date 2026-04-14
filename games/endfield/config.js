module.exports = {
  id: 'endfield',
  displayName: 'Arknights: Endfield',

  // Default banner→featured mappings (seeded into DB on first run)
  // Character banners: pool_name → featured operator
  // Weapon banners: pool_name (issue name) → featured weapon
  defaultBanners: {
    // Character banners
    'Scars of the Forge': 'Laevatain',
    'The Floaty Messenger': 'Gilberta',
    'Hues of Passion': 'Yvonne',
    "River's Daughter": 'Tangtang',
    'Wolf Pearl': 'Rossi',
    'Thunder of Renewal': 'Zhuang Fangyi',
    // Featured weapon banners
    'Smelting Forge Issue': 'Forgeborn Scathe',
    'Express Delivery Issue': 'Delivery Guaranteed',
    'Graffiti Issue': 'Artzy Tyrannical',
    'Budding Anew Issue': "Brigand's Calling",
    'Scarlet Pearl Issue': 'Lupine Scarlet',
    'Drifting Raft Issue': 'Lone Barge',
    // Permanent weapon banners
    'Solid Ice Issue': 'Khravengger',
    'Cosmic Voice Issue': 'Dreams of the Starry Beach',
    'Far Expedition Issue': 'Never Rest',
    'Rising Mount Issue': 'Mountain Bearer',
    'Thunderous Peal Issue': 'Thunderberge',
  },

  standardCharacters: ['Ardelia', 'Pogranichnik', 'Last Rite', 'Ember', 'Lifeng'],

  // Banner type definitions
  bannerTypes: {
    featured: {
      label: 'Featured',
      hardPity: 80,
      softPity: 65,
      has5050: true,
      guaranteesAfterLoss: false, // losing 50/50 does NOT protect next pull (spark system instead)
      hasSpark: true,             // 120-pull featured guarantee per banner
      guaranteePity: 120,
      matchPoolId: (pid) => pid.startsWith('special'),
    },
    standard: {
      label: 'Standard',
      hardPity: 80,
      softPity: 65,
      has5050: false,
      guaranteesAfterLoss: false,
      hasSpark: false,
      guaranteePity: 300,
      matchPoolId: (pid) => pid === 'standard',
    },
    beginner: {
      label: 'Beginner',
      hardPity: 40,
      softPity: null,
      has5050: false,
      guaranteesAfterLoss: false,
      hasSpark: false,
      guaranteePity: 40,
      matchPoolId: (pid) => pid.includes('beginner') || pid.includes('newbie'),
    },
    weapon: {
      label: 'Weapons',
      hardPity: 80,
      softPity: null,
      has5050: true,
      guaranteesAfterLoss: true, // losing once guarantees next 6★ is the featured weapon
      hasSpark: false,
      isWeapon: true,
    },
  },

  /**
   * Classify a pull's banner type.
   * @param {Object} pull - raw pull with pool_id, is_weapon
   * @returns {string} banner type key
   */
  classifyPull(pull) {
    if (pull.is_weapon) return 'weapon';
    const pid = (pull.pool_id || '').toLowerCase();
    for (const [key, bt] of Object.entries(this.bannerTypes)) {
      if (bt.matchPoolId && bt.matchPoolId(pid)) return key;
    }
    return 'featured'; // fallback
  },
};
