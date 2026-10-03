// The terminal propose_loadout tool, asserted through the runner seam: a
// scripted transport issues the tool call, the runner validates it against
// the fixtures and either ends the turn with { status: 'proposed',
// toolOutput: {url, query, card} } or feeds a structured error back so the
// model can fix and retry.

import { expect, test } from 'vitest';
import { runAgentTurn } from '../src/agent/runner';
import type { AssistantTurn, LLMTransport } from '../src/agent/transport';
import type { TurnResult } from '../src/agent/runner';
import type { Manifest } from '../src/bungie/manifest';
import type { ProfileSnapshot } from '../src/bungie/profile';
import { BUCKET_HASHES, ITEM_TYPES } from '../src/bungie/constants';
import { createFixtureManifest, HASH } from './fixtures/manifest';
import { createFixtureSnapshot } from './fixtures/snapshot';

const VALID_ARGS = {
  name: 'Solar Titan Bonk',
  classType: 'titan',
  items: ['w1', 'w3', 'a1', 'a2', 'energy', 'chest', 'legs', 'classitem'],
  subclass: {
    instanceId: 's1',
    socketOverrides: {
      '0': HASH.supBurning,
      '5': HASH.aspectConsecration,
      '7': HASH.fragTorches,
      '8': HASH.fragWonder,
      '6': HASH.aspectSol,
    },
  },
  mods: [HASH.modGrenadeKickstart, HASH.modBomber],
  notes: '## Why\nBurning Maul uptime plus Sunspots for GM survivability.',
};

async function run(
  turns: AssistantTurn[],
  deps: { snapshot?: ProfileSnapshot; manifest?: Manifest } = {},
) {
  const script = [...turns];
  const snapshot = deps.snapshot ?? createFixtureSnapshot();
  const base = deps.manifest ?? createFixtureManifest();
  const slots = ['energy', 'chest', 'legs', 'classitem'] as const;
  const extra = slots.map((slot, index) => ({
    hash: 7000 + index, index: 7000 + index, displayProperties: { name: slot, description: '' },
    itemType: slot === 'energy' ? ITEM_TYPES.weapon : ITEM_TYPES.armor,
    classType: 0, equippingBlock: { equipmentSlotTypeHash: BUCKET_HASHES[slot] },
  }));
  snapshot.profileInventory!.data.items.push(...extra.map((def, index) => ({
    itemHash: def.hash, itemInstanceId: slots[index]!, quantity: 1,
    bucketHash: def.equippingBlock.equipmentSlotTypeHash, location: 2, transferStatus: 0, state: 0,
  })));
  const manifest: Manifest = {
    ...base, getItem: async (hash) => extra.find((def) => def.hash === hash) ?? base.getItem(hash),
  };
  const transport: LLMTransport = {
    complete: async () => script.shift() ?? { content: 'script exhausted' },
  };
  return runAgentTurn({
    transport,
    snapshot,
    manifest,
    messages: [{ role: 'user', content: 'build me a solar titan GM loadout' }],
  });
}

const proposeCall = (id: string, args: Record<string, unknown>): AssistantTurn => ({
  toolCalls: [{ id, name: 'propose_loadout', arguments: JSON.stringify(args) }],
});

const toolResults = (result: TurnResult) =>
  result.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content as string));

// ---------------------------------------------------------------------------

test('a valid proposal ends the turn with the DIM loadout URL, id: query and build card', async () => {
  const result = await run([proposeCall('p1', VALID_ARGS)]);

  expect(result.status).toBe('proposed');
  if (result.status !== 'proposed') throw new Error('Expected proposed loadout');
  const out = result.toolOutput;
  expect(out.name).toBe('Solar Titan Bonk');

  const url = new URL(out.url);
  expect(`${url.origin}${url.pathname}`).toBe('https://app.destinyitemmanager.com/loadouts');
  const loadout = JSON.parse(url.searchParams.get('loadout')!);
  expect(loadout).toMatchObject({
    name: 'Solar Titan Bonk',
    classType: 0,
    unequipped: [],
    clearSpace: false,
    notes: VALID_ARGS.notes,
    parameters: { mods: [HASH.modGrenadeKickstart, HASH.modBomber] },
  });
  expect(loadout.id).toEqual(expect.any(String));
  // Instanced gear carries {id, hash}; the subclass matches by hash and
  // carries socket index -> plug hash overrides.
  expect(loadout.equipped).toEqual([
    { id: 'w1', hash: HASH.sunpiercer },
    { id: 'w3', hash: HASH.linecutter },
    { id: 'a1', hash: HASH.aionHelmet },
    { id: 'a2', hash: HASH.aionGauntlets },
    { id: 'energy', hash: 7000 },
    { id: 'chest', hash: 7001 },
    { id: 'legs', hash: 7002 },
    { id: 'classitem', hash: 7003 },
    {
      hash: HASH.sunbreaker,
      socketOverrides: {
        '0': HASH.supBurning,
        '5': HASH.aspectConsecration,
        '6': HASH.aspectSol,
        '7': HASH.fragTorches,
        '8': HASH.fragWonder,
      },
    },
  ]);

  expect(out.query).toBe('id:w1 or id:w3 or id:a1 or id:a2 or id:energy or id:chest or id:legs or id:classitem');

  // Card = model notes + the runner-appended item list.
  expect(out.card).toContain('Burning Maul uptime plus Sunspots');
  expect(out.card).toContain('Sunpiercer');
  expect(out.card).toContain('Linecutter');
  expect(out.card).toContain('Aion Renewal Casque');
  expect(out.card).toContain('Aion Renewal Grips');
  expect(out.card).toContain('Sunbreaker');
  expect(out.card).toContain('Burning Maul');
  expect(out.card).toContain('Consecration');
  expect(out.card).toContain('Ember of Torches');
  expect(out.card).toContain('Grenade Kickstart');
  expect(out.card).toContain('Bomber');
});

