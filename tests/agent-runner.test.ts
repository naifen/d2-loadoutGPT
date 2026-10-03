// Agent turn runner tested through its only seam: runAgentTurn with a scripted
// fake LLM transport and synthetic profile/manifest fixtures. The fake records
// the messages it receives so tests can assert on the OpenAI wire shape too.

import { expect, test } from 'vitest';
import { runAgentTurn, type AgentEvent, type TurnResult } from '../src/agent/runner';
import type { AssistantTurn, ChatMessage, LLMTransport } from '../src/agent/transport';
import { createFixtureManifest } from './fixtures/manifest';
import { createFixtureSnapshot, TITAN_ID } from './fixtures/snapshot';

interface ScriptedTransport extends LLMTransport {
  received: ChatMessage[][];
}

function scriptedTransport(turns: AssistantTurn[]): ScriptedTransport {
  const received: ChatMessage[][] = [];
  return {
    received,
    complete: async (messages) => {
      received.push(messages);
      return turns.shift() ?? { content: 'script exhausted' };
    },
  };
}

async function run(turns: AssistantTurn[], opts: { maxIterations?: number } = {}) {
  const transport = scriptedTransport(turns);
  const events: AgentEvent[] = [];
  const result = await runAgentTurn({
    transport,
    snapshot: createFixtureSnapshot(),
    manifest: createFixtureManifest(),
    messages: [{ role: 'user', content: 'build me something' }],
    onEvent: (e) => events.push(e),
    ...opts,
  });
  return { transport, events, result };
}

const toolMessages = (result: TurnResult) =>
  result.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content as string));

test('tool results feed back and the loop stops on a final text answer', async () => {
  const { result } = await run([
    { toolCalls: [{ id: 'c1', name: 'get_characters', arguments: '{}' }] },
    { content: 'You run a Titan and a Hunter.' },
  ]);

  expect(result.status).toBe('answer');
  expect(result.content).toBe('You run a Titan and a Hunter.');
  expect(toolMessages(result)).toEqual([
    {
      characters: [
        { id: TITAN_ID, class: 'Titan', light: 2010, emblem: '/emblem/titan' },
        { id: '2305843000000000002', class: 'Hunter', light: 1998, emblem: '/emblem/hunter' },
      ],
    },
  ]);
});

test('messages stay in OpenAI wire shape (system prompt + tool_call echo + tool results)', async () => {
  const { transport, result } = await run([
    { toolCalls: [{ id: 'c1', name: 'get_characters', arguments: '{}' }] },
    { content: 'done' },
  ]);

  const secondCall = transport.received[1]!;
  expect(secondCall[0]!.role).toBe('system');
  const assistant = secondCall[secondCall.length - 2]!;
  expect(assistant.role).toBe('assistant');
  expect(assistant.tool_calls).toEqual([
    { id: 'c1', type: 'function', function: { name: 'get_characters', arguments: '{}' } },
  ]);
  const tool = secondCall[secondCall.length - 1]!;
  expect(tool.role).toBe('tool');
  expect(tool.tool_call_id).toBe('c1');
  expect(typeof tool.content).toBe('string');
});

test('system prompt names the characters and the seasonal artifact', async () => {
  const { transport } = await run([{ content: 'ok' }]);
  const system = transport.received[0]![0]!;
  expect(system.role).toBe('system');
  expect(system.content).toContain('Titan');
  expect(system.content).toContain(TITAN_ID);
  expect(system.content).toContain('Tablet of Ruin');
  expect(system.content).toContain('propose_loadout');
});

test('onEvent emits tool-call, tool-result and text events', async () => {
  const { events } = await run([
    { toolCalls: [{ id: 'c1', name: 'get_characters', arguments: '{}' }] },
    { content: 'final words' },
  ]);
  expect(events.map((e) => e.type)).toEqual(['tool-call', 'tool-result', 'text']);
});

test('streamed text deltas from a transport onText are forwarded as text-delta events', async () => {
  // A streaming transport (src/llm) calls this.onText per SSE delta; the
  // runner forwards those to the observer so the panel renders text live.
  const streaming: LLMTransport = {
    async complete() {
      this.onText?.('he');
      this.onText?.('llo');
      return { content: 'hello' };
    },
  };
  const events: AgentEvent[] = [];
  const result = await runAgentTurn({
    transport: streaming,
    snapshot: createFixtureSnapshot(),
    manifest: createFixtureManifest(),
    messages: [{ role: 'user', content: 'hi' }],
    onEvent: (e) => events.push(e),
  });
  expect(events).toEqual([
    { type: 'text-delta', delta: 'he' },
    { type: 'text-delta', delta: 'llo' },
    { type: 'text', content: 'hello' },
  ]);
  expect(result.content).toBe('hello');
});

test('unknown tool names return a correctable error result, not a crash', async () => {
  const { result } = await run([
    { toolCalls: [{ id: 'c1', name: 'delete_vault', arguments: '{}' }] },
    { content: 'recovered' },
  ]);
  expect(result.status).toBe('answer');
  expect(toolMessages(result)[0]).toHaveProperty('error');
});

test('malformed tool arguments return an error the model can correct', async () => {
  const { result } = await run([
    { toolCalls: [{ id: 'c1', name: 'search_items', arguments: '{oops' }] },
    { content: 'recovered' },
  ]);
  expect(result.status).toBe('answer');
  expect(toolMessages(result)[0].error).toContain('search_items');
});

test('a runaway tool loop stops at the iteration cap', async () => {
  const { transport, result } = await run(
    Array(10).fill({ toolCalls: [{ id: 'c', name: 'get_characters', arguments: '{}' }] }),
    { maxIterations: 3 },
  );
  expect(result.status).toBe('iteration-cap');
  expect(transport.received).toHaveLength(3);
});

test.each(['null', '[]', '"text"', '42'])('non-object tool arguments %s return a correctable error', async (argumentsJson) => {
  const { result } = await run([
    { toolCalls: [{ id: 'invalid', name: 'get_characters', arguments: argumentsJson }] },
    { content: 'recovered' },
  ]);
  expect(toolMessages(result)[0].error).toContain('expected a JSON object');
});

test('cancellation stops the remaining local tool batch, not only the next HTTP request', async () => {
  const controller = new AbortController();
  const base = createFixtureManifest();
  let lookupsAfterAbort = 0;
  const manifest = {
    ...base,
    getItem: async (hash: number) => {
      if (controller.signal.aborted) lookupsAfterAbort++;
      return base.getItem(hash);
    },
  };
  const turn = runAgentTurn({
    transport: scriptedTransport([{ toolCalls: [
      { id: 'first', name: 'get_characters', arguments: '{}' },
      { id: 'second', name: 'search_items', arguments: '{}' },
    ] }]),
    manifest,
    snapshot: createFixtureSnapshot(),
    messages: [{ role: 'user', content: 'build' }],
    signal: controller.signal,
    onEvent: (event) => { if (event.type === 'tool-result') controller.abort(); },
  });
  await expect(turn).rejects.toMatchObject({ name: 'AbortError' });
  expect(lookupsAfterAbort).toBe(0);
});

test('an oversized single tool batch is bounded before expensive vault work starts', async () => {
  const { result, events } = await run([{ toolCalls: Array.from({ length: 1000 }, (_, index) => ({
    id: `bulk_${index}`, name: 'search_items', arguments: '{}',
  })) }]);
  expect(result.status).toBe('iteration-cap');
  expect(toolMessages(result)).toEqual([]);
  expect(events).toEqual([]);
});
