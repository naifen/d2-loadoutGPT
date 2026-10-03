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
  CLASS_NAMES,
  CLASS_TYPES,
  DAMAGE_TYPE_NAMES,
  FRAGMENT_SOCKET_CATEGORIES,
  GEAR_BUCKET_HASHES,
  ITEM_CATEGORY_HASHES,
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
import { PROPOSE_LOADOUT_TOOL_NAME } from './system-prompt';
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
 * Exception: when plugSources delegates to the live plugSet components, the
 * static plugSet is never a fallback — rolls are not unlocks.
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
    if (
      plugSetHash &&
      !(sources & (SOCKET_PLUG_SOURCES.profilePlugSet | SOCKET_PLUG_SOURCES.characterPlugSet))
    ) {
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

/** Σ of an energy value over plug item hashes — missing/null plugs count 0. */
async function plugEnergySum(
  ctx: AgentToolContext,
  plugHashes: (number | undefined)[],
  energyOf: (plug: NonNullable<DestinyInventoryItemDefinition['plug']>) => number | undefined,
): Promise<number> {
  let total = 0;
  for (const hash of plugHashes) {
    const def = hash == null ? undefined : await ctx.manifest.getItem(hash);
    total += (def?.plug && energyOf(def.plug)) || 0;
  }
  return total;
}

/** Fragment slots granted by aspect plugs (Σ plug.energyCapacity.capacityValue). */
const aspectCapacity = (ctx: AgentToolContext, plugHashes: (number | undefined)[]) =>
  plugEnergySum(ctx, plugHashes, (p) => p.energyCapacity?.capacityValue);

/** Fragment slots spent by fragment plugs (Σ plug.energyCost.energyCost). */
const fragmentCost = (ctx: AgentToolContext, plugHashes: (number | undefined)[]) =>
  plugEnergySum(ctx, plugHashes, (p) => p.energyCost?.energyCost);

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
    const fragmentCapacity = await aspectCapacity(
      ctx,
      aspectIndexes.map((i) => socketStates[i]?.plugHash),
    );

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
// propose_loadout (terminal)
//
// The model proposes the loadout; the runner validates every reference and —
// on success, never the model — generates the DIM loadout URL, the `id:`
// search query and the build card. Validation failures come back as
// { error, problems } in a normal tool result so the model can fix and
// retry; success returns a terminal ToolExecution and the runner stops.

/** Turn status the runner returns when propose_loadout succeeds. */
export const PROPOSE_LOADOUT_STATUS = 'proposed';

/** The terminal payload — #9 renders this as the build card. */
export interface LoadoutProposal {
  name: string;
  url: string;
  query: string;
  card: string;
}

const DIM_LOADOUT_URL = 'https://app.destinyitemmanager.com/loadouts?loadout=';

interface DimLoadoutItem {
  id?: string;
  hash: number;
  socketOverrides?: Record<string, number>;
}

/** DIM's accepted share shape (@destinyitemmanager/dim-api-types Loadout). */
interface DimApiLoadout {
  id: string;
  name: string;
  classType: number;
  equipped: DimLoadoutItem[];
  unequipped: DimLoadoutItem[];
  clearSpace: boolean;
  parameters?: { mods?: number[] };
  notes?: string;
}

/** Card labels in equip order — nicer than raw bucket names. */
const CARD_BUCKETS: [number, string][] = [
  [BUCKET_HASHES.kinetic, 'Kinetic'],
  [BUCKET_HASHES.energy, 'Energy'],
  [BUCKET_HASHES.power, 'Power'],
  [BUCKET_HASHES.helmet, 'Helmet'],
  [BUCKET_HASHES.arms, 'Arms'],
  [BUCKET_HASHES.chest, 'Chest'],
  [BUCKET_HASHES.legs, 'Legs'],
  [BUCKET_HASHES.classitem, 'Class item'],
];

const proposeLoadout: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: PROPOSE_LOADOUT_TOOL_NAME,
      description:
        'Deliver the finished loadout. Terminal: on success the turn ends and the player gets a DIM link that opens the whole build, a search query highlighting the exact items, and your build card. Every instanceId and hash must come from tool results — never invent them. On invalid input you get a problems list; fix it and call again.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Loadout name, shown in DIM and on the build card.' },
          classType: { type: 'string', enum: ['titan', 'hunter', 'warlock'], description: 'Class the build is for.' },
          items: {
            type: 'array',
            items: { type: 'string' },
            description:
              'itemInstanceIds of the gear to equip — weapons and armor, at most one per slot. Do NOT include the subclass item here.',
          },
          subclass: {
            type: 'object',
            additionalProperties: false,
            properties: {
              instanceId: {
                type: 'string',
                description: 'Subclass itemInstanceId from list_subclass_options.',
              },
              socketOverrides: {
                type: 'object',
                additionalProperties: { type: 'integer' },
                description:
                  'Socket index -> plug item hash for the super, abilities, Aspects and Fragments chosen from list_subclass_options. Sockets you omit keep the currently equipped plug.',
              },
            },
            required: ['instanceId'],
          },
          mods: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Armor mod item hashes to slot (see the mod socket options in get_item). Optional.',
          },
          notes: {
            type: 'string',
            description:
              'Build card markdown: why these pieces, how they synergize, and which artifact perks to take.',
          },
        },
        required: ['name', 'classType', 'items', 'subclass', 'notes'],
      },
    },
  },
  execute: async (args, ctx) => {
    const problems: string[] = [];
    const ownedById = new Map<string, OwnedItem>();
    for (const o of collectItems(ctx.snapshot)) {
      if (o.item.itemInstanceId != null) ownedById.set(o.item.itemInstanceId, o);
    }

    const name = str(args.name)?.trim();
    if (!name) problems.push('name is required and must be a non-empty string.');

    const className = str(args.classType)?.toLowerCase() ?? '';
    const classType = CLASS_TYPES[className];
    if (classType == null) {
      problems.push(`classType must be one of titan|hunter|warlock (got ${JSON.stringify(args.classType)}).`);
    }
    const wrongClass = (def: DestinyInventoryItemDefinition) =>
      classType != null && def.classType != null && def.classType !== 3 && def.classType !== classType;

    // ---- gear: every instanceId must exist and claim a distinct equip slot.
    const equipped: DimLoadoutItem[] = [];
    const gearIds: string[] = [];
    const gearForCard: { bucket: number; name: string }[] = [];
    if (!Array.isArray(args.items)) {
      problems.push('items must be an array of itemInstanceId strings.');
    } else {
      const seenIds = new Set<string>();
      const bucketToId = new Map<number, string>();
      for (const raw of args.items) {
        const iid = str(raw);
        if (!iid) {
          problems.push('items must contain only itemInstanceId strings.');
          continue;
        }
        if (seenIds.has(iid)) {
          problems.push(`items lists instanceId "${iid}" twice.`);
          continue;
        }
        seenIds.add(iid);
        const owned = ownedById.get(iid);
        if (!owned) {
          problems.push(
            `No item with instanceId "${iid}" in the profile snapshot — only use ids returned by search_items/get_item.`,
          );
          continue;
        }
        const def = await ctx.manifest.getItem(owned.item.itemHash);
        if (!def) {
          problems.push(`Item "${iid}" (hash ${owned.item.itemHash}) is missing from the manifest.`);
          continue;
        }
        const bucket = slotBucket(owned.item, def);
        if (bucket === BUCKET_HASHES.subclass) {
          problems.push(`"${iid}" (${def.displayProperties.name}) is a subclass item — pass it via the subclass field, not items.`);
          continue;
        }
        if (!GEAR_BUCKET_HASHES.has(bucket)) {
          problems.push(`"${iid}" (${def.displayProperties.name}) is not equippable gear.`);
          continue;
        }
        const clash = bucketToId.get(bucket);
        if (clash != null) {
          problems.push(
            `items "${clash}" and "${iid}" both equip to the ${BUCKET_NAMES[bucket] ?? bucket} slot — pick one.`,
          );
          continue;
        }
        bucketToId.set(bucket, iid);
        if (wrongClass(def)) {
          problems.push(
            `"${iid}" (${def.displayProperties.name}) is ${CLASS_NAMES[def.classType!]}-only and can't go in a ${className} loadout.`,
          );
          continue;
        }
        equipped.push({ id: iid, hash: owned.item.itemHash });
        gearIds.push(iid);
        gearForCard.push({ bucket, name: def.displayProperties.name });
      }
    }

    // ---- subclass: must be an owned subclass item; each override must be a
    // legal, unlocked option for its socket.
    let subclassEntry: DimLoadoutItem | undefined;
    let subclassLine = '';
    const sub = args.subclass;
    if (typeof sub !== 'object' || sub == null || Array.isArray(sub)) {
      problems.push('subclass is required: { instanceId, socketOverrides? }.');
    } else {
      const subArgs = sub as Record<string, unknown>;
      const subIid = str(subArgs.instanceId);
      const subOwned = subIid ? ownedById.get(subIid) : undefined;
      if (!subIid || !subOwned) {
        problems.push(
          `subclass.instanceId ${JSON.stringify(subArgs.instanceId)} is not an item in the profile snapshot — use the instanceId from list_subclass_options.`,
        );
      } else {
        const subDef = await ctx.manifest.getItem(subOwned.item.itemHash);
        if (!subDef) {
          problems.push(`Subclass item "${subIid}" (hash ${subOwned.item.itemHash}) is missing from the manifest.`);
        } else if (subDef.itemType !== ITEM_TYPES.subclass && slotBucket(subOwned.item, subDef) !== BUCKET_HASHES.subclass) {
          problems.push(`"${subIid}" (${subDef.displayProperties.name}) is not a subclass item.`);
        } else {
          if (wrongClass(subDef)) {
            problems.push(
              `${subDef.displayProperties.name} is a ${CLASS_NAMES[subDef.classType!]} subclass — the loadout's classType is ${className}.`,
            );
          }
          const overrides = subArgs.socketOverrides ?? {};
          if (typeof overrides !== 'object' || Array.isArray(overrides)) {
            problems.push('subclass.socketOverrides must be an object mapping socket index to plug hash.');
          } else {
            const socketCount = subDef.sockets?.socketEntries?.length ?? 0;
            const socketStates = ctx.snapshot.itemComponents?.sockets?.data[subIid]?.sockets ?? [];
            const chosen = new Map<number, number>();
            for (const [key, rawHash] of Object.entries(overrides)) {
              const idx = Number(key);
              const plugHash = Number(rawHash);
              if (!Number.isInteger(idx) || idx < 0 || idx >= socketCount) {
                problems.push(
                  `subclass.socketOverrides: "${key}" is not a socket index on ${subDef.displayProperties.name} (sockets 0–${socketCount - 1}).`,
                );
                continue;
              }
              if (!Number.isInteger(plugHash)) {
                problems.push(`subclass.socketOverrides: socket ${idx} must map to a plug item hash.`);
                continue;
              }
              const plugDef = await ctx.manifest.getItem(plugHash);
              if (!plugDef) {
                problems.push(`subclass.socketOverrides: plug hash ${plugHash} for socket ${idx} is not in the manifest.`);
                continue;
              }
              // Legal = a live unlocked option (reusablePlugs / plugSets per
              // plugSources), a static option when no live data exists, or the
              // plug already sitting in that socket.
              const options = await socketOptions(ctx, subOwned, idx, subDef.sockets?.socketEntries?.[idx], true);
              const pluggedHash = socketStates[idx]?.plugHash;
              if (plugHash !== pluggedHash && !options.some((o) => o.hash === plugHash && o.unlocked)) {
                const legal = options.filter((o) => o.unlocked).map((o) => `${o.hash} (${o.name})`).join(', ');
                problems.push(
                  `subclass.socketOverrides: "${plugDef.displayProperties.name}" (${plugHash}) is not a legal option for socket ${idx} on ${subDef.displayProperties.name}. Legal options: ${legal || 'none'}.`,
                );
                continue;
              }
              chosen.set(idx, plugHash);
            }
            const plugOnSocket = new Map<number, number>();
            for (const [idx, plugHash] of chosen) {
              const other = plugOnSocket.get(plugHash);
              if (other != null) {
                problems.push(`subclass.socketOverrides: plug ${plugHash} can't go in both socket ${other} and socket ${idx}.`);
              } else {
                plugOnSocket.set(plugHash, idx);
              }
            }
            // Fragment capacity: the effective aspects' energyCapacity must
            // cover the effective fragments' energyCost — the same math
            // list_subclass_options displays (overrides win, else the plug
            // currently in the socket).
            const aspectSockets: number[] = [];
            const fragmentSockets: number[] = [];
            for (const c of subDef.sockets?.socketCategories ?? []) {
              if (ASPECT_CATS.has(c.socketCategoryHash)) aspectSockets.push(...c.socketIndexes);
              else if (FRAGMENT_CATS.has(c.socketCategoryHash)) fragmentSockets.push(...c.socketIndexes);
            }
            const effectivePlug = (i: number) => chosen.get(i) ?? socketStates[i]?.plugHash;
            const [capacity, cost] = await Promise.all([
              aspectCapacity(ctx, aspectSockets.map(effectivePlug)),
              fragmentCost(ctx, fragmentSockets.map(effectivePlug)),
            ]);
            if (cost > capacity) {
              problems.push(
                `subclass.socketOverrides: the chosen Fragments cost ${cost} but the chosen Aspects only grant ${capacity} of fragment capacity — drop Fragments or pick Aspects that grant more.`,
              );
            }
            subclassEntry = { hash: subOwned.item.itemHash };
            if (chosen.size) {
              subclassEntry.socketOverrides = Object.fromEntries(
                [...chosen].map(([i, h]) => [String(i), h]),
              );
            }
            // Build card: the effective subclass config (overrides over the
            // currently plugged state), dummy/empty plugs skipped.
            const plugNames: string[] = [];
            for (let i = 0; i < socketCount; i++) {
              const h = chosen.get(i) ?? socketStates[i]?.plugHash;
              if (h == null) continue;
              const d = await ctx.manifest.getItem(h);
              if (!d || d.plug?.isDummyPlug) continue;
              plugNames.push(d.displayProperties.name);
            }
            const element = await elementName(ctx, subOwned.item, subDef);
            subclassLine = `Subclass — ${subDef.displayProperties.name}${element ? ` (${element})` : ''}`;
            if (plugNames.length) subclassLine += `: ${plugNames.join(' · ')}`;
          }
        }
      }
    }

    // ---- mods: real inventory items carrying the armor-mod item category.
    const modHashes: number[] = [];
    const modNames: string[] = [];
    if (args.mods != null) {
      if (!Array.isArray(args.mods)) {
        problems.push('mods must be an array of armor mod item hashes.');
      } else {
        for (const raw of args.mods) {
          const h = Number(raw);
          if (!Number.isInteger(h)) {
            problems.push(`mods entries must be item hashes (got ${JSON.stringify(raw)}).`);
            continue;
          }
          const def = await ctx.manifest.getItem(h);
          if (!def) {
            problems.push(`mods: hash ${h} is not a known item — use mod hashes from get_item socket options.`);
            continue;
          }
          if (!def.itemCategoryHashes?.includes(ITEM_CATEGORY_HASHES.armorMods)) {
            problems.push(`mods: "${def.displayProperties.name}" (${h}) is not an armor mod.`);
            continue;
          }
          modHashes.push(h);
          modNames.push(def.displayProperties.name);
        }
      }
    }

    const notes = str(args.notes)?.trim();
    if (!notes) problems.push('notes is required — the build card markdown explaining the build.');

    if (problems.length) {
      return {
        result: {
          error: 'Invalid propose_loadout arguments — fix every problem below and call again.',
          problems,
        },
      };
    }

    const loadout: DimApiLoadout = {
      id: crypto.randomUUID(),
      name: name!,
      classType: classType!,
      equipped: [...equipped, subclassEntry!],
      unequipped: [],
      clearSpace: false,
      ...(modHashes.length ? { parameters: { mods: modHashes } } : {}),
      notes: notes!,
    };
    const url = DIM_LOADOUT_URL + encodeURIComponent(JSON.stringify(loadout));
    const query = gearIds.map((id) => `id:${id}`).join(' or ');

    const cardLines = [notes!, '', '---', '', '## Items', ''];
    gearForCard.sort(
      (a, b) =>
        CARD_BUCKETS.findIndex(([h]) => h === a.bucket) - CARD_BUCKETS.findIndex(([h]) => h === b.bucket),
    );
    for (const g of gearForCard) {
      cardLines.push(`- ${CARD_BUCKETS.find(([h]) => h === g.bucket)?.[1] ?? 'Item'} — ${g.name}`);
    }
    cardLines.push(`- ${subclassLine}`);
    if (modNames.length) {
      cardLines.push('', '## Mods', '');
      for (const m of modNames) cardLines.push(`- ${m}`);
    }

    const output: LoadoutProposal = { name: name!, url, query, card: cardLines.join('\n') };
    return { result: output, terminal: { status: PROPOSE_LOADOUT_STATUS, output } };
  },
};

// ---------------------------------------------------------------------------

export const AGENT_TOOLS: AgentTool[] = [
  getCharacters,
  searchItems,
  getItem,
  listSubclassOptions,
  getArtifact,
  proposeLoadout,
];

export const TOOL_SCHEMAS: ToolSchema[] = AGENT_TOOLS.map((t) => t.schema);
