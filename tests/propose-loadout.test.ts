// The terminal propose_loadout tool, asserted through the runner seam: a
// scripted transport issues the tool call, the runner validates it against
// the fixtures and either ends the turn with { status: 'proposed',
// toolOutput: {url, query, card} } or feeds a structured error back so the
// model can fix and retry.

import { expect, test } from 'vitest';
import { runAgentTurn } from '../src/agent/runner';
import type { AssistantTurn, LLMTransport } from '../src/agent/transport';
import { createFixtureManifest, HASH } from './fixtures/manifest';
import { createFixtureSnapshot } from './fixtures/snapshot';

const VALID_ARGS = {
  name: 'Solar Titan Bonk',
  classType: 'titan',
  items: ['w1', 'w3', 'a1', 'a2'],
  subclass: {
    instanceId: 's1',
    socketOverrides: {
      '0': HASH.supBurning,
      '5': HASH.aspectConsecration,
      '7': HASH.fragTorches,
      '8': HASH.fragWonder,
    },
  },
  mods: [HASH.modGrenadeKickstart, HASH.modBomber],
  notes: '## Why\nBurning Maul uptime plus Sunspots for GM survivability.',
};

async function run(turns: AssistantTurn[]) {
  const script = [...turns];
  const transport: LLMTransport = {
    complete: async () => script.shift() ?? { content: 'script exhausted' },
  };
  return runAgentTurn({
    transport,
    snapshot: createFixtureSnapshot(),
    manifest: createFixtureManifest(),
    messages: [{ role: 'user', content: 'build me a solar titan GM loadout' }],
  });
}

const proposeCall = (id: string, args: Record<string, unknown>): AssistantTurn => ({
  toolCalls: [{ id, name: 'propose_loadout', arguments: JSON.stringify(args) }],
});

const toolResults = (result: Awaited<ReturnType<typeof run>>) =>
  result.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content as string));

// ---------------------------------------------------------------------------

test('a valid proposal ends the turn with the DIM loadout URL, id: query and build card', async () => {
  const result = await run([proposeCall('p1', VALID_ARGS)]);

  expect(result.status).toBe('proposed');
  const out = result.toolOutput as { name: string; url: string; query: string; card: string };
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
    {
      hash: HASH.sunbreaker,
      socketOverrides: {
        '0': HASH.supBurning,
        '5': HASH.aspectConsecration,
        '7': HASH.fragTorches,
        '8': HASH.fragWonder,
      },
    },
  ]);

  expect(out.query).toBe('id:w1 or id:w3 or id:a1 or id:a2');

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