test('a fabricated instanceId returns a structured error; the model fixes it and the loop continues', async () => {
  const result = await run([
    proposeCall('p1', { ...VALID_ARGS, items: ['w1', 'w3', 'a1', 'a404'] }),
    proposeCall('p2', VALID_ARGS),
  ]);

  const first = toolResults(result)[0];
  expect(first.error).toBeTruthy();
  expect(first.problems.join('\n')).toContain('a404');
  expect(first).not.toHaveProperty('url');
  // The error was a normal tool result — the loop went on and the corrected
  // proposal terminated the turn.
  expect(result.status).toBe('proposed');
  expect(result.toolOutput).toHaveProperty('url');
});

test('a plug that is illegal for its socket returns a structured error, no outputs', async () => {
  const result = await run([
    proposeCall('p1', {
      ...VALID_ARGS,
      subclass: {
        instanceId: 's1',
        socketOverrides: {
          '0': HASH.fragTorches, // a fragment cannot go in the super socket
          '9': HASH.fragLocked, // legal socket, but the player has not unlocked it
        },
      },
    }),
    { content: 'cannot build that' },
  ]);

  expect(result.status).toBe('answer');
  const first = toolResults(result)[0];
  expect(first.error).toBeTruthy();
  expect(first.problems.join('\n')).toContain('socket 0');
  expect(first.problems.join('\n')).toContain('socket 9');
  expect(first).not.toHaveProperty('url');
});

test('two items in the same equipment bucket return a structured error', async () => {
  const result = await run([
    proposeCall('p1', { ...VALID_ARGS, items: ['w1', 'w2', 'a1', 'a2'] }), // two kinetics
    { content: 'oops' },
  ]);

  expect(result.status).toBe('answer');
  const first = toolResults(result)[0];
  expect(first.error).toBeTruthy();
  const problems = first.problems.join('\n');
  expect(problems).toContain('kinetic');
  expect(problems).toContain('w1');
  expect(problems).toContain('w2');
});

test('the subclass instanceId in items is rejected — it belongs in the subclass field', async () => {
  const result = await run([
    proposeCall('p1', { ...VALID_ARGS, items: ['w1', 'w3', 'a1', 'a2', 's1'] }),
    { content: 'oops' },
  ]);

  expect(result.status).toBe('answer');
  const first = toolResults(result)[0];
  expect(first.error).toBeTruthy();
  expect(first.problems.join('\n')).toContain('subclass');
});

test('a mod hash that is not an armor mod returns a structured error', async () => {
  const result = await run([
    proposeCall('p1', { ...VALID_ARGS, mods: [HASH.killClip, 424242] }),
    { content: 'oops' },
  ]);

  expect(result.status).toBe('answer');
  const problems = toolResults(result)[0].problems.join('\n');
  expect(problems).toContain('Kill Clip');
  expect(problems).toContain('424242');
});

test('fragments costing more than the chosen aspects grant return a structured error', async () => {
  // Ember of Wonder costs 5 slots here (fixture value is 2), so the chosen
  // fragments outspend the chosen aspects' capacity of 3 + 3.
  const base = createFixtureManifest();
  const manifest: Manifest = {
    ...base,
    getItem: async (hash) => {
      const def = await base.getItem(hash);
      return hash === HASH.fragWonder && def
        ? { ...def, plug: { ...def.plug, energyCost: { energyCost: 5 } } }
        : def;
    },
  };
  const result = await run(
    [
      proposeCall('p1', {
        ...VALID_ARGS,
        subclass: {
          instanceId: 's1',
          socketOverrides: {
            '5': HASH.aspectConsecration, // capacity 3
            '6': HASH.aspectSol, //          capacity 3 — total 6
            '7': HASH.fragTorches, //        cost 1
            '8': HASH.fragWonder, //         cost 5
            '9': HASH.fragSearing, //        cost 1 — total 7 > 6
          },
        },
      }),
      { content: 'over budget' },
    ],
    { manifest },
  );

  expect(result.status).toBe('answer');
  const first = toolResults(result)[0];
  expect(first.error).toBeTruthy();
  expect(first.problems.join('\n')).toContain('capacity');
  expect(first).not.toHaveProperty('url');
});

