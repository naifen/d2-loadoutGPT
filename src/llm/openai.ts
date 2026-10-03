// OpenAI-compatible chat-completions transport (spec #1 "LLM transport").
// One POST {baseUrl}/chat/completions with stream:true; SSE chunks are parsed
// dependency-free (fetch + ReadableStream) and aggregated into the runner's
// AssistantTurn: concatenated text plus tool calls keyed by their `index`.
//
// The API key is sent only to the configured endpoint, and only when
// non-empty — local servers (Ollama :11434/v1, LM Studio :1234/v1) need none.
// Kept minimal per the research note: no provider SDKs, no non-standard
// request fields, stream always on.

import type {
  AssistantTurn,
  ChatMessage,
  LLMTransport,
  ToolCallRequest,
  ToolSchema,
} from '../agent/transport';
import { isRecord } from '../type-guards';

/** What the Settings panel persists; see src/storage/llmSettings. */
export interface LlmEndpointSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Keep credentials and inventory off cleartext non-loopback connections. */
export function completionUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new LlmError('http', 'Use HTTPS for the LLM endpoint (HTTP is allowed only on localhost).');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new LlmError('http', 'The LLM base URL must not contain credentials, a query, or a fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return url.href;
}

/** Failure categories the chat panel renders as distinct messages. */
export type LlmErrorKind = 'auth' | 'rate-limit' | 'tools-unsupported' | 'network' | 'http';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    /** Server-provided Retry-After seconds (429/503), when present. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** No bytes for this long => the connection is hung; abort the request. */
const IDLE_TIMEOUT_MS = 60_000;
// Finite even when an endpoint sends endless keepalives or unterminated data.
const MAX_DURATION_MS = 10 * 60_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** How much of a non-JSON error body is worth showing the user. */
const BODY_EXCERPT = 300;

// ---------------------------------------------------------------------------
// Error shapes vary by provider: OpenAI {error:{message,type,code}},
// OpenRouter {error:{code,message,metadata}}, Ollama {error:"<string>"}.

const errorMessage = (body: unknown): string | undefined => {
  if (!isRecord(body)) return undefined;
  if (typeof body.error === 'string') return body.error;
  if (isRecord(body.error) && typeof body.error.message === 'string') return body.error.message;
  return typeof body.message === 'string' ? body.message : undefined;
};

const looksLikeToolsUnsupported = (message: string) => /tool|function call/i.test(message);

