// The five read-only agent tools (spec #1 "Tool contract"): get_characters,
// search_items, get_item, list_subclass_options, get_artifact. Each tool is an
// OpenAI `tools` schema plus an executor that runs against the injected
// ProfileSnapshot + Manifest — no network, no IndexedDB, no browser APIs.
//
// Output rows are deliberately compact: every row lands in the model's
// context window. Ticket #7 adds the terminal propose_loadout tool by
// appending to AGENT_TOOLS — the runner dispatches through executeAgentTool.

import {
  ABILITY_SOCKET_CATEGORIES,
  ASPECT_SOCKET_CATEGORIES,
  BUCKET_HASHES,
  BUCKET_NAMES,
  bucketHashFor,
  CLASS_TYPES,
  DAMAGE_TYPE_NAMES,
  FRAGMENT_SOCKET_CATEGORIES,
  GEAR_BUCKET_HASHES,
  ITEM_STATE,
  ITEM_TYPES,
  PERK_SOCKET_CATEGORIES,
  SOCKET_PLUG_SOURCES,
  STAT_HASHES,
  SUPER_SOCKET_CATEGORIES,
  TIER_TYPES,
} from '../bungie/constants';
import type {
  DestinyInventoryItemDefinition,
  DestinySocketEntry,
  Manifest,
} from '../bungie/manifest';
import {
  charactersFromSnapshot,
  type DestinyItemComponent,
  type DestinyItemPlug,
  type ProfileSnapshot,
} from '../bungie/profile';
import type { ToolSchema } from './transport';

// ---------------------------------------------------------------------------
// Dispatch plumbing

export interface AgentToolContext {
  snapshot: ProfileSnapshot;
  manifest: Manifest;
}

export interface ToolExecution {
  /** JSON-serialized and sent back to the model as the tool result. */
  result: unknown;
  /**
   * Set by a terminal tool (propose_loadout, #7): the runner stops looping
   * and returns { status, toolOutput: output }.
   */
  terminal?: { status: string; output?: unknown };
}

export interface AgentTool {
  schema: ToolSchema;
  execute(args: Record<string, unknown>, ctx: AgentToolContext): Promise<ToolExecution>;
}

const errorResult = (message: string): ToolExecution => ({ result: { error: message } });

