// Destiny 2 profile snapshot: one GetProfile call, cached in local storage.
//
// The stored object is the API `Response` verbatim plus `fetchedAt` and the
// resolved membership — it is the fixture contract for the agent tools
// (src/agent, ticket #6). Only the fields the tools need are typed; the
// cached JSON keeps everything Bungie sent.

import { browser } from 'wxt/browser';
import { CLASS_NAMES } from './constants';
import { getTokens, withAuthSession } from './auth';
import { BungieError } from './errors';
import { bungieFetch } from './http';

const STORAGE_KEY = 'profileSnapshot';
const SESSION_KEY = 'profileFetchedThisSession';

// Profiles, ProfileInventories (vault), ProfileProgression (artifact),
// Characters, CharacterInventories, CharacterProgressions (artifact unlocks),
// CharacterEquipment, ItemInstances, ItemPerks, ItemStats, ItemSockets,
// ItemReusablePlugs.
const COMPONENTS = '100,102,104,200,201,202,205,300,302,304,305,310';

export interface DestinyMembership {
  /** BungieMembershipType: 1 Xbox, 2 PSN, 3 Steam, 6 Epic, 254 BungieNext. */
  type: number;
  /** int64 destinyMembershipId — always a string. */
  id: string;
}

// ---------------------------------------------------------------------------
// Snapshot type (fixture contract for src/agent). Components not requested are
// absent; requested components may still be absent when Bungie marks them
// private — always read with `?.`.

export interface DestinyItemComponent {
  itemHash: number;
  /** Absent on non-instanced stacks (consumables, currencies). */
  itemInstanceId?: string;
  quantity: number;
  bucketHash: number;
  /** ItemLocation: 1 Inventory, 2 Vault, 3 Vendor, 4 Postmaster. */
  location: number;
  /** Bitmask; 1 = equipped. */
  transferStatus: number;
  /** ItemState bitmask: 1 Locked, 4 Masterwork, 8 Crafted, 32 Enhanced. */
  state: number;
  lockable?: boolean;
  versionNumber?: number;
  overrideStyleItemHash?: number;
}

export interface DestinyProgression {
  progressionHash: number;
  dailyProgress: number;
  dailyLimit: number;
  weeklyProgress: number;
  weeklyLimit: number;
  currentProgress: number;
  level: number;
  levelCap: number;
  stepIndex: number;
  progressToNextLevel: number;
  nextLevelAt: number;
}

export interface DestinyCharacter {
  membershipId: string;
  membershipType: number;
  characterId: string;
  /** DestinyClass: 0 Titan, 1 Hunter, 2 Warlock. */
  classType: number;
  /** Power level excluding the artifact's powerBonus. */
  light: number;
  levelProgression?: DestinyProgression;
  emblemPath: string;
  emblemBackgroundPath: string;
  emblemHash: number;
  emblemColor?: { red: number; green: number; blue: number; alpha: number };
  dateLastPlayed: string;
  minutesPlayedTotal: string;
  raceType: number;
  genderType: number;
  stats?: Record<string, number>;
  titleRecordHash?: number;
}

export interface DestinyItemInstance {
  /** DamageType: 1 Kinetic, 2 Arc, 3 Solar(Thermal), 4 Void, 6 Stasis, 7 Strand. */
  damageType?: number;
  damageTypeHash?: number;
  /** Power when statHash = 1935470627. */
  primaryStat?: { statHash: number; value: number };
  itemLevel?: number;
  quality?: number;
  isEquipped?: boolean;
  canEquip?: boolean;
  equipRequiredLevel?: number;
  energy?: {
    energyTypeHash: number;
    energyType: number;
    energyCapacity: number;
    energyUsed: number;
    energyUnused: number;
  };
  breakerType?: number;
  breakerTypeHash?: number;
  /** Armor 3.0 gear tier (0 when absent). */
  gearTier?: number;
}

export interface DestinyItemSocketState {
  plugHash?: number;
  isEnabled: boolean;
  isVisible: boolean;
  enableFailIndexes?: number[];
}

export interface DestinyItemPlug {
  plugItemHash: number;
  canInsert: boolean;
  enabled: boolean;
  insertFailIndexes?: number[];
  enableFailIndexes?: number[];
}

export interface DestinyItemPerk {
  perkHash: number;
  iconPath?: string;
  isActive: boolean;
  visible?: boolean;
}

