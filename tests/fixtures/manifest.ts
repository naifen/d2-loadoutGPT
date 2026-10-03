// Synthetic manifest fixture for agent-runner tests: an in-memory Manifest
// with a set-bonus armor pair, three weapon rolls, a solar Titan subclass
// (aspects/fragments incl. a locked fragment), and a seasonal artifact.
// Hash values are invented but stable; names/descriptions are the asserted
// contract for tool outputs.

import type {
  DestinyArtifactDefinition,
  DestinyEquipableItemSetDefinition,
  DestinyInventoryItemDefinition,
  Manifest,
} from '../../src/bungie/manifest';
import {
  ABILITY_SOCKET_CATEGORIES,
  ASPECT_SOCKET_CATEGORIES,
  BUCKET_HASHES,
  FRAGMENT_SOCKET_CATEGORIES,
  ITEM_TYPES,
  PERK_SOCKET_CATEGORIES,
  STAT_HASHES,
  SUPER_SOCKET_CATEGORIES,
  TIER_TYPES,
} from '../../src/bungie/constants';

const [INTRINSIC, WEAPON_PERKS, ARMOR_PERKS, WEAPON_MODS] = [
  3956125808, 4241085061, 2518356196, 2685412949,
];
const [SUPER_CAT, ABILITY_CAT, ASPECT_CAT, FRAGMENT_CAT] = [
  SUPER_SOCKET_CATEGORIES[0],
  ABILITY_SOCKET_CATEGORIES[0],
  ASPECT_SOCKET_CATEGORIES[0],
  FRAGMENT_SOCKET_CATEGORIES[0],
];

export const DT = {
  kinetic: 90101,
  solar: 90103,
  void: 90104,
  strand: 90107,
} as const;

export const HASH = {
  // Weapons
  sunpiercer: 1001,
  nightmareString: 1002,
  linecutter: 1003,
  // Armor
  aionHelmet: 2001,
  aionGauntlets: 2002,
  wildwoodVest: 2003,
  // Subclass
  sunbreaker: 3001,
  // Artifact + its perk plug items
  artifact: 6001,
  artAntiBarrier: 6101,
  artUnstoppable: 6102,
  artOverload: 6103,
  artSolarFlare: 6104,
  artArgent: 6105,
  // Subclass plugs
  supHammer: 5001,
  supBurning: 5002,
  classTowering: 5011,
  classRally: 5012,
  moveHigh: 5021,
  moveStrafe: 5022,
  meleeHammer: 5031,
  meleeStrike: 5032,
  nadeFusion: 5041,
  nadeIncendiary: 5042,
  aspectSol: 5051,
  aspectRoaring: 5052,
  aspectConsecration: 5053,
  fragTorches: 5061,
  fragSearing: 5062,
  fragWonder: 5063,
  fragAshes: 5064,
  fragLocked: 5065,
  fragEmpty: 5066,
  // Weapon plugs
  precisionFrame: 5101,
  incandescent: 5111,
  healClip: 5112,
  killClip: 5113,
  rampage: 5114,
  backupMag: 5121,
  nightmarePayload: 5131,
  // Plug sets / item set / stats / socket types
  plugSetFragments: 9501,
  plugSetAspects: 9502,
  aionSet: 97001,
  statRpm: 4284893193,
  statWeapons: 2996146975,
  statHealth: 392767087,
  perkSet2pc: 80101,
  perkSet4pc: 80102,
} as const;

const dp = (name: string, description = '') => ({ name, description });

function item(partial: Partial<DestinyInventoryItemDefinition> & { hash: number }): DestinyInventoryItemDefinition {
  return {
    index: partial.hash,
    ...partial,
    displayProperties: partial.displayProperties ?? dp('unnamed'),
  };
}

function plugItem(
  hash: number,
  name: string,
  description: string,
  plugCategoryIdentifier: string,
  extra?: DestinyInventoryItemDefinition['plug'],
): DestinyInventoryItemDefinition {
  return item({
    hash,
    displayProperties: dp(name, description),
    itemType: ITEM_TYPES.mod,
    plug: { plugCategoryIdentifier, ...extra },
  });
}