/** Look up a tool by model-facing name and run it; never throws. */
export async function executeAgentTool(
  name: string,
  argsJson: string,
  ctx: AgentToolContext,
): Promise<ToolExecution> {
  const tool = AGENT_TOOLS.find((t) => t.schema.function.name === name);
  if (!tool) {
    return errorResult(`Unknown tool "${name}". Available: ${AGENT_TOOLS.map((t) => t.schema.function.name).join(', ')}.`);
  }
  let args: Record<string, unknown>;
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return errorResult(`Malformed arguments for ${name}: expected a JSON object.`);
  }
  try {
    return await tool.execute(args, ctx);
  } catch (e) {
    return errorResult(`${name} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers

interface OwnedItem {
  item: DestinyItemComponent;
  /** 'vault' or a characterId. */
  owner: string;
  equipped: boolean;
}

/** Every owned item: vault + each character's inventory and equipment. */
function collectItems(snapshot: ProfileSnapshot): OwnedItem[] {
  const out: OwnedItem[] = [];
  for (const item of snapshot.profileInventory?.data.items ?? []) {
    out.push({ item, owner: 'vault', equipped: false });
  }
  for (const [charId, inv] of Object.entries(snapshot.characterInventories?.data ?? {})) {
    for (const item of inv.items) out.push({ item, owner: charId, equipped: false });
  }
  for (const [charId, eq] of Object.entries(snapshot.characterEquipment?.data ?? {})) {
    for (const item of eq.items) out.push({ item, owner: charId, equipped: true });
  }
  return out;
}

/**
 * The equipment slot an item belongs to. The definition's equip slot wins —
 * items sitting in the vault's General bucket still report their real slot.
 */
function slotBucket(item: DestinyItemComponent, def?: DestinyInventoryItemDefinition): number {
  return (
    def?.equippingBlock?.equipmentSlotTypeHash ?? def?.inventory?.bucketTypeHash ?? item.bucketHash
  );
}

async function elementName(
  ctx: AgentToolContext,
  item: DestinyItemComponent,
  def?: DestinyInventoryItemDefinition,
): Promise<string | null> {
  const hash =
    ctx.snapshot.itemComponents?.instances?.data[item.itemInstanceId ?? '']?.damageTypeHash ??
    def?.defaultDamageTypeHash;
  if (hash) {
    const dt = await ctx.manifest.getDamageType(hash);
    if (dt?.displayProperties.name) return dt.displayProperties.name;
  }
  const enumValue =
    ctx.snapshot.itemComponents?.instances?.data[item.itemInstanceId ?? '']?.damageType ??
    def?.defaultDamageType;
  return enumValue != null ? (DAMAGE_TYPE_NAMES[enumValue] ?? null) : null;
}

function power(ctx: AgentToolContext, item: DestinyItemComponent): number | undefined {
  const stat = ctx.snapshot.itemComponents?.instances?.data[item.itemInstanceId ?? '']?.primaryStat;
  return stat?.statHash === STAT_HASHES.power ? stat.value : undefined;
}

/** Socket indexes whose plugs count as "major perks" for compact rows. */
function perkSocketIndexes(def?: DestinyInventoryItemDefinition): number[] {
  return (def?.sockets?.socketCategories ?? [])
    .filter((c) => PERK_SOCKET_CATEGORIES.has(c.socketCategoryHash))
    .flatMap((c) => c.socketIndexes);
}

async function plugSummary(ctx: AgentToolContext, hash: number) {
  const def = await ctx.manifest.getItem(hash);
  if (!def || def.plug?.isDummyPlug) return undefined;
  return { hash, name: def.displayProperties.name, description: def.displayProperties.description };
}

/**
 * Options a socket exposes, from the live unlocked sources only:
 * itemComponents.reusablePlugs plus profile/character plugSets when
 * socketEntry.plugSources says so. `includeStatic` additionally falls back to
 * the definition's reusablePlugItems/plugSet/singleInitialItemHash (possible
 * rolls, not proven-unlocked) — used by get_item, not list_subclass_options.
 */
async function socketOptions(
  ctx: AgentToolContext,
  owned: OwnedItem,
  socketIndex: number,
  entry: DestinySocketEntry | undefined,
  includeStatic: boolean,
): Promise<{ hash: number; name: string; description: string; unlocked: boolean; equipped: boolean; cost?: number }[]> {
  const iid = owned.item.itemInstanceId ?? '';
  const plugged = ctx.snapshot.itemComponents?.sockets?.data[iid]?.sockets[socketIndex]?.plugHash;
  const candidates = new Map<number, DestinyItemPlug>();

  const live =
    ctx.snapshot.itemComponents?.reusablePlugs?.data[iid]?.plugs[String(socketIndex)] ?? [];
  for (const p of live) candidates.set(p.plugItemHash, p);

  const plugSetHash = entry?.reusablePlugSetHash ?? entry?.randomizedPlugSetHash;
  const sources = entry?.plugSources ?? 0;
  if (plugSetHash && sources & SOCKET_PLUG_SOURCES.profilePlugSet) {
    for (const p of ctx.snapshot.profilePlugSets?.data.plugs[String(plugSetHash)] ?? []) {
      candidates.set(p.plugItemHash, p);
    }
  }
  if (plugSetHash && sources & SOCKET_PLUG_SOURCES.characterPlugSet) {
    for (const p of ctx.snapshot.characterPlugSets?.data[owned.owner]?.plugs[String(plugSetHash)] ?? []) {
      candidates.set(p.plugItemHash, p);
    }
  }

  if (includeStatic && candidates.size === 0) {
    const asPlug = (plugItemHash: number): DestinyItemPlug => ({
      plugItemHash,
      canInsert: true,
      enabled: true,
    });
    for (const p of entry?.reusablePlugItems ?? []) {
      candidates.set(p.plugItemHash, asPlug(p.plugItemHash));
    }
    if (plugSetHash) {
      const plugSet = await ctx.manifest.getPlugSet(plugSetHash);
      for (const p of plugSet?.reusablePlugItems ?? []) {
        if (p.currentlyCanRoll !== false) candidates.set(p.plugItemHash, asPlug(p.plugItemHash));
      }
    }
    if (entry?.singleInitialItemHash != null) {
      candidates.set(entry.singleInitialItemHash, asPlug(entry.singleInitialItemHash));
    }
  }

  const out = [];
  for (const p of candidates.values()) {
    const def = await ctx.manifest.getItem(p.plugItemHash);
    if (!def || def.plug?.isDummyPlug) continue;
    out.push({
      hash: p.plugItemHash,
      name: def.displayProperties.name,
      description: def.displayProperties.description,
      unlocked: p.enabled || p.canInsert,
      equipped: p.plugItemHash === plugged,
      ...(def.plug?.energyCost?.energyCost != null ? { cost: def.plug.energyCost.energyCost } : {}),
    });
  }
  return out;
}

/** Which socketCategoryHash a socket index belongs to on this definition. */
function socketCategoryOf(def: DestinyInventoryItemDefinition | undefined, index: number): number | undefined {
  return def?.sockets?.socketCategories?.find((c) => c.socketIndexes.includes(index))?.socketCategoryHash;
}

async function socketCategoryName(ctx: AgentToolContext, hash: number | undefined): Promise<string | number | undefined> {
  if (hash == null) return undefined;
  return (await ctx.manifest.getSocketCategory(hash))?.displayProperties.name ?? hash;
}

/** itemHash -> equipable item set, via the set's setItems (equippingBlock.equipableItemSetHash is unreliable). */
async function itemSetFor(ctx: AgentToolContext, itemHash: number) {
  for (const set of await ctx.manifest.listItemSets()) {
    if (set.setItems?.includes(itemHash)) return set;
  }
  return undefined;
}

async function setBonusDetail(ctx: AgentToolContext, itemHash: number) {
  const set = await itemSetFor(ctx, itemHash);
  if (!set) return undefined;
  const perks = [];
  for (const sp of set.setPerks ?? []) {
    const perk = await ctx.manifest.getSandboxPerk(sp.sandboxPerkHash);
    perks.push({
      requiredSetCount: sp.requiredSetCount,
      name: perk?.displayProperties.name ?? `perk ${sp.sandboxPerkHash}`,
      description: perk?.displayProperties.description ?? '',
    });
  }
  return { name: set.displayProperties.name, perks };
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

// ---------------------------------------------------------------------------
// get_characters

const getCharacters: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'get_characters',
      description: "List the player's Destiny 2 characters: id, class, light level, emblem.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  execute: async (_args, ctx) => ({
    result: {
      characters: charactersFromSnapshot(ctx.snapshot).map((c) => ({
        id: c.id,
        class: c.className,
        light: c.light,
        emblem: c.emblemPath,
      })),
    },
  }),
};

// ---------------------------------------------------------------------------
// search_items

const SEARCH_LIMIT_DEFAULT = 50;
const SEARCH_LIMIT_MAX = 100;

const searchItems: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'search_items',
      description:
        "Search the player's gear — vault plus every character's inventory and equipment, subclasses included. Filters combine with AND. Returns compact rows; use get_item on an instanceId for full detail.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          classType: {
            type: 'string',
            enum: ['titan', 'hunter', 'warlock'],
            description: 'Only items this class can equip (class-agnostic gear still matches).',
          },
          bucket: {
            type: 'string',
            enum: ['kinetic', 'energy', 'power', 'helmet', 'arms', 'chest', 'legs', 'classitem', 'subclass'],
            description: 'Equipment slot.',
          },
          tier: { type: 'string', enum: ['exotic', 'legendary'], description: 'Rarity tier.' },
          damageType: {
            type: 'string',
            description: 'Damage element name: kinetic, arc, solar, void, stasis, strand — or the subclass element (e.g. prismatic).',
          },
          name: { type: 'string', description: 'Substring match on the item name.' },
          perk: {
            type: 'string',
            description: 'Substring match on perk names — the plugged roll plus selectable options in perk sockets.',
          },
          limit: { type: 'integer', description: `Max rows (default ${SEARCH_LIMIT_DEFAULT}, max ${SEARCH_LIMIT_MAX}).` },
        },
      },
    },
  },
  execute: async (args, ctx) => {
    const classFilter = str(args.classType)?.toLowerCase();
    const bucketFilter = str(args.bucket)?.toLowerCase();
    const tierFilter = str(args.tier)?.toLowerCase();
    const damageFilter = str(args.damageType)?.toLowerCase();
    const nameFilter = str(args.name)?.toLowerCase();
    const perkFilter = str(args.perk)?.toLowerCase();
    const limit = Math.min(
      SEARCH_LIMIT_MAX,
      Math.max(1, typeof args.limit === 'number' ? args.limit : SEARCH_LIMIT_DEFAULT),
    );

    const rows = [];
    let total = 0;
    for (const owned of collectItems(ctx.snapshot)) {
      const { item } = owned;
      if (!item.itemInstanceId) continue;
      const def = await ctx.manifest.getItem(item.itemHash);
      if (!def) continue;
      const bucket = slotBucket(item, def);
      if (!GEAR_BUCKET_HASHES.has(bucket)) continue;

      if (classFilter != null) {
        const wanted = CLASS_TYPES[classFilter];
        if (wanted == null || (def.classType !== wanted && def.classType !== 3 && def.classType != null)) continue;
      }
      if (bucketFilter != null && bucket !== bucketHashFor(bucketFilter)) continue;
      if (tierFilter != null && def.inventory?.tierType !== TIER_TYPES[tierFilter as 'exotic' | 'legendary']) continue;

      const element = await elementName(ctx, item, def);
      if (damageFilter != null && element?.toLowerCase() !== damageFilter) continue;
      const name = def.displayProperties.name ?? '';
      if (nameFilter != null && !name.toLowerCase().includes(nameFilter)) continue;

      // Perk names: the plugged roll (row display + filter) plus selectable
      // options in perk sockets (filter only).
      const sockets = ctx.snapshot.itemComponents?.sockets?.data[item.itemInstanceId]?.sockets ?? [];
      const pluggedPerkHashes = new Set<number>();
      const allPerkHashes = new Set<number>();
      for (const i of perkSocketIndexes(def)) {
        const plugged = sockets[i]?.plugHash;
        if (plugged != null) {
          pluggedPerkHashes.add(plugged);
          allPerkHashes.add(plugged);
        }
        for (const p of ctx.snapshot.itemComponents?.reusablePlugs?.data[item.itemInstanceId]?.plugs[String(i)] ?? []) {
          allPerkHashes.add(p.plugItemHash);
        }
      }
      const pluggedPerkNames: string[] = [];
      const allPerkNames: string[] = [];
      for (const hash of allPerkHashes) {
        const summary = await plugSummary(ctx, hash);
        if (!summary) continue;
        allPerkNames.push(summary.name);
        if (pluggedPerkHashes.has(hash)) pluggedPerkNames.push(summary.name);
      }
      if (perkFilter != null && !allPerkNames.some((n) => n.toLowerCase().includes(perkFilter))) continue;

      total++;
      if (rows.length < limit) {
        const set = await itemSetFor(ctx, item.itemHash);
        rows.push({
          instanceId: item.itemInstanceId,
          name,
          itemType: def.itemTypeDisplayName ?? def.itemType,
          element,
          power: power(ctx, item) ?? null,
          exotic: def.inventory?.tierType === TIER_TYPES.exotic,
          ...(set ? { setBonusName: set.displayProperties.name } : {}),
          perkNames: pluggedPerkNames,
          bucket: BUCKET_NAMES[bucket] ?? bucket,
          owner: owned.owner,
          equipped: owned.equipped,
        });
      }
    }
    return { result: { items: rows, total } };
  },
};

// ---------------------------------------------------------------------------
// get_item

const getItem: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'get_item',
      description:
        'Full detail for one owned item instance: every visible socket with its plugged and selectable plugs (names + in-game descriptions), stats by name, set-bonus perks, masterwork, power.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          instanceId: { type: 'string', description: 'Item instance id from search_items.' },
        },
        required: ['instanceId'],
      },
    },
  },
  execute: async (args, ctx) => {
    const iid = str(args.instanceId);
    if (!iid) return errorResult('instanceId is required.');
    const owned = collectItems(ctx.snapshot).find((o) => o.item.itemInstanceId === iid);
    if (!owned) return errorResult(`No item with instanceId "${iid}" in the profile snapshot.`);
    const def = await ctx.manifest.getItem(owned.item.itemHash);

    // Stats: the item's rolled instance stats when present, else def baselines.
    const instanceStats = ctx.snapshot.itemComponents?.stats?.data[iid]?.stats;
    const statEntries: Record<string, { value: number }> = {};
    if (instanceStats && Object.keys(instanceStats).length) {
      for (const s of Object.values(instanceStats)) statEntries[String(s.statHash)] = { value: s.value };
    } else {
      for (const s of Object.values(def?.stats?.stats ?? {})) statEntries[String(s.statHash)] = { value: s.value };
    }
    const stats: Record<string, number> = {};
    for (const [hash, s] of Object.entries(statEntries)) {
      const statDef = await ctx.manifest.getStat(Number(hash));
      if (statDef?.displayProperties.name) stats[statDef.displayProperties.name] = s.value;
    }

    const socketStates = ctx.snapshot.itemComponents?.sockets?.data[iid]?.sockets ?? [];
    const sockets = [];
    for (let i = 0; i < socketStates.length; i++) {
      const state = socketStates[i]!;
      if (!state.isVisible) continue;
      const entry = def?.sockets?.socketEntries?.[i];
      const plugged = state.plugHash != null ? await plugSummary(ctx, state.plugHash) : undefined;
      const options = await socketOptions(ctx, owned, i, entry, /* includeStatic */ true);
      sockets.push({
        index: i,
        category: await socketCategoryName(ctx, socketCategoryOf(def, i)),
        plugged: plugged ?? (state.plugHash != null ? { hash: state.plugHash } : null),
        isEnabled: state.isEnabled,
        options,
      });
    }

    return {
      result: {
        instanceId: iid,
        itemHash: owned.item.itemHash,
        name: def?.displayProperties.name ?? `item ${owned.item.itemHash}`,
        itemType: def?.itemTypeDisplayName ?? def?.itemType ?? null,
        element: await elementName(ctx, owned.item, def),
        power: power(ctx, owned.item) ?? null,
        exotic: def?.inventory?.tierType === TIER_TYPES.exotic,
        masterwork: (owned.item.state & ITEM_STATE.masterwork) !== 0,
        owner: owned.owner,
        equipped: owned.equipped,
        ...(await setBonusDetail(ctx, owned.item.itemHash).then((s) => (s ? { setBonus: s } : {}))),
        stats,
        sockets,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// list_subclass_options

type SubclassGroup = 'super' | 'classAbility' | 'movement' | 'melee' | 'grenade' | 'aspects' | 'fragments';

interface SubclassOption {
  hash: number;
  name: string;
  description: string;
  unlocked: boolean;
  equipped: boolean;
  socketIndex: number;
  /** Fragment slot cost (fragments only). */
  cost?: number;
}

const SUPER_CATS = new Set<number>(SUPER_SOCKET_CATEGORIES);
const ABILITY_CATS = new Set<number>(ABILITY_SOCKET_CATEGORIES);
const ASPECT_CATS = new Set<number>(ASPECT_SOCKET_CATEGORIES);
const FRAGMENT_CATS = new Set<number>(FRAGMENT_SOCKET_CATEGORIES);

const IDENTIFIER_GROUPS: Record<string, SubclassGroup> = {
  supers: 'super',
  class_abilities: 'classAbility',
  movement: 'movement',
  melee: 'melee',
  grenades: 'grenade',
  aspects: 'aspects',
  fragments: 'fragments',
};

const identifierSuffix = (identifier?: string) => identifier?.split('.').pop() ?? '';

/** Group an ability-category socket by a plug's plugCategoryIdentifier. */
async function abilityGroup(
  ctx: AgentToolContext,
  entry: DestinySocketEntry | undefined,
  candidates: { hash: number }[],
): Promise<SubclassGroup | undefined> {
  for (const c of candidates) {
    const def = await ctx.manifest.getItem(c.hash);
    const group = IDENTIFIER_GROUPS[identifierSuffix(def?.plug?.plugCategoryIdentifier)];
    if (group) return group;
  }
  const socketType = entry?.socketTypeHash != null ? await ctx.manifest.getSocketType(entry.socketTypeHash) : undefined;
  for (const w of socketType?.plugWhitelist ?? []) {
    const group = IDENTIFIER_GROUPS[identifierSuffix(w.categoryIdentifier)];
    if (group) return group;
  }
  return undefined;
}

const listSubclassOptions: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'list_subclass_options',
      description:
        "The player's unlocked options on a subclass: super, class/movement/melee/grenade abilities, Aspects and Fragments — each with plug hash, name, in-game description, socket index and equipped flag. Includes aspect slot count and fragment capacity math. Pass the subclass element (arc/solar/void/stasis/strand/prismatic).",
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          classType: { type: 'string', enum: ['titan', 'hunter', 'warlock'] },
          damageType: { type: 'string', description: 'Subclass element name, e.g. solar or prismatic.' },
        },
        required: ['classType', 'damageType'],
      },
    },
  },
  execute: async (args, ctx) => {
    const classVal = CLASS_TYPES[str(args.classType)?.toLowerCase() ?? ''];
    const elementWanted = str(args.damageType)?.toLowerCase();
    if (classVal == null || !elementWanted) {
      return errorResult('classType (titan|hunter|warlock) and damageType are required.');
    }

    let match: { owned: OwnedItem; def: DestinyInventoryItemDefinition; element: string | null } | undefined;
    for (const owned of collectItems(ctx.snapshot)) {
      const def = await ctx.manifest.getItem(owned.item.itemHash);
      if (!def || (def.itemType !== ITEM_TYPES.subclass && slotBucket(owned.item, def) !== BUCKET_HASHES.subclass)) continue;
      if (def.classType !== classVal) continue;
      const element = await elementName(ctx, owned.item, def);
      if (element?.toLowerCase() !== elementWanted) continue;
      if (!match || owned.equipped) match = { owned, def, element };
      if (owned.equipped) break;
    }
    if (!match) {
      return errorResult(`No ${elementWanted} ${str(args.classType)} subclass found on any character.`);
    }
    const { owned, def } = match;

    const groups: Record<SubclassGroup, SubclassOption[]> = {
      super: [],
      classAbility: [],
      movement: [],
      melee: [],
      grenade: [],
      aspects: [],
      fragments: [],
    };
    const socketStates = ctx.snapshot.itemComponents?.sockets?.data[owned.item.itemInstanceId ?? '']?.sockets ?? [];
    const aspectIndexes: number[] = [];
    const fragmentIndexes: number[] = [];

    for (let i = 0; i < (def.sockets?.socketEntries?.length ?? socketStates.length); i++) {
      const entry = def.sockets?.socketEntries?.[i];
      const cat = socketCategoryOf(def, i);
      let group: SubclassGroup | undefined;
      if (cat != null && SUPER_CATS.has(cat)) group = 'super';
      else if (cat != null && ASPECT_CATS.has(cat)) { group = 'aspects'; aspectIndexes.push(i); }
      else if (cat != null && FRAGMENT_CATS.has(cat)) { group = 'fragments'; fragmentIndexes.push(i); }
      else if (cat != null && ABILITY_CATS.has(cat)) group = undefined; // resolved below

      const options = await socketOptions(ctx, owned, i, entry, /* includeStatic */ false);
      if (cat != null && ABILITY_CATS.has(cat)) {
        group = await abilityGroup(ctx, entry, [
          ...(socketStates[i]?.plugHash != null ? [{ hash: socketStates[i]!.plugHash! }] : []),
          ...options,
        ]);
      }
      if (!group) continue;
      // The same plug can be legal in several sibling sockets (both aspect
      // sockets share a plugSet, all fragment sockets share one): list it once
      // per group, keeping the socketIndex where it is equipped when applicable.
      const push = (entry: SubclassOption) => {
        const dup = groups[group!].find((e) => e.hash === entry.hash);
        if (!dup) groups[group!].push(entry);
        else if (entry.equipped && !dup.equipped) {
          dup.equipped = true;
          dup.socketIndex = entry.socketIndex;
        }
      };
      for (const o of options) {
        if (!o.unlocked) continue; // unlocked options only — the model sees what the player can slot
        push({ ...o, socketIndex: i });
      }
      // A socket may expose only its plugged plug (no live option list) — keep it.
      const pluggedHash = socketStates[i]?.plugHash;
      if (pluggedHash != null && !options.some((o) => o.hash === pluggedHash && o.unlocked)) {
        const summary = await plugSummary(ctx, pluggedHash);
        if (summary) push({ ...summary, socketIndex: i, unlocked: true, equipped: true });
      }
    }

    // Fragment capacity = sum of the *equipped* aspects' energyCapacity.
    let fragmentCapacity = 0;
    for (const i of aspectIndexes) {
      const aspectHash = socketStates[i]?.plugHash;
      if (aspectHash == null) continue;
      const aspectDef = await ctx.manifest.getItem(aspectHash);
      fragmentCapacity += aspectDef?.plug?.energyCapacity?.capacityValue ?? 0;
    }

    return {
      result: {
        instanceId: owned.item.itemInstanceId,
        itemHash: owned.item.itemHash,
        name: def.displayProperties.name,
        element: match.element,
        owner: owned.owner,
        aspectSockets: aspectIndexes.length,
        fragmentSockets: fragmentIndexes.length,
        fragmentCapacity,
        groups,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// get_artifact

const getArtifact: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'get_artifact',
      description:
        "The current seasonal artifact: name, perk columns with hash/name/description and whether the player has each perk unlocked, plus points spent/available. Pass characterId to check a specific character's unlocks (defaults to the most recently played).",
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          characterId: { type: 'string', description: 'Character id from get_characters; optional.' },
        },
      },
    },
  },
  execute: async (args, ctx) => {
    const profileArt = ctx.snapshot.profileProgression?.data?.seasonalArtifact;
    if (!profileArt) return errorResult('No seasonal artifact data in the profile snapshot.');
    const artifactDef = await ctx.manifest.getArtifact(profileArt.artifactHash);
    if (!artifactDef) return errorResult(`Artifact definition ${profileArt.artifactHash} missing from the manifest.`);

    // Artifact unlocks are per-character: use the requested character, else
    // the most recently played one.
    let charId = str(args.characterId);
    if (!charId) {
      charId = Object.values(ctx.snapshot.characters?.data ?? {}).sort((a, b) =>
        b.dateLastPlayed.localeCompare(a.dateLastPlayed),
      )[0]?.characterId;
    }
    const charArt = charId ? ctx.snapshot.characterProgressions?.data[charId]?.seasonalArtifact : undefined;

    const columns = [];
    for (const [i, tier] of (artifactDef.tiers ?? []).entries()) {
      const charTier = charArt?.tiers.find((t) => t.tierHash === tier.tierHash) ?? charArt?.tiers[i];
      const perks = [];
      for (const item of tier.items) {
        const perkItemDef = await ctx.manifest.getItem(item.itemHash);
        perks.push({
          hash: item.itemHash,
          name: perkItemDef?.displayProperties.name ?? `item ${item.itemHash}`,
          description: perkItemDef?.displayProperties.description ?? '',
          unlocked: charTier?.items.find((p) => p.itemHash === item.itemHash)?.isActive ?? false,
        });
      }
      columns.push({ column: i + 1, title: tier.displayTitle ?? `Column ${i + 1}`, perks });
    }

    const pointsUsed = charArt?.pointsUsed ?? 0;
    return {
      result: {
        name: artifactDef.displayProperties.name,
        characterId: charId ?? null,
        powerBonus: profileArt.powerBonus,
        columns,
        pointsUsed,
        pointsAvailable: profileArt.pointsAcquired - pointsUsed,
      },
    };
  },
};

// ---------------------------------------------------------------------------

export const AGENT_TOOLS: AgentTool[] = [
  getCharacters,
  searchItems,
  getItem,
  listSubclassOptions,
  getArtifact,
];

export const TOOL_SCHEMAS: ToolSchema[] = AGENT_TOOLS.map((t) => t.schema);
