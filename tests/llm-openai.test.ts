// SSE parsing, endpoint trust boundaries, and fragmented completion behavior.

import { afterEach, expect, test, vi } from 'vitest';
import { completionUrl, createOpenAITransport, classify, sseEvents } from '../src/llm/openai';

async function collect(body: string) {
  const events: Record<string, unknown>[] = [];
  for await (const e of sseEvents(new Response(body).body!)) events.push(e);
  return events;
}

test('a \\r\\n\\n event separator does not eat the following data: event', async () => {
  // \r\n\n is a legal 3-byte blank line — treating it as \r\n\r\n consumes the
  // first byte of the next event and drops its `data:` line entirely.
  const events = await collect('data: {"a":1}\r\n\ndata: {"b":2}\n\n');
  expect(events).toEqual([{ a: 1 }, { b: 2 }]);
});

test('data: [DONE] terminates the stream', async () => {
  const events = await collect('data: {"a":1}\n\ndata: [DONE]\n\ndata: {"b":2}\n\n');
  expect(events).toEqual([{ a: 1 }]);
});

test('a 429 with Retry-After classifies as rate-limit carrying the wait', () => {
  const err = classify(429, new Headers({ 'retry-after': '45' }), '{"error":{"message":"slow down"}}');
  expect(err.kind).toBe('rate-limit');
  expect(err.retryAfterSeconds).toBe(45);
});

test('a 400 "does not support tools" body classifies as tools-unsupported', () => {
  const err = classify(400, new Headers(), '{"error":"model does not support tools"}');
  expect(err.kind).toBe('tools-unsupported');
});

afterEach(() => vi.restoreAllMocks());

test('remote endpoints require TLS, while loopback models remain available', () => {
  expect(() => completionUrl('http://models.example/v1')).toThrow(/HTTPS/);
  expect(() => completionUrl('https://user:password@models.example/v1')).toThrow(/credentials/);
  expect(completionUrl('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434/v1/chat/completions');
});

test('incomplete streamed tool arguments never become an executable turn', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"propose_loadout","arguments":"{"}}]}}]}\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  ));
  await expect(createOpenAITransport({ baseUrl: 'http://localhost/v1', apiKey: '', model: 'fixture' })
    .complete([], [])).rejects.toThrow(/before completing/);
});

test('completed streamed tool calls aggregate fragmented names and arguments by index', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response([
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_","arguments":"{\\"instance"}}]}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"item","arguments":"Id\\":\\"123\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
    'data: [DONE]\n\n',
  ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
  const result = await createOpenAITransport({ baseUrl: 'http://localhost/v1', apiKey: '', model: 'fixture' }).complete([], []);
  expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'get_item', arguments: '{"instanceId":"123"}' }]);
});

test('malformed SSE data fails visibly instead of silently dropping a model response', async () => {
  await expect(collect('data: not-json\n\n')).rejects.toThrow(/malformed SSE/);
});

test('oversized unterminated SSE input fails before unbounded buffering', async () => {
  await expect(collect('data: ' + 'x'.repeat(20 * 1024 * 1024))).rejects.toThrow(/response exceeded/);
});
