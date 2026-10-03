// Destiny 2 manifest download + lookup.
//
// Tables are fetched from the English jsonWorldComponentContentPaths of
// https://www.bungie.net/Platform/Destiny2/Manifest/ and stored one object
// store per table in IndexedDB, keyed by hash string. The stored version is
// `<api version> <InventoryItem path>`: Response.version alone can stay
// constant while the published files change, so the component path (which
// embeds a fresh guid per publish) is the real freshness discriminator.

const BUNGIE = 'https://www.bungie.net';
const DB_NAME = 'd2-loadoutgpt-manifest';
const DB_VERSION = 1;
const VERSION_KEY = 'manifestVersion';

export const MANIFEST_TABLES = [
  'DestinyInventoryItemDefinition',
  'DestinyPlugSetDefinition',
  'DestinySandboxPerkDefinition',
  'DestinyStatDefinition',
  'DestinyArtifactDefinition',
  'DestinyEquipableItemSetDefinition',
  'DestinySocketCategoryDefinition',
  'DestinySocketTypeDefinition',
  'DestinyInventoryBucketDefinition',
  'DestinyDamageTypeDefinition',
] as const;

type TableName = (typeof MANIFEST_TABLES)[number];

// `<bungie manifest version> <inventory item table path>` — e.g.
// "244213.26.06.29.2000-1-bnet.65864 /common/destiny2_content/json/en/DestinyInventoryItemDefinition-<guid>.json"
export type ManifestVersion = string;

// ---------------------------------------------------------------------------
// Minimal definition types. Records in IndexedDB are the full definitions;
// these types declare only the fields the agent tools need.

export interface DestinyDisplayProperties {
  name: string;
  description: string;
  icon?: string;
  hasIcon?: boolean;
}

export interface DestinySocketEntry {
  socketTypeHash: number;
  singleInitialItemHash?: number;
  reusablePlugSetHash?: number;
  randomizedPlugSetHash?: number;
  plugSources?: number;
  reusablePlugItems?: { plugItemHash: number }[];
  defaultVisible?: boolean;
}

export interface DestinyInventoryItemDefinition {
  hash: number;
  index: number;
  redacted?: boolean;
  displayProperties: DestinyDisplayProperties;
  itemType?: number; // 2=Armor 3=Weapon 16=Subclass 19=Mod 28=Artifact
  itemSubType?: number;
  itemTypeDisplayName?: string;
  classType?: number; // 0=Titan 1=Hunter 2=Warlock 3=any
  itemCategoryHashes?: number[];
  inventory?: {
    bucketTypeHash?: number;
    tierType?: number; // 6=Exotic 5=Legendary
    tierTypeName?: string;
  };
  defaultDamageType?: number;
  defaultDamageTypeHash?: number;
  damageTypeHashes?: number[];
  equippingBlock?: {
    equipmentSlotTypeHash?: number;
    equipableItemSetHash?: number;
  };
  sockets?: {
    socketEntries?: DestinySocketEntry[];
    intrinsicSockets?: { plugItemHash: number; socketTypeHash?: number }[];
    socketCategories?: { socketCategoryHash: number; socketIndexes: number[] }[];
  };
  plug?: {
    plugCategoryHash?: number;
    plugCategoryIdentifier?: string;
    isDummyPlug?: boolean;
    /** Fragment sockets this aspect plug grants (aspects only). */
    energyCapacity?: { capacityValue?: number };
    /** Fragment slots this plug consumes (fragments only). */
    energyCost?: { energyCost?: number };
    insertionRules?: { failureMessage?: string }[];
  };
  perks?: { perkHash: number; perkIcon?: string; isVisible?: boolean }[];
  stats?: {
    stats?: Record<string, { statHash: number; value: number; minimum?: number; maximum?: number; displayMaximum?: number }>;
  };
  investmentStats?: { statTypeHash: number; value: number }[];
  traitIds?: string[];
  traitHashes?: number[];
  equippable?: boolean;
  nonTransferrable?: boolean;
  isAdept?: boolean;
  flavorText?: string;
}

export interface DestinyPlugSetDefinition {
  hash: number;
  displayProperties?: DestinyDisplayProperties;
  reusablePlugItems?: { plugItemHash: number; currentlyCanRoll?: boolean }[];
  isFakePlugSet?: boolean;
}

export interface DestinySandboxPerkDefinition {
  hash: number;
  displayProperties: DestinyDisplayProperties;
  isDisplayable?: boolean;
  damageType?: number;
  perkIdentifier?: string;
}

export interface DestinyStatDefinition {
  hash: number;
  displayProperties: DestinyDisplayProperties;
  statCategory?: number;
}

export interface DestinyArtifactDefinition {
  hash: number;
  displayProperties: DestinyDisplayProperties;
  tiers?: {
    tierHash: number;
    displayTitle?: string;
    minimumUnlockPointsUsedRequirement?: number;
    items: { itemHash: number }[];
  }[];
}

export interface DestinyEquipableItemSetDefinition {
  hash: number;
  displayProperties: DestinyDisplayProperties;
  setItems?: number[];
  setPerks?: { requiredSetCount: number; sandboxPerkHash: number }[];
}

export interface DestinySocketCategoryDefinition {
  hash: number;
  displayProperties: DestinyDisplayProperties;
  categoryStyle?: number; // 1=Reusable 3=Unlockable 4=Intrinsic 7=Abilities 8=Supers
}

