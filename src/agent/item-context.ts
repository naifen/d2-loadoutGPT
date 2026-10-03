import { DAMAGE_TYPE_NAMES, SOCKET_PLUG_SOURCES } from '../bungie/constants';
import type { DestinyInventoryItemDefinition, DestinySocketEntry, Manifest } from '../bungie/manifest';
import type { DestinyItemComponent, DestinyItemPlug, ProfileSnapshot } from '../bungie/profile';
import type { ToolSchema } from './transport';
import type { LoadoutProposal } from './proposal';

export interface AgentToolContext {
  snapshot: ProfileSnapshot;
  manifest: Manifest;
}

export interface ToolExecution {
  result: unknown;
  proposal?: LoadoutProposal;
}

export interface AgentTool {
  schema: ToolSchema;
  execute(args: Record<string, unknown>, ctx: AgentToolContext): Promise<ToolExecution>;
}

export const errorResult = (message: string): ToolExecution => ({ result: { error: message } });

export interface OwnedItem {
  item: DestinyItemComponent;
  /** 'vault' or a characterId. */
  owner: string;
  equipped: boolean;
}

/** Every owned item: vault + each character's inventory and equipment. */
export function collectItems(snapshot: ProfileSnapshot): OwnedItem[] {
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
export function slotBucket(item: DestinyItemComponent, def?: DestinyInventoryItemDefinition): number {
  return (
    def?.equippingBlock?.equipmentSlotTypeHash ?? def?.inventory?.bucketTypeHash ?? item.bucketHash
  );
}

export async function elementName(
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

/**
 * Options a socket exposes, from the live unlocked sources only:
 * itemComponents.reusablePlugs plus profile/character plugSets when
 * socketEntry.plugSources says so. `includeStatic` additionally falls back to
 * the definition's reusablePlugItems/plugSet/singleInitialItemHash (possible
 * rolls, not proven-unlocked) — used by get_item, not list_subclass_options.
 * Exception: when plugSources delegates to the live plugSet components, the
 * static plugSet is never a fallback — rolls are not unlocks.
 */
export async function socketOptions(
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
      canInsert: false,
      enabled: false,
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
export const aspectCapacity = (ctx: AgentToolContext, plugHashes: (number | undefined)[]) =>
  plugEnergySum(ctx, plugHashes, (p) => p.energyCapacity?.capacityValue);

/** Fragment slots spent by fragment plugs (Σ plug.energyCost.energyCost). */
export const fragmentCost = (ctx: AgentToolContext, plugHashes: (number | undefined)[]) =>
  plugEnergySum(ctx, plugHashes, (p) => p.energyCost?.energyCost);

export const str = (v: unknown) => typeof v === 'string' ? v : undefined;