test('a fragment absent from the player plug sets is rejected when live plug data is missing', async () => {
  // Fragment sockets draw unlocks from profilePlugSets (plugSources bit 4).
  // With that row gone, the static plugSet definition must not stand in as
  // "unlocked" options — it lists possible rolls, not owned fragments.
  const snapshot = createFixtureSnapshot();
  delete snapshot.profilePlugSets!.data.plugs[HASH.plugSetFragments];
  const result = await run(
    [
      proposeCall('p1', {
        ...VALID_ARGS,
        subclass: { instanceId: 's1', socketOverrides: { '8': HASH.fragAshes } },
      }),
      { content: 'nope' },
    ],
    { snapshot },
  );

  expect(result.status).toBe('answer');
  const first = toolResults(result)[0];
  expect(first.error).toBeTruthy();
  expect(first.problems.join('\n')).toContain('socket 8');
  expect(first).not.toHaveProperty('url');
});

test.each([
  ['missing equipment', { ...VALID_ARGS, items: ['w1'] }, 'equipment slot'],
  ['retained aspect duplicate', { ...VALID_ARGS, subclass: { instanceId: 's1', socketOverrides: { '5': HASH.aspectRoaring } } }, 'both socket'],
  ['numeric string plug', { ...VALID_ARGS, subclass: { instanceId: 's1', socketOverrides: { '0': String(HASH.supBurning) } } }, 'plug item hash'],
  ['aliased socket index', { ...VALID_ARGS, subclass: { instanceId: 's1', socketOverrides: { '00': HASH.supBurning } } }, 'socket index'],
  ['numeric string mod', { ...VALID_ARGS, mods: [String(HASH.modBomber)] }, 'item hashes'],
  ['too many mods', { ...VALID_ARGS, mods: [HASH.modBomber, HASH.modBomber, HASH.modBomber] }, 'placed'],
])('%s is rejected before emitting a DIM link', async (_label, args, message) => {
  const result = await run([proposeCall('invalid', args), { content: 'correct it' }]);
  expect(result.status).toBe('answer');
  expect(toolResults(result)[0].problems.join('\n')).toContain(message);
  expect(toolResults(result)[0]).not.toHaveProperty('url');
});

test('static subclass possibilities cannot stand in for live unlocked options', async () => {
  const snapshot = createFixtureSnapshot();
  delete snapshot.itemComponents!.reusablePlugs!.data.s1!.plugs['0'];
  const base = createFixtureManifest();
  const manifest: Manifest = {
    ...base,
    getItem: async (hash) => {
      const def = await base.getItem(hash);
      if (hash !== HASH.sunbreaker || !def?.sockets?.socketEntries) return def;
      return { ...def, sockets: { ...def.sockets, socketEntries: def.sockets.socketEntries.map((entry, index) =>
        index ? entry : { ...entry, reusablePlugItems: [{ plugItemHash: HASH.supBurning }] }) } };
    },
  };
  const result = await run([proposeCall('p', VALID_ARGS), { content: 'no unlock proof' }], { snapshot, manifest });
  expect(result.status).toBe('answer');
  expect(toolResults(result)[0].problems.join('\n')).toContain('socket 0');
});

test('a terminal tool batch preserves one response per requested call for follow-up turns', async () => {
  const result = await run([{
    toolCalls: [
      { id: 'proposal', name: 'propose_loadout', arguments: JSON.stringify(VALID_ARGS) },
      { id: 'trailing', name: 'get_characters', arguments: '{}' },
    ],
  }]);
  expect(result.status).toBe('proposed');
  expect(result.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id))
    .toEqual(['proposal', 'trailing']);
  expect(toolResults(result)[1].error).toContain('not executed');
});

test('subclass ownership is tied to a real character of the requested class', async () => {
  const snapshot = createFixtureSnapshot();
  const character = Object.values(snapshot.characters!.data).find((c) => c.classType === 0)!;
  character.classType = 1;
  const result = await run([proposeCall('p', VALID_ARGS), { content: 'wrong owner' }], { snapshot });
  expect(toolResults(result)[0].problems.join('\n')).toContain('belong to a character');
});

test('mod assignment respects selected armor energy capacity', async () => {
  const snapshot = createFixtureSnapshot();
  for (const id of ['a1', 'a2']) snapshot.itemComponents!.instances!.data[id]!.energy = {
    energyTypeHash: 0, energyType: 0, energyCapacity: 0, energyUsed: 0, energyUnused: 0,
  };
  const base = createFixtureManifest();
  const manifest: Manifest = {
    ...base,
    getItem: async (hash) => {
      const def = await base.getItem(hash);
      return def && [HASH.modBomber, HASH.modGrenadeKickstart].some((h) => h === hash)
        ? { ...def, plug: { ...def.plug, energyCost: { energyCost: 1 } } } : def;
    },
  };
  const result = await run([proposeCall('p', VALID_ARGS), { content: 'over budget' }], { snapshot, manifest });
  expect(toolResults(result)[0].problems.join('\n')).toContain('energy capacity');
});