export interface DestinySocketTypeDefinition {
  hash: number;
  socketCategoryHash?: number;
  plugWhitelist?: { categoryHash: number; categoryIdentifier?: string; reinitializationPossiblePlugHashes?: number[] }[];
  alwaysRandomizeSockets?: boolean;
}

export interface DestinyInventoryBucketDefinition {
  hash: number;
  displayProperties: DestinyDisplayProperties;
  scope?: number;
  category?: number;
}

export interface DestinyDamageTypeDefinition {
  hash: number;
  displayProperties: DestinyDisplayProperties;
  enumValue?: number;
}

// ---------------------------------------------------------------------------
// Read interface. Async lookups so tests can implement it with a plain
// in-memory fixture (e.g. `getItem: async (hash) => fixture.items[hash]`).

export interface Manifest {
  getItem(hash: number): Promise<DestinyInventoryItemDefinition | undefined>;
  getPlugSet(hash: number): Promise<DestinyPlugSetDefinition | undefined>;
  getSandboxPerk(hash: number): Promise<DestinySandboxPerkDefinition | undefined>;
  getStat(hash: number): Promise<DestinyStatDefinition | undefined>;
  getArtifact(hash: number): Promise<DestinyArtifactDefinition | undefined>;
  getItemSet(hash: number): Promise<DestinyEquipableItemSetDefinition | undefined>;
  getSocketCategory(hash: number): Promise<DestinySocketCategoryDefinition | undefined>;
  getSocketType(hash: number): Promise<DestinySocketTypeDefinition | undefined>;
  getBucket(hash: number): Promise<DestinyInventoryBucketDefinition | undefined>;
  getDamageType(hash: number): Promise<DestinyDamageTypeDefinition | undefined>;
  // All sets at once so tools can reverse-map item hash -> set (items do not
  // reliably carry equippingBlock.equipableItemSetHash; sets list setItems).
  listItemSets(): Promise<DestinyEquipableItemSetDefinition[]>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const table of MANIFEST_TABLES) req.result.createObjectStore(table);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getManifestVersion(): Promise<string | undefined> {
  const stored = await browser.storage.local.get(VERSION_KEY);
  return stored[VERSION_KEY] as string | undefined;
}

export async function ensureManifest(
  onProgress?: (p: { table: string; done: number; total: number }) => void,
): Promise<ManifestVersion> {
  const apiKey = import.meta.env.WXT_BUNGIE_API_KEY;
  const res = await fetch(`${BUNGIE}/Platform/Destiny2/Manifest/`, {
    headers: apiKey ? { 'X-API-Key': apiKey } : undefined,
  });
  const index = await res.json();
  const response = index.Response;
  if (!response?.jsonWorldComponentContentPaths?.en) {
    throw new Error(`Bungie manifest index failed: ${index.ErrorStatus ?? res.status} ${index.Message ?? ''}`);
  }
  const paths = response.jsonWorldComponentContentPaths.en as Record<string, string>;
  const version: ManifestVersion = `${response.version} ${paths['DestinyInventoryItemDefinition']}`;
  if ((await getManifestVersion()) === version) return version;

  const db = await openDb();
  try {
    let done = 0;
    for (const table of MANIFEST_TABLES) {
      const path = paths[table];
      if (!path) throw new Error(`Manifest index is missing ${table}`);
      onProgress?.({ table, done, total: MANIFEST_TABLES.length });
      const tableRes = await fetch(`${BUNGIE}${path}`);
      if (!tableRes.ok) throw new Error(`Downloading ${table} failed: HTTP ${tableRes.status}`);
      // ponytail: whole-table JSON.parse peaks at ~600MB for
      // DestinyInventoryItemDefinition (~200MB JSON). Acceptable for a first
      // version (DIM holds it too); upgrade path is stream-parsing per record
      // like DIM's json-batch-stream so the table never materializes at once.
      const records = (await tableRes.json()) as Record<string, unknown>;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(table, 'readwrite');
        const store = tx.objectStore(table);
        store.clear();
        for (const [hash, def] of Object.entries(records)) store.put(def, hash);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
      done++;
      onProgress?.({ table, done, total: MANIFEST_TABLES.length });
    }
  } finally {
    db.close();
  }
  // Only recorded once every table is in place, so a partial download
  // re-runs on the next open.
  await browser.storage.local.set({ [VERSION_KEY]: version });
  return version;
}

export async function openManifest(): Promise<Manifest> {
  const db = await openDb();
  const lookup =
    <T>(table: TableName) =>
    (hash: number) =>
      new Promise<T | undefined>((resolve, reject) => {
        const req = db.transaction(table).objectStore(table).get(String(hash));
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      });
  return {
    getItem: lookup('DestinyInventoryItemDefinition'),
    getPlugSet: lookup('DestinyPlugSetDefinition'),
    getSandboxPerk: lookup('DestinySandboxPerkDefinition'),
    getStat: lookup('DestinyStatDefinition'),
    getArtifact: lookup('DestinyArtifactDefinition'),
    getItemSet: lookup('DestinyEquipableItemSetDefinition'),
    getSocketCategory: lookup('DestinySocketCategoryDefinition'),
    getSocketType: lookup('DestinySocketTypeDefinition'),
    getBucket: lookup('DestinyInventoryBucketDefinition'),
    getDamageType: lookup('DestinyDamageTypeDefinition'),
    listItemSets: () =>
      new Promise((resolve, reject) => {
        const req = db.transaction('DestinyEquipableItemSetDefinition').objectStore('DestinyEquipableItemSetDefinition').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  };
}
