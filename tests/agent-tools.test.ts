// Each read-only tool's output, asserted through the runner seam: the fake
// transport requests the tool once, the runner executes it against the
// fixtures, and the test inspects the JSON tool result in the history.

import { expect, test } from 'vitest';
import { runAgentTurn } from '../src/agent/runner';
import type { AssistantTurn, LLMTransport } from '../src/agent/transport';
import { createFixtureManifest, HASH } from './fixtures/manifest';
import { createFixtureSnapshot, HUNTER_ID, TITAN_ID } from './fixtures/snapshot';

/** Script: one tool call, then a fixed final answer. Returns the parsed tool result. */
async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const turns: AssistantTurn[] = [
    { toolCalls: [{ id: 'c1', name, arguments: JSON.stringify(args) }] },
    { content: 'done' },
  ];
  const transport: LLMTransport = { complete: async () => turns.shift() ?? { content: 'x' } };
  const result = await runAgentTurn({
    transport,
    snapshot: createFixtureSnapshot(),
    manifest: createFixtureManifest(),
    messages: [{ role: 'user', content: 'go' }],
  });
  expect(result.status).toBe('answer');
  const toolMessage = result.messages.find((m) => m.role === 'tool');
  expect(toolMessage?.tool_call_id).toBe('c1');
  return JSON.parse(toolMessage!.content as string);
}

const search = (args: Record<string, unknown>) =>
  callTool('search_items', args) as Promise<{ items: Record<string, unknown>[]; total: number }>;

const instanceIds = (res: { items: Record<string, unknown>[] }) => res.items.map((i) => i.instanceId);

// ---------------------------------------------------------------------------

test('search_items with no filters finds gear in the vault and on both characters', async () => {
  const res = await search({});
  expect(instanceIds(res).sort()).toEqual(['a1', 'a2', 'a3', 's1', 'w1', 'w2', 'w3']);
  expect(res.total).toBe(7);
});

test('search_items bucket + tier filters narrow to equipped exotic and subclass rows', async () => {
  expect(instanceIds(await search({ bucket: 'subclass' }))).toEqual(['s1']);
  expect(instanceIds(await search({ tier: 'exotic' }))).toEqual(['w2']);
  const helmet = await search({ bucket: 'helmet', tier: 'legendary' });
  expect(instanceIds(helmet)).toEqual(['a1']);
});

test('search_items class filter keeps class-agnostic weapons but drops other classes', async () => {
  const titan = await search({ classType: 'titan' });
  expect(instanceIds(titan).sort()).toEqual(['a1', 'a2', 's1', 'w1', 'w2', 'w3']);
  const hunter = await search({ classType: 'hunter' });
  expect(instanceIds(hunter).sort()).toEqual(['a3', 'w1', 'w2', 'w3']);
});

test('search_items damage-type and name filters', async () => {
  expect(instanceIds(await search({ damageType: 'solar' })).sort()).toEqual(['s1', 'w1']);
  expect(instanceIds(await search({ name: 'aion' })).sort()).toEqual(['a1', 'a2']);
});

test('search_items perk filter matches plugged and selectable perk names', async () => {
  // Incandescent is plugged on w1; Heal Clip is only a selectable option.
  expect(instanceIds(await search({ perk: 'incandescent' }))).toEqual(['w1']);
  expect(instanceIds(await search({ perk: 'heal clip' }))).toEqual(['w1']);
  expect((await search({ perk: 'unobtainium' })).items).toEqual([]);
});

test('search_items limit truncates rows but total counts all matches', async () => {
  const res = await search({ limit: 2 });
  expect(res.items).toHaveLength(2);
  expect(res.total).toBe(7);
});

test('search_items rows carry the compact fields the model needs', async () => {
  const res = await search({ name: 'sunpiercer' });
  expect(res.items).toEqual([
    {
      instanceId: 'w1',
      name: 'Sunpiercer',
      itemType: 'Hand Cannon',
      element: 'Solar',
      power: 2010,
      exotic: false,
      perkNames: ['Precision Frame', 'Incandescent', 'Kill Clip'],
      bucket: 'kinetic',
      owner: 'vault',
      equipped: false,
    },
  ]);
  const helm = (await search({ name: 'casque' })).items[0]!;
  expect(helm.setBonusName).toBe('Aion Renewal');
  expect(helm.owner).toBe('vault');
  const grips = (await search({ name: 'grips' })).items[0]!;
  expect(grips.equipped).toBe(true);
  expect(grips.owner).toBe(TITAN_ID);
});

// ---------------------------------------------------------------------------

test('get_item returns sockets, stats, set bonus and masterwork for the vault helmet', async () => {
  const res = (await callTool('get_item', { instanceId: 'a1' })) as any;
  expect(res.name).toBe('Aion Renewal Casque');
  expect(res.masterwork).toBe(true);
  expect(res.exotic).toBe(false);
  expect(res.stats).toEqual({ Weapons: 16, Health: 10 });
  expect(res.setBonus).toEqual({
    name: 'Aion Renewal',
    perks: [
      { requiredSetCount: 2, name: 'Aion Renewal: Renewal', description: '2pc: picking up an Orb reloads weapons.' },
      { requiredSetCount: 4, name: 'Aion Renewal: Grace', description: '4pc: Orbs also grant ability energy.' },
    ],
  });
});