const items: Record<number, DestinyInventoryItemDefinition> = Object.fromEntries(
  [
    item({
      hash: HASH.sunpiercer,
      displayProperties: dp('Sunpiercer', 'A solar hand cannon.'),
      itemType: ITEM_TYPES.weapon,
      itemTypeDisplayName: 'Hand Cannon',
      classType: 3,
      inventory: { bucketTypeHash: BUCKET_HASHES.kinetic, tierType: TIER_TYPES.legendary },
      defaultDamageTypeHash: DT.solar,
      equippingBlock: { equipmentSlotTypeHash: BUCKET_HASHES.kinetic },
      sockets: {
        socketEntries: [
          { socketTypeHash: 92001, plugSources: 2 },
          { socketTypeHash: 92002, plugSources: 2 },
          { socketTypeHash: 92002, plugSources: 2 },
          { socketTypeHash: 92003, plugSources: 2 },
        ],
        socketCategories: [
          { socketCategoryHash: INTRINSIC, socketIndexes: [0] },
          { socketCategoryHash: WEAPON_PERKS, socketIndexes: [1, 2] },
          { socketCategoryHash: WEAPON_MODS, socketIndexes: [3] },
        ],
      },
    }),
    item({
      hash: HASH.nightmareString,
      displayProperties: dp('Nightmare String', 'Exotic void bow.'),
      itemType: ITEM_TYPES.weapon,
      itemTypeDisplayName: 'Combat Bow',
      classType: 3,
      inventory: { bucketTypeHash: BUCKET_HASHES.kinetic, tierType: TIER_TYPES.exotic },
      defaultDamageTypeHash: DT.void,
      equippingBlock: { equipmentSlotTypeHash: BUCKET_HASHES.kinetic },
      sockets: {
        socketEntries: [{ socketTypeHash: 92001, plugSources: 2 }],
        socketCategories: [{ socketCategoryHash: INTRINSIC, socketIndexes: [0] }],
      },
    }),
    item({
      hash: HASH.linecutter,
      displayProperties: dp('Linecutter', 'Strand linear fusion.'),
      itemType: ITEM_TYPES.weapon,
      itemTypeDisplayName: 'Linear Fusion Rifle',
      classType: 3,
      inventory: { bucketTypeHash: BUCKET_HASHES.power, tierType: TIER_TYPES.legendary },
      defaultDamageTypeHash: DT.strand,
      equippingBlock: { equipmentSlotTypeHash: BUCKET_HASHES.power },
    }),
    item({
      hash: HASH.aionHelmet,
      displayProperties: dp('Aion Renewal Casque', 'Helmet of the Aion Renewal set.'),
      itemType: ITEM_TYPES.armor,
      itemTypeDisplayName: 'Helmet',
      classType: 0,
      inventory: { bucketTypeHash: BUCKET_HASHES.helmet, tierType: TIER_TYPES.legendary },
      equippingBlock: { equipmentSlotTypeHash: BUCKET_HASHES.helmet },
    }),
    item({
      hash: HASH.aionGauntlets,
      displayProperties: dp('Aion Renewal Grips', 'Gauntlets of the Aion Renewal set.'),
      itemType: ITEM_TYPES.armor,
      itemTypeDisplayName: 'Gauntlets',
      classType: 0,
      inventory: { bucketTypeHash: BUCKET_HASHES.arms, tierType: TIER_TYPES.legendary },
      equippingBlock: { equipmentSlotTypeHash: BUCKET_HASHES.arms },
    }),
    item({
      hash: HASH.wildwoodVest,
      displayProperties: dp('Wildwood Vest', 'Hunter chest armor.'),
      itemType: ITEM_TYPES.armor,
      itemTypeDisplayName: 'Chest Armor',
      classType: 1,
      inventory: { bucketTypeHash: BUCKET_HASHES.chest, tierType: TIER_TYPES.legendary },
      equippingBlock: { equipmentSlotTypeHash: BUCKET_HASHES.chest },
    }),
    item({
      hash: HASH.sunbreaker,
      displayProperties: dp('Sunbreaker', 'Solar Titan subclass.'),
      itemType: ITEM_TYPES.subclass,
      itemTypeDisplayName: 'Titan Subclass',
      classType: 0,
      inventory: { bucketTypeHash: BUCKET_HASHES.subclass },
      defaultDamageTypeHash: DT.solar,
      equippingBlock: { equipmentSlotTypeHash: BUCKET_HASHES.subclass },
      sockets: {
        socketEntries: [
          { socketTypeHash: 92011, plugSources: 2 }, // super
          { socketTypeHash: 92012, plugSources: 2 }, // class ability
          { socketTypeHash: 92013, plugSources: 2 }, // movement
          { socketTypeHash: 92014, plugSources: 2 }, // melee
          { socketTypeHash: 92015, plugSources: 2 }, // grenade
          { socketTypeHash: 92016, plugSources: 8, reusablePlugSetHash: HASH.plugSetAspects }, // aspect 1
          { socketTypeHash: 92016, plugSources: 8, reusablePlugSetHash: HASH.plugSetAspects }, // aspect 2
          { socketTypeHash: 92017, plugSources: 4, reusablePlugSetHash: HASH.plugSetFragments }, // fragment 1
          { socketTypeHash: 92017, plugSources: 4, reusablePlugSetHash: HASH.plugSetFragments }, // fragment 2
          { socketTypeHash: 92017, plugSources: 4, reusablePlugSetHash: HASH.plugSetFragments }, // fragment 3
          { socketTypeHash: 92017, plugSources: 4, reusablePlugSetHash: HASH.plugSetFragments }, // fragment 4
        ],
        socketCategories: [
          { socketCategoryHash: SUPER_CAT, socketIndexes: [0] },
          { socketCategoryHash: ABILITY_CAT, socketIndexes: [1, 2, 3, 4] },
          { socketCategoryHash: ASPECT_CAT, socketIndexes: [5, 6] },
          { socketCategoryHash: FRAGMENT_CAT, socketIndexes: [7, 8, 9, 10] },
        ],
      },
    }),
    // Subclass plugs
    plugItem(HASH.supHammer, 'Hammer of Sol', 'Hurl a flaming hammer.', 'titan.solar.supers'),
    plugItem(HASH.supBurning, 'Burning Maul', 'Spin a flaming maul.', 'titan.solar.supers'),
    plugItem(HASH.classTowering, 'Towering Barricade', 'A tall barrier.', 'titan.solar.class_abilities'),
    plugItem(HASH.classRally, 'Rally Barricade', 'A small barrier that reloads.', 'titan.solar.class_abilities'),
    plugItem(HASH.moveHigh, 'High Lift', 'Jump high.', 'titan.solar.movement'),
    plugItem(HASH.moveStrafe, 'Strafe Lift', 'Jump with lateral control.', 'titan.solar.movement'),
    plugItem(HASH.meleeHammer, 'Throwing Hammer', 'Throw a hammer that returns.', 'titan.solar.melee'),
    plugItem(HASH.meleeStrike, 'Hammer Strike', 'A scorching melee.', 'titan.solar.melee'),
    plugItem(HASH.nadeFusion, 'Fusion Grenade', 'A sticky grenade.', 'shared.solar.grenades'),
    plugItem(HASH.nadeIncendiary, 'Incendiary Grenade', 'A burning grenade.', 'shared.solar.grenades'),
    plugItem(HASH.aspectSol, 'Sol Invictus', 'Solar abilities create Sunspots.', 'titan.solar.aspects', {
      energyCapacity: { capacityValue: 3 },
    }),
    plugItem(HASH.aspectRoaring, 'Roaring Flames', 'Solar ability kills build stacks.', 'titan.solar.aspects', {
      energyCapacity: { capacityValue: 4 },
    }),
    plugItem(HASH.aspectConsecration, 'Consecration', 'Slam from the air.', 'titan.solar.aspects', {
      energyCapacity: { capacityValue: 3 },
    }),
    plugItem(HASH.fragTorches, 'Ember of Torches', 'Powered melee grants Radiant.', 'shared.solar.fragments', {
      energyCost: { energyCost: 1 },
    }),
    plugItem(HASH.fragSearing, 'Ember of Searing', 'Defeating scorched targets grants melee energy.', 'shared.solar.fragments', {
      energyCost: { energyCost: 1 },
    }),
    plugItem(HASH.fragWonder, 'Ember of Wonder', 'Ignition kills make orbs.', 'shared.solar.fragments', {
      energyCost: { energyCost: 2 },
    }),
    plugItem(HASH.fragAshes, 'Ember of Ashes', 'More scorch stacks.', 'shared.solar.fragments', {
      energyCost: { energyCost: 1 },
    }),
    plugItem(HASH.fragLocked, 'Ember of Secrets', 'A locked fragment.', 'shared.solar.fragments', {
      energyCost: { energyCost: 1 },
    }),
    plugItem(HASH.fragEmpty, 'Empty Fragment Socket', 'Nothing slotted.', 'shared.solar.fragments', {
      isDummyPlug: true,
    }),
    // Weapon plugs
    plugItem(HASH.precisionFrame, 'Precision Frame', 'Predictable vertical recoil.', 'v400.weapons.frames'),
    plugItem(HASH.incandescent, 'Incandescent', 'Kills apply scorch to nearby targets.', 'v400.weapons.perks'),
    plugItem(HASH.healClip, 'Heal Clip', 'Reloading after a kill heals you.', 'v400.weapons.perks'),
    plugItem(HASH.killClip, 'Kill Clip', 'Reloading after a kill boosts damage.', 'v400.weapons.perks'),
    plugItem(HASH.rampage, 'Rampage', 'Kills stack damage.', 'v400.weapons.perks'),
    plugItem(HASH.backupMag, 'Backup Mag', 'Bigger magazine.', 'v400.weapons.mods'),
    plugItem(HASH.nightmarePayload, 'Nightmare Payload', 'Exotic intrinsic perk.', 'v400.weapons.intrinsics'),
    // Artifact perk items
    item({ hash: HASH.artAntiBarrier, displayProperties: dp('Anti-Barrier Rounds', 'Pierce Barrier champions.'), itemType: ITEM_TYPES.mod }),
    item({ hash: HASH.artUnstoppable, displayProperties: dp('Unstoppable Burst', 'Stagger Unstoppable champions.'), itemType: ITEM_TYPES.mod }),
    item({ hash: HASH.artOverload, displayProperties: dp('Overload Volley', 'Disrupt Overload champions.'), itemType: ITEM_TYPES.mod }),
    item({ hash: HASH.artSolarFlare, displayProperties: dp('Solar Flare', 'Solar explosions scorch.'), itemType: ITEM_TYPES.mod }),
    item({ hash: HASH.artArgent, displayProperties: dp('Argent Ordnance', 'Rocket launchers deal bonus damage.'), itemType: ITEM_TYPES.mod }),
  ].map((d) => [d.hash, d]),
);