export interface DestinyStatValue {
  statHash: number;
  value: number;
}

/** Component 104 — profile-wide artifact (season, points earned, power bonus). */
export interface DestinyArtifactProfileScoped {
  artifactHash: number;
  pointProgression: DestinyProgression;
  pointsAcquired: number;
  powerBonusProgression: DestinyProgression;
  powerBonus: number;
}

/** Component 202 — per-character artifact perk unlocks. */
export interface DestinyArtifactCharacterScoped {
  artifactHash: number;
  pointsUsed: number;
  resetCount: number;
  tiers: {
    tierHash: number;
    isUnlocked: boolean;
    pointsToUnlock: number;
    items: { itemHash: number; isActive: boolean; isVisible: boolean }[];
  }[];
}

export interface ProfileSnapshot {
  /** ms since epoch when the snapshot was fetched. */
  fetchedAt: number;
  /** The Destiny membership this was fetched for. */
  membership: DestinyMembership;
  /** Browser login session that owns this cache; absent in synthetic fixtures. */
  authSessionId?: string;

  profile?: {
    data: {
      userInfo: { membershipType: number; membershipId: string; displayName: string };
      characterIds: string[];
      dateLastPlayed: string;
      currentSeasonHash?: number;
      currentSeasonRewardPowerCap?: number;
    };
    privacy: number;
  };
  characters?: { data: Record<string, DestinyCharacter>; privacy: number };
  /** Unequipped items per character. */
  characterInventories?: { data: Record<string, { items: DestinyItemComponent[] }> };
  /** Equipped items per character. */
  characterEquipment?: { data: Record<string, { items: DestinyItemComponent[] }> };
  /** The vault. */
  profileInventory?: { data: { items: DestinyItemComponent[] } };
  profileProgression?: { data: { seasonalArtifact?: DestinyArtifactProfileScoped } };
  characterProgressions?: {
    data: Record<string, { seasonalArtifact?: DestinyArtifactCharacterScoped }>;
  };
  /** plugSetHash -> plugs (arrives with ItemSockets). */
  profilePlugSets?: { data: { plugs: Record<string, DestinyItemPlug[]> } };
  /** charId -> plugSetHash -> plugs (arrives with ItemSockets). */
  characterPlugSets?: { data: Record<string, { plugs: Record<string, DestinyItemPlug[]> }> };
  /** All keyed by itemInstanceId (string int64). */
  itemComponents?: {
    instances?: { data: Record<string, DestinyItemInstance> };
    sockets?: { data: Record<string, { sockets: DestinyItemSocketState[] }> };
    reusablePlugs?: { data: Record<string, { plugs: Record<string, DestinyItemPlug[]> }> };
    stats?: { data: Record<string, { stats: Record<string, DestinyStatValue> }> };
    perks?: { data: Record<string, { perks: DestinyItemPerk[] }> };
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (no network, no browser APIs — unit-testable).

export interface UserMembershipCard {
  membershipType: number;
  membershipId: string;
  /** 0 = not overridden; else the membershipType that cross-save overrides it with. */
  crossSaveOverride: number;
}

/**
 * Destiny memberships to query, best first. `primaryMembershipId` (set when
 * cross-save is active) wins outright. Otherwise memberships overridden by
 * cross-save are dropped. Several results = genuinely ambiguous (accounts on
 * several platforms without cross-save) — disambiguate by recency.
 */
export function pickMembership(
  memberships: UserMembershipCard[],
  primaryMembershipId?: string,
): UserMembershipCard[] {
  const primary = memberships.find((m) => m.membershipId === primaryMembershipId);
  if (primary) return [primary];
  const active = memberships.filter(
    (m) => m.crossSaveOverride === 0 || m.crossSaveOverride === m.membershipType,
  );
  return active.length ? active : memberships;
}

export interface LinkedProfile {
  membershipId: string;
  membershipType: number;
  dateLastPlayed: string;
  isOverridden?: boolean;
}

/** Most recently played linked profile, skipping cross-save-overridden ones. */
export function pickLinkedProfile<T extends LinkedProfile>(profiles: T[]): T | undefined {
  return profiles
    .filter((p) => !p.isOverridden)
    .reduce<T | undefined>((best, p) => (best && best.dateLastPlayed >= p.dateLastPlayed ? best : p), undefined);
}

export interface CharacterRow {
  id: string;
  className: string;
  classType: number;
  light: number;
  emblemPath: string;
}

/** Snapshot -> rows for the character list UI (also usable by get_characters). */
export function charactersFromSnapshot(snapshot: ProfileSnapshot): CharacterRow[] {
  return Object.values(snapshot.characters?.data ?? {}).map((c) => ({
    id: c.characterId,
    className: CLASS_NAMES[c.classType] ?? 'Unknown',
    classType: c.classType,
    light: c.light,
    emblemPath: c.emblemPath,
  }));
}

// ---------------------------------------------------------------------------
// Fetch + cache.

interface MembershipsResponse {
  bungieNetUser?: { membershipId: string };
  primaryMembershipId?: string;
  destinyMemberships?: UserMembershipCard[];
}

interface LinkedProfilesResponse {
  profiles?: LinkedProfile[];
}

async function resolveMembership(): Promise<DestinyMembership> {
  const res = await bungieFetch<MembershipsResponse>('/User/GetMembershipsForCurrentUser/');
  const candidates = pickMembership(res.destinyMemberships ?? [], res.primaryMembershipId);
  if (candidates.length === 0) {
    throw new BungieError('unknown', 'No Destiny 2 account found on this Bungie.net login.');
  }
  let pick = candidates[0]!; // length > 0 guaranteed above
  if (candidates.length > 1) {
    // Ambiguous (several platforms, no cross-save): most recently played wins.
    const bungieNetId = res.bungieNetUser?.membershipId ?? (await getTokens())?.membershipId;
    if (bungieNetId) {
      const linked = await bungieFetch<LinkedProfilesResponse>(
        `/Destiny2/254/Profile/${bungieNetId}/LinkedProfiles/?getAllMemberships=true`,
      );
      const ids = new Set(candidates.map((c) => c.membershipId));
      const best = pickLinkedProfile((linked.profiles ?? []).filter((p) => ids.has(p.membershipId)));
      pick = candidates.find((c) => c.membershipId === best?.membershipId) ?? pick;
    }
  }
  return { type: pick.membershipType, id: pick.membershipId };
}

type ProfileResponse = Omit<ProfileSnapshot, 'fetchedAt' | 'membership'>;

/**
 * Resolve the Destiny membership, then fetch the full profile snapshot.
 * BungieError propagates to the caller (maintenance, throttled, login-required).
 */
export async function fetchProfileSnapshot(): Promise<ProfileSnapshot> {
  const membership = await resolveMembership();
  const response = await bungieFetch<ProfileResponse>(
    `/Destiny2/${membership.type}/Profile/${membership.id}/?components=${COMPONENTS}`,
  );
  return { ...response, membership, fetchedAt: Date.now() };
}

/**
 * The snapshot from cache, or a fresh fetch when absent / `forceRefresh` is
 * set. Successful fetches replace the cache; failures leave it untouched.
 */
export async function getSnapshot(forceRefresh = false): Promise<ProfileSnapshot> {
  const tokens = await getTokens();
  if (!tokens) throw new BungieError('login-required', 'Log in with Bungie first.');
  const sessionId = tokens.sessionId;
  return navigator.locks.request('bungie-profile', async () => {
    const cached = await getCachedSnapshot();
    const flagged = (await browser.storage.session.get(SESSION_KEY))[SESSION_KEY];
    if (!forceRefresh && cached?.snapshot.authSessionId === sessionId && flagged === sessionId) {
      return withAuthSession(sessionId, async () => cached.snapshot);
    }
    const snapshot = { ...(await fetchProfileSnapshot()), authSessionId: sessionId };
    await withAuthSession(sessionId, async () => {
      await browser.storage.local.set({ [STORAGE_KEY]: snapshot });
      await browser.storage.session.set({ [SESSION_KEY]: sessionId });
    });
    return snapshot;
  });
}

/** The cached snapshot without any network access. */
export async function getCachedSnapshot(): Promise<
  { snapshot: ProfileSnapshot; fetchedAt: number } | undefined
> {
  const tokens = await getTokens();
  const { [STORAGE_KEY]: snapshot } = await browser.storage.local.get(STORAGE_KEY);
  const cached = snapshot as ProfileSnapshot | undefined;
  return tokens && cached?.authSessionId === tokens.sessionId
    ? { snapshot: cached, fetchedAt: cached.fetchedAt }
    : undefined;
}
