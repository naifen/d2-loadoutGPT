// The OpenAI transport's pure seams: the SSE event parser (data: events split
// on blank lines, `data: [DONE]` terminator) and the HTTP-error classifier.
// Driven with plain streams and headers — no fetch mocking.

import { expect, test } from 'vitest';
import { classify, sseEvents } from '../src/llm/openai';

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