const artifact: DestinyArtifactDefinition = {
  hash: HASH.artifact,
  displayProperties: dp('Tablet of Ruin', 'Seasonal artifact.'),
  tiers: [
    { tierHash: 60111, displayTitle: 'Column 1', items: [{ itemHash: HASH.artAntiBarrier }, { itemHash: HASH.artUnstoppable }] },
    { tierHash: 60112, displayTitle: 'Column 2', items: [{ itemHash: HASH.artOverload }, { itemHash: HASH.artSolarFlare }] },
    { tierHash: 60113, displayTitle: 'Column 3', items: [{ itemHash: HASH.artArgent }] },
  ],
};

const aionSet: DestinyEquipableItemSetDefinition = {
  hash: HASH.aionSet,
  displayProperties: dp('Aion Renewal', 'Aion Renewal armor set.'),
  setItems: [HASH.aionHelmet, HASH.aionGauntlets],
  setPerks: [
    { requiredSetCount: 2, sandboxPerkHash: HASH.perkSet2pc },
    { requiredSetCount: 4, sandboxPerkHash: HASH.perkSet4pc },
  ],
};

const record = <T extends { hash: number }>(defs: T[]) =>
  Object.fromEntries(defs.map((d) => [d.hash, d])) as Record<number, T>;

const socketCategories = record([
  { hash: INTRINSIC, displayProperties: dp('Intrinsic Traits'), categoryStyle: 4 },
  { hash: WEAPON_PERKS, displayProperties: dp('Weapon Perks'), categoryStyle: 1 },
  { hash: ARMOR_PERKS, displayProperties: dp('Armor Perks'), categoryStyle: 1 },
  { hash: WEAPON_MODS, displayProperties: dp('Weapon Mods'), categoryStyle: 2 },
  { hash: SUPER_CAT, displayProperties: dp('Super'), categoryStyle: 8 },
  { hash: ABILITY_CAT, displayProperties: dp('Abilities'), categoryStyle: 7 },
  { hash: ASPECT_CAT, displayProperties: dp('Aspects'), categoryStyle: 7 },
  { hash: FRAGMENT_CAT, displayProperties: dp('Fragments'), categoryStyle: 7 },
]);

