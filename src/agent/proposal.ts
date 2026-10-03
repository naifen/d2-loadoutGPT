import { ASPECT_SOCKET_CATEGORIES, FRAGMENT_SOCKET_CATEGORIES, BUCKET_HASHES, BUCKET_NAMES, CLASS_NAMES, CLASS_TYPES, GEAR_BUCKET_HASHES, ITEM_CATEGORY_HASHES, ITEM_TYPES, TIER_TYPES } from '../bungie/constants';
import type { DestinyInventoryItemDefinition } from '../bungie/manifest';
import { PROPOSE_LOADOUT_TOOL_NAME } from './system-prompt';
import { collectItems, slotBucket, elementName, socketOptions, aspectCapacity, fragmentCost, str } from './item-context';
import type { AgentTool, OwnedItem } from './item-context';
import { isRecord } from '../type-guards';

const ASPECT_CATS = new Set<number>(ASPECT_SOCKET_CATEGORIES);
const FRAGMENT_CATS = new Set<number>(FRAGMENT_SOCKET_CATEGORIES);

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

export const proposeLoadout: AgentTool = {
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
              'itemInstanceIds of exactly one weapon and armor item in each of the eight equipment slots. Do NOT include the subclass item here.',
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
      const exoticKinds = new Set<number>();
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
        if (def.inventory?.tierType === TIER_TYPES.exotic) {
          if (exoticKinds.has(def.itemType ?? 0)) problems.push('items can equip at most one exotic weapon and one exotic armor item.');
          exoticKinds.add(def.itemType ?? 0);
        }
        equipped.push({ id: iid, hash: owned.item.itemHash });
        gearIds.push(iid);
        gearForCard.push({ bucket, name: def.displayProperties.name });
      }
      for (const [bucket, label] of CARD_BUCKETS) {
        if (!bucketToId.has(bucket)) problems.push(`items is missing the ${label} equipment slot.`);
      }
    }

    // ---- subclass: must be an owned subclass item; each override must be a
    // legal, unlocked option for its socket.
    let subclassEntry: DimLoadoutItem | undefined;
    let subclassLine = '';
    const sub = args.subclass;
    if (!isRecord(sub)) {
      problems.push('subclass is required: { instanceId, socketOverrides? }.');
    } else {
      const subArgs = sub;
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
          const character = ctx.snapshot.characters?.data[subOwned.owner];
          if (!character || character.classType !== classType) {
            problems.push('subclass must belong to a character of the requested class.');
          }
          if (wrongClass(subDef)) {
            problems.push(
              `${subDef.displayProperties.name} is a ${CLASS_NAMES[subDef.classType!]} subclass — the loadout's classType is ${className}.`,
            );
          }
          const overrides = subArgs.socketOverrides === undefined ? {} : subArgs.socketOverrides;
          if (!isRecord(overrides)) {
            problems.push('subclass.socketOverrides must be an object mapping socket index to plug hash.');
          } else {
            const socketCount = subDef.sockets?.socketEntries?.length ?? 0;
            const socketStates = ctx.snapshot.itemComponents?.sockets?.data[subIid]?.sockets ?? [];
            const chosen = new Map<number, number>();
            for (const [key, rawHash] of Object.entries(overrides)) {
              const idx = Number(key);
              const plugHash = rawHash;
              if (!Number.isInteger(idx) || String(idx) !== key || idx < 0 || idx >= socketCount) {
                problems.push(
                  `subclass.socketOverrides: "${key}" is not a socket index on ${subDef.displayProperties.name} (sockets 0–${socketCount - 1}).`,
                );
                continue;
              }
              if (typeof plugHash !== 'number' || !Number.isInteger(plugHash) || plugHash <= 0 || plugHash > 0xffffffff) {
                problems.push(`subclass.socketOverrides: socket ${idx} must map to a plug item hash.`);
                continue;
              }
              const plugDef = await ctx.manifest.getItem(plugHash);
              if (!plugDef) {
                problems.push(`subclass.socketOverrides: plug hash ${plugHash} for socket ${idx} is not in the manifest.`);
                continue;
              }
              // Only live unlocks or the currently plugged option prove ownership.
              const options = await socketOptions(ctx, subOwned, idx, subDef.sockets?.socketEntries?.[idx], false);
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
            for (let idx = 0; idx < socketCount; idx++) {
              const plugHash = chosen.get(idx) ?? socketStates[idx]?.plugHash;
              if (plugHash == null || (await ctx.manifest.getItem(plugHash))?.plug?.isDummyPlug) continue;
              const other = plugOnSocket.get(plugHash);
              if (other != null) problems.push(`subclass.socketOverrides: plug ${plugHash} can't go in both socket ${other} and socket ${idx}.`);
              else plugOnSocket.set(plugHash, idx);
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

    const modSockets: { options: Set<number>; itemId: string }[] = [];
    for (const item of equipped) {
      const owned = ownedById.get(item.id!)!;
      const def = await ctx.manifest.getItem(item.hash);
      if (def?.itemType !== ITEM_TYPES.armor) continue;
      for (const [index, entry] of (def.sockets?.socketEntries ?? []).entries()) {
        const options = await socketOptions(ctx, owned, index, entry, false);
        const hashes = new Set(options.filter((o) => o.unlocked).map((o) => o.hash));
        const current = ctx.snapshot.itemComponents?.sockets?.data[item.id!]?.sockets[index]?.plugHash;
        if (current != null) hashes.add(current);
        modSockets.push({ options: hashes, itemId: item.id! });
      }
    }
    // ---- mods: real inventory items carrying the armor-mod item category.
    const modHashes: number[] = [];
    const modNames: string[] = [];
    if (args.mods !== undefined) {
      if (!Array.isArray(args.mods)) {
        problems.push('mods must be an array of armor mod item hashes.');
      } else {
        for (const raw of args.mods) {
          const h = raw;
          if (typeof h !== 'number' || !Number.isInteger(h) || h <= 0 || h > 0xffffffff) {
            problems.push(`mods entries must be item hashes (got ${JSON.stringify(raw)}).`);
            continue;
          }
          const def = await ctx.manifest.getItem(h);
          if (!def) {
            problems.push(`mods: hash ${h} is not a known item — use mod hashes from get_item socket options.`);
            continue;
          }
          if (!def.itemCategoryHashes?.includes(ITEM_CATEGORY_HASHES.armorMods) || def.plug?.isDummyPlug || wrongClass(def)) {
            problems.push(`mods: "${def.displayProperties.name}" (${h}) is not an armor mod.`);
            continue;
          }
          modHashes.push(h);
          modNames.push(def.displayProperties.name);
        }
      }
    }
    // DIM assigns parameters.mods to sockets; prove an injective assignment exists.
    const usedSockets = new Set<number>();
    const energyUsed = new Map<string, number>();
    const failedAssignments = new Set<string>();
    const costs = await Promise.all(modHashes.map(async (hash) =>
      (await ctx.manifest.getItem(hash))?.plug?.energyCost?.energyCost ?? 0));
    const fitMods = (index: number): boolean => {
      if (index === modHashes.length) return true;
      const key = JSON.stringify([index, [...usedSockets].sort((a, b) => a - b),
        [...energyUsed].filter(([, value]) => value !== 0).sort(([a], [b]) => a.localeCompare(b))]);
      if (failedAssignments.has(key)) return false;
      const hash = modHashes[index]!;
      const cost = costs[index]!;
      for (const [socketIndex, socket] of modSockets.entries()) {
        if (usedSockets.has(socketIndex) || !socket.options.has(hash)) continue;
        const used = energyUsed.get(socket.itemId) ?? 0;
        const capacity = ctx.snapshot.itemComponents?.instances?.data[socket.itemId]?.energy?.energyCapacity;
        if (capacity != null && used + cost > capacity) continue;
        usedSockets.add(socketIndex);
        energyUsed.set(socket.itemId, used + cost);
        if (fitMods(index + 1)) return true;
        usedSockets.delete(socketIndex);
        energyUsed.set(socket.itemId, used);
      }
      failedAssignments.add(key);
      return false;
    };
    if (modHashes.length > modSockets.length ||
        modHashes.some((hash) => !modSockets.some((socket) => socket.options.has(hash))) || !fitMods(0)) {
      problems.push('mods cannot all be placed in unlocked sockets on the selected armor within its energy capacity.');
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
    return { result: output, proposal: output };
  },
};