test('get_item lists each socket with the plugged plug and selectable options', async () => {
  const res = (await callTool('get_item', { instanceId: 'w1' })) as any;
  const perkSocket = res.sockets.find((s: any) => s.index === 1);
  expect(perkSocket.category).toBe('Weapon Perks');
  expect(perkSocket.plugged.name).toBe('Incandescent');
  expect(perkSocket.options.map((o: any) => o.name)).toEqual(['Incandescent', 'Heal Clip']);
  expect(perkSocket.options[0].description).toContain('scorch');
  const modSocket = res.sockets.find((s: any) => s.index === 3);
  expect(modSocket.category).toBe('Weapon Mods');
  expect(modSocket.plugged.name).toBe('Backup Mag');
});

test('get_item on an unknown instance returns an error result', async () => {
  const res = (await callTool('get_item', { instanceId: 'zzz' })) as any;
  expect(res.error).toContain('zzz');
});

// ---------------------------------------------------------------------------

test('list_subclass_options groups unlocked plugs by socket with hashes', async () => {
  const res = (await callTool('list_subclass_options', { classType: 'titan', damageType: 'solar' })) as any;
  expect(res.instanceId).toBe('s1');
  expect(res.element).toBe('Solar');
  expect(res.aspectSockets).toBe(2);
  expect(res.fragmentSockets).toBe(4);

  const names = (group: any[]) => group.map((p) => p.name);
  expect(names(res.groups.super)).toEqual(['Hammer of Sol', 'Burning Maul']);
  expect(names(res.groups.classAbility)).toEqual(['Towering Barricade', 'Rally Barricade']);
  expect(names(res.groups.movement)).toEqual(['High Lift', 'Strafe Lift']);
  expect(names(res.groups.melee)).toEqual(['Throwing Hammer', 'Hammer Strike']);
  expect(names(res.groups.grenade)).toEqual(['Fusion Grenade', 'Incendiary Grenade']);
  expect(names(res.groups.aspects)).toEqual(['Sol Invictus', 'Roaring Flames', 'Consecration']);
  expect(names(res.groups.fragments)).toEqual([
    'Ember of Torches',
    'Ember of Searing',
    'Ember of Wonder',
    'Ember of Ashes',
  ]);
  // The locked fragment is filtered out; every listed option is unlocked.
  expect(res.groups.fragments.every((p: any) => p.unlocked === true)).toBe(true);

  const hammer = res.groups.super.find((p: any) => p.hash === HASH.supHammer);
  expect(hammer).toMatchObject({ description: 'Hurl a flaming hammer.', socketIndex: 0, equipped: true });
  const maul = res.groups.super.find((p: any) => p.hash === HASH.supBurning);
  expect(maul.equipped).toBe(false);
});

test('list_subclass_options reports fragment capacity from equipped aspects and fragment costs', async () => {
  const res = (await callTool('list_subclass_options', { classType: 'titan', damageType: 'solar' })) as any;
  // Sol Invictus (3) + Roaring Flames (4) equipped.
  expect(res.fragmentCapacity).toBe(7);
  const wonder = res.groups.fragments.find((p: any) => p.name === 'Ember of Wonder');
  expect(wonder.cost).toBe(2);
});

test('list_subclass_options errors clearly when no such subclass exists', async () => {
  const res = (await callTool('list_subclass_options', { classType: 'hunter', damageType: 'solar' })) as any;
  expect(res.error).toContain('solar hunter');
});

// ---------------------------------------------------------------------------

test('get_artifact returns columns, unlocked flags and points', async () => {
  const res = (await callTool('get_artifact')) as any;
  expect(res.name).toBe('Tablet of Ruin');
  expect(res.characterId).toBe(TITAN_ID); // most recently played
  expect(res.powerBonus).toBe(15);
  expect(res.pointsUsed).toBe(3);
  expect(res.pointsAvailable).toBe(7);
  expect(res.columns).toHaveLength(3);
  expect(res.columns[0].perks).toEqual([
    { hash: HASH.artAntiBarrier, name: 'Anti-Barrier Rounds', description: 'Pierce Barrier champions.', unlocked: true },
    { hash: HASH.artUnstoppable, name: 'Unstoppable Burst', description: 'Stagger Unstoppable champions.', unlocked: false },
  ]);
  expect(res.columns[2].perks[0]).toMatchObject({ name: 'Argent Ordnance', unlocked: false });
});

test('get_artifact for a character without unlocks reports everything locked', async () => {
  const res = (await callTool('get_artifact', { characterId: HUNTER_ID })) as any;
  expect(res.characterId).toBe(HUNTER_ID);
  expect(res.pointsUsed).toBe(0);
  expect(res.pointsAvailable).toBe(10);
  expect(res.columns[0].perks.every((p: any) => p.unlocked === false)).toBe(true);
});