const socketTypes = record([
  { hash: 92011, plugWhitelist: [{ categoryHash: 0, categoryIdentifier: 'titan.solar.supers' }] },
  { hash: 92012, plugWhitelist: [{ categoryHash: 0, categoryIdentifier: 'titan.solar.class_abilities' }] },
  { hash: 92013, plugWhitelist: [{ categoryHash: 0, categoryIdentifier: 'titan.solar.movement' }] },
  { hash: 92014, plugWhitelist: [{ categoryHash: 0, categoryIdentifier: 'titan.solar.melee' }] },
  { hash: 92015, plugWhitelist: [{ categoryHash: 0, categoryIdentifier: 'shared.solar.grenades' }] },
  { hash: 92016, plugWhitelist: [{ categoryHash: 0, categoryIdentifier: 'titan.solar.aspects' }] },
  { hash: 92017, plugWhitelist: [{ categoryHash: 0, categoryIdentifier: 'shared.solar.fragments' }] },
]);

const stats = record([
  { hash: STAT_HASHES.power, displayProperties: dp('Power') },
  { hash: HASH.statRpm, displayProperties: dp('Rounds Per Minute') },
  { hash: HASH.statWeapons, displayProperties: dp('Weapons') },
  { hash: HASH.statHealth, displayProperties: dp('Health') },
]);