export function classify(status: number, headers: Headers, bodyText: string): LlmError {
  const message = errorMessage(tryParse(bodyText)) ?? bodyText.slice(0, BODY_EXCERPT) ?? '';
  const detail = message || `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return new LlmError('auth', `Endpoint rejected the API key (HTTP ${status}): ${detail}`);
  }
  if (status === 429) {
    const retryAfter = Number(headers.get('retry-after'));
    return new LlmError(
      'rate-limit',
      `Rate limited by the endpoint: ${detail}`,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }
  if (status >= 400 && status < 500 && looksLikeToolsUnsupported(detail)) {
    return new LlmError('tools-unsupported', `The endpoint or model does not support tool calling: ${detail}`);
  }
  if (status === 404) {
    return new LlmError('http', `Model not found — check the model name (and that it is pulled/loaded). ${detail}`);
  }
  if (status === 402) {
    return new LlmError('http', `The endpoint reports a billing or credit problem: ${detail}`);
  }
  return new LlmError('http', `LLM endpoint error (HTTP ${status}): ${detail}`);
}

/** Mid-stream `data: {"error": ...}` events (OpenRouter) get the same mapping. */
function classifyStreamError(error: unknown): LlmError {
  const code = isRecord(error) && typeof error.code === 'number' ? error.code : undefined;
  const detail = errorMessage(error) ?? JSON.stringify(error);
  if (code === 401 || code === 403) return new LlmError('auth', `Endpoint rejected the API key: ${detail}`);
  if (code === 429) return new LlmError('rate-limit', `Rate limited by the endpoint: ${detail}`);
  if (typeof code === 'number' && code >= 400 && code < 500 && looksLikeToolsUnsupported(detail)) {
    return new LlmError('tools-unsupported', `The endpoint or model does not support tool calling: ${detail}`);
  }
  return new LlmError('http', `LLM endpoint error${code ? ` (${code})` : ''}: ${detail}`);
}

const tryParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// Minimal SSE reader: `data: <json>\n\n` events, `:`-prefixed keepalives,
// `data: [DONE]` terminator.

export async function* sseEvents(
  stream: ReadableStream<Uint8Array>,
  onBytes?: () => void,
): AsyncGenerator<Record<string, unknown>> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new LlmError('http', 'The endpoint response exceeded the 8 MiB limit.');
      onBytes?.();
      buf += dec.decode(value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buf))) {
        const raw = buf.slice(0, match.index);
        buf = buf.slice(match.index + match[0].length);
        const payload = raw.split('\n').filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart()).join('\n').trimEnd();
        if (!payload) continue;
        if (payload === '[DONE]') return;
        const event = tryParse(payload);
        if (!isRecord(event)) throw new LlmError('http', 'The endpoint returned malformed SSE data.');
        yield event;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}


export function createOpenAITransport(settings: LlmEndpointSettings, signal?: AbortSignal): LLMTransport {
  const url = completionUrl(settings.baseUrl);

  const transport: LLMTransport = {
    async complete(messages: ChatMessage[], tools: ToolSchema[]): Promise<AssistantTurn> {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(new LlmError('network', 'The endpoint response exceeded the 10 minute limit.')), MAX_DURATION_MS);
      let watchdog = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
      const poke = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
      };
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const cleanup = () => {
        clearTimeout(watchdog);
        clearTimeout(deadline);
        signal?.removeEventListener('abort', abort);
      };

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: settings.model,
            messages,
            ...(tools.length ? { tools } : {}),
            stream: true,
          }),
        });
      } catch (e) {
        cleanup();
        if (signal?.aborted) throw signal.reason;
        if (controller.signal.reason instanceof LlmError) throw controller.signal.reason;
        throw controller.signal.aborted
          ? new LlmError('network', `No response from ${url} for ${IDLE_TIMEOUT_MS / 1000}s — gave up waiting.`)
          : new LlmError('network', `Cannot reach the LLM endpoint at ${url} — check the base URL and that the server is running. (${(e as Error).message})`);
      }

      if (!res.ok) {
        try {
          const reader = res.body?.getReader();
          let detail = '';
          try {
            const first = await reader?.read();
            // Error status already supplies the category; never buffer an untrusted error body.
            if (first?.value) detail = new TextDecoder().decode(first.value.subarray(0, 4096));
          } finally {
            await reader?.cancel().catch(() => {});
            reader?.releaseLock();
          }
          throw classify(res.status, res.headers, detail);
        } finally {
          cleanup();
        }
      }
      if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream')) {
        cleanup();
        await res.body?.cancel();
        throw new LlmError('http', 'The endpoint did not return an SSE stream. Check the base URL and streaming support.');
      }

      let content = '';
      const slots = new Map<number, { id: string; name: string; args: string }>();
      let finishReason: string | null | undefined;
      try {
        for await (const raw of sseEvents(res.body, poke)) {
          if (raw.error) throw classifyStreamError(raw.error);
          if (raw.choices === undefined) continue;
          if (!Array.isArray(raw.choices)) throw new LlmError('http', 'Invalid SSE choices.');
          const choices: unknown[] = raw.choices;
          for (const choice of choices) {
            if (!isRecord(choice)) throw new LlmError('http', 'Invalid SSE choice.');
            if (choice.index !== undefined && choice.index !== 0) continue;
            if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
            const delta = choice.delta;
            if (delta === undefined) continue;
            if (!isRecord(delta)) throw new LlmError('http', 'Invalid SSE delta.');
            if (typeof delta.content === 'string' && delta.content) {
              content += delta.content;
              transport.onText?.(delta.content);
            }
            if (delta.tool_calls === undefined) continue;
            if (!Array.isArray(delta.tool_calls)) throw new LlmError('http', 'Invalid SSE tool calls.');
            const calls: unknown[] = delta.tool_calls;
            for (const tc of calls) {
              if (!isRecord(tc) || (tc.index !== undefined && (!Number.isInteger(tc.index) || Number(tc.index) < 0))) {
                throw new LlmError('http', 'Invalid SSE tool call index.');
              }
              const i = typeof tc.index === 'number' ? tc.index : 0;
              const slot = slots.get(i) ?? { id: '', name: '', args: '' };
              if (typeof tc.id === 'string') slot.id = tc.id;
              if (tc.function !== undefined && !isRecord(tc.function)) throw new LlmError('http', 'Invalid SSE function.');
              if (isRecord(tc.function)) {
                if (typeof tc.function.name === 'string') slot.name += tc.function.name;
                if (typeof tc.function.arguments === 'string') slot.args += tc.function.arguments;
              }
              slots.set(i, slot);
            }
          }
        }
      } catch (e) {
        if (signal?.aborted) throw signal.reason;
        if (controller.signal.reason instanceof LlmError) throw controller.signal.reason;
        if (controller.signal.aborted && !(e instanceof LlmError)) {
          throw new LlmError('network', `The endpoint stopped sending data for ${IDLE_TIMEOUT_MS / 1000}s — gave up waiting.`);
        }
        throw e;
      } finally {
        cleanup();
      }
      if (finishReason !== 'stop' && finishReason !== 'tool_calls') {
        throw new LlmError('http', finishReason
          ? `The endpoint could not complete the response (${finishReason}).`
          : 'The endpoint closed the stream before completing the response. Please retry.');
      }

      const toolCalls: ToolCallRequest[] = [...slots.entries()]
        .sort(([a], [b]) => a - b)
        .map(([i, s]) => ({ id: s.id || `call_${i}`, name: s.name, arguments: s.args }));
      return {
        content: content || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      };
    },
  };
  return transport;
}
