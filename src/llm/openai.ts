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

/** What the Settings panel persists; see src/storage/llmSettings. */
export interface LlmEndpointSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
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
/** How much of a non-JSON error body is worth showing the user. */
const BODY_EXCERPT = 300;

// ---------------------------------------------------------------------------
// Error shapes vary by provider: OpenAI {error:{message,type,code}},
// OpenRouter {error:{code,message,metadata}}, Ollama {error:"<string>"}.

const errorMessage = (body: unknown): string | undefined => {
  const err = body as { error?: { message?: string } | string; message?: string } | undefined;
  if (typeof err?.error === 'string') return err.error;
  return err?.error?.message ?? err?.message;
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
  const { code, message } = (error ?? {}) as { code?: number; message?: string };
  const detail = message ?? JSON.stringify(error);
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
): AsyncGenerator<Record<string, unknown>> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let match;
    // Separators are 2–4 bytes (\n\n, \r\n\n, \n\r\n, \r\n\r\n) — slice on the
    // match length, not on a guessed width, or a \r\n\n eats a byte of the
    // next event and drops its `data:` line.
    while ((match = /\r?\n\r?\n/.exec(buf))) {
      const raw = buf.slice(0, match.index);
      buf = buf.slice(match.index + match[0].length);
      const dataLines = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart());
      if (!dataLines.length) continue; // comment/keepalive-only event
      const payload = dataLines.join('\n');
      if (payload === '[DONE]') return;
      try {
        yield JSON.parse(payload) as Record<string, unknown>;
      } catch {
        // tolerate malformed keepalives
      }
    }
  }
}

// Delta chunk shapes, loosely typed — providers copy the OpenAI wire format.
interface StreamDelta {
  content?: string;
  tool_calls?: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
}
interface StreamChunk {
  choices?: { delta?: StreamDelta; finish_reason?: string | null }[];
  error?: unknown;
}

// ---------------------------------------------------------------------------

export function createOpenAITransport(settings: LlmEndpointSettings): LLMTransport {
  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const transport: LLMTransport = {
    async complete(messages: ChatMessage[], tools: ToolSchema[]): Promise<AssistantTurn> {
      const controller = new AbortController();
      let watchdog = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
      const poke = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
      };

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
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
        clearTimeout(watchdog);
        throw controller.signal.aborted
          ? new LlmError('network', `No response from ${url} for ${IDLE_TIMEOUT_MS / 1000}s — gave up waiting.`)
          : new LlmError('network', `Cannot reach the LLM endpoint at ${url} — check the base URL and that the server is running. (${(e as Error).message})`);
      }

      if (!res.ok) {
        clearTimeout(watchdog);
        throw classify(res.status, res.headers, await res.text().catch(() => ''));
      }

      let content = '';
      const slots = new Map<number, { id: string; name: string; args: string }>();
      try {
        for await (const raw of sseEvents(res.body!)) {
          poke();
          const chunk = raw as StreamChunk;
          if (chunk.error) throw classifyStreamError(chunk.error);
          for (const choice of chunk.choices ?? []) {
            const delta = choice.delta;
            if (typeof delta?.content === 'string' && delta.content) {
              content += delta.content;
              transport.onText?.(delta.content);
            }
            for (const tc of delta?.tool_calls ?? []) {
              const i = tc.index ?? 0;
              const slot = slots.get(i) ?? { id: '', name: '', args: '' };
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name += tc.function.name;
              if (tc.function?.arguments) slot.args += tc.function.arguments;
              slots.set(i, slot);
            }
          }
        }
      } catch (e) {
        if (controller.signal.aborted && !(e instanceof LlmError)) {
          throw new LlmError('network', `The endpoint stopped sending data for ${IDLE_TIMEOUT_MS / 1000}s — gave up waiting.`);
        }
        throw e;
      } finally {
        clearTimeout(watchdog);
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
