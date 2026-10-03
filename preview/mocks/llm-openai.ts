// Transport stub — the preview never opens a network connection; runAgentTurn
// is itself mocked, so the transport object is a placeholder.

import type { AssistantTurn, ChatMessage, LLMTransport, ToolSchema } from '../../src/agent/transport';

export interface LlmEndpointSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type LlmErrorKind = 'auth' | 'rate-limit' | 'tools-unsupported' | 'network' | 'http';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export function createOpenAITransport(
  _settings: LlmEndpointSettings,
  _signal?: AbortSignal,
): LLMTransport {
  return {
    complete: async (_messages: ChatMessage[], _tools: ToolSchema[]): Promise<AssistantTurn> => ({}),
  };
}

export function completionUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}