const damageTypes = record([
  { hash: DT.kinetic, displayProperties: dp('Kinetic'), enumValue: 1 },
  { hash: DT.solar, displayProperties: dp('Solar'), enumValue: 3 },
  { hash: DT.void, displayProperties: dp('Void'), enumValue: 4 },
  { hash: DT.strand, displayProperties: dp('Strand'), enumValue: 7 },
]);

const sandboxPerks = record([
  { hash: HASH.perkSet2pc, displayProperties: dp('Aion Renewal: Renewal', '2pc: picking up an Orb reloads weapons.') },
  { hash: HASH.perkSet4pc, displayProperties: dp('Aion Renewal: Grace', '4pc: Orbs also grant ability energy.') },
]);

const plugSets = record([
  {
    hash: HASH.plugSetFragments,
    reusablePlugItems: [
      { plugItemHash: HASH.fragTorches, currentlyCanRoll: true },
      { plugItemHash: HASH.fragSearing, currentlyCanRoll: true },
      { plugItemHash: HASH.fragWonder, currentlyCanRoll: true },
      { plugItemHash: HASH.fragAshes, currentlyCanRoll: true },
    ],
  },
  {
    hash: HASH.plugSetAspects,
    reusablePlugItems: [
      { plugItemHash: HASH.aspectSol, currentlyCanRoll: true },
      { plugItemHash: HASH.aspectRoaring, currentlyCanRoll: true },
      { plugItemHash: HASH.aspectConsecration, currentlyCanRoll: true },
    ],
  },
]);

const lookup = <T>(table: Record<number, T>) => async (hash: number) => table[hash];

export function createFixtureManifest(): Manifest {
  return {
    getItem: lookup(items),
    getPlugSet: lookup(plugSets),
    getSandboxPerk: lookup(sandboxPerks),
    getStat: lookup(stats),
    getArtifact: async (hash) => (hash === artifact.hash ? artifact : undefined),
    getItemSet: lookup(record([aionSet])),
    getSocketCategory: lookup(socketCategories),
    getSocketType: lookup(socketTypes),
    getBucket: async () => undefined,
    getDamageType: lookup(damageTypes),
    listItemSets: async () => [aionSet],
  };
}
