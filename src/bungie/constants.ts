// Destiny 2 enum + hash constants shared by the agent tools and tests.
// Values verified against DIM's generated enums and the Bungie OpenAPI spec
// (see docs in the notes worktree: bungie-profile.md, subclass-sockets.md).

/** DestinyClass: index is the classType value. */
export const CLASS_NAMES = ['Titan', 'Hunter', 'Warlock', 'Unknown'] as const;

/** Class name -> DestinyClass value, for tool arguments. */
export const CLASS_TYPES: Record<string, number> = {
  titan: 0,
  hunter: 1,
  warlock: 2,
};

/** DamageType enum value -> display name (3 is enum-named "Thermal" = Solar). */
export const DAMAGE_TYPE_NAMES: Record<number, string> = {
  0: 'None',
  1: 'Kinetic',
  2: 'Arc',
  3: 'Solar',
  4: 'Void',
  5: 'Raid',
  6: 'Stasis',
  7: 'Strand',
};

/** Friendly equipment-bucket names -> DestinyInventoryBucket hash. */
export const BUCKET_HASHES = {
  kinetic: 1498876634,
  energy: 2465295065,
  power: 953998645,
  helmet: 3448274439,
  arms: 3551918588,
  chest: 14239492,
  legs: 20886954,
  classitem: 1585787867,
  subclass: 3284755031,
  ghost: 4023194814,
} as const;

/** Bucket hash for a friendly name (undefined for names not in the map). */
export function bucketHashFor(name: string): number | undefined {
  return (BUCKET_HASHES as Record<string, number>)[name.toLowerCase()];
}

/** Bucket hash -> friendly name (inverse of BUCKET_HASHES). */
export const BUCKET_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(BUCKET_HASHES).map(([name, hash]) => [hash, name]),
);

/** Buckets search_items scans: everything a loadout can equip. */
export const GEAR_BUCKET_HASHES = new Set<number>([
  BUCKET_HASHES.kinetic,
  BUCKET_HASHES.energy,
  BUCKET_HASHES.power,
  BUCKET_HASHES.helmet,
  BUCKET_HASHES.arms,
  BUCKET_HASHES.chest,
  BUCKET_HASHES.legs,
  BUCKET_HASHES.classitem,
  BUCKET_HASHES.subclass,
]);

/** DestinyItemType. */
export const ITEM_TYPES = {
  armor: 2,
  weapon: 3,
  subclass: 16,
  mod: 19,
  seasonalArtifact: 28,
} as const;

/** TierType on itemDef.inventory (5 "Superior" = Legendary). */
export const TIER_TYPES = {
  legendary: 5,
  exotic: 6,
} as const;

/** ItemCategoryHashes — marks armor mod inventory items (DIM's ArmorMods). */
export const ITEM_CATEGORY_HASHES = {
  armorMods: 4104513227,
} as const;

/** ItemState bitmask flags on DestinyItemComponent.state. */
export const ITEM_STATE = {
  locked: 1,
  masterwork: 4,
  crafted: 8,
  enhanced: 32,
} as const;

/** SocketPlugSources bitmask on DestinySocketEntry.plugSources. */
export const SOCKET_PLUG_SOURCES = {
  reusablePlugItems: 2,
  profilePlugSet: 4,
  characterPlugSet: 8,
} as const;

/** StatHashes. */
export const STAT_HASHES = {
  power: 1935470627,
} as const;

// Subclass socket categories (each element has variants from its unlock quest —
// Ikora = arc/solar/void, Stranger = stasis, Neomuna = strand). Always
// membership-check against the arrays, never a single hash.
export const SUPER_SOCKET_CATEGORIES = [457473665] as const;
export const ABILITY_SOCKET_CATEGORIES = [309722977, 3218807805] as const;
export const ASPECT_SOCKET_CATEGORIES = [
  2047681910, 2140934067, 764703411, 3400923910,
] as const;
export const FRAGMENT_SOCKET_CATEGORIES = [
  271461480, 1313488945, 193371309, 2819965312,
] as const;

// Item-level socket categories whose plugs count as "major perks" for
// search_items rows: intrinsic traits (frames, exotic perks) and the
// weapon/armor perk columns.
export const PERK_SOCKET_CATEGORIES = new Set([
  3956125808, // IntrinsicTraits
  4241085061, // WeaponPerks_Reusable
  3410521964, // WeaponPerks_Consumable
  2518356196, // ArmorPerks_Reusable
  3154740035, // ArmorPerks_LargePerk
]);
