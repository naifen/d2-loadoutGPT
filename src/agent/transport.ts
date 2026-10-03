// The injected LLM dependency for the agent runner — one OpenAI-compatible
// "complete a turn" call. The real HTTP+SSE implementation is ticket #8
// (src/llm); tests inject a scripted fake. Messages use the OpenAI wire
// shape so the real transport can send them verbatim.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** May be null on assistant messages that only carry tool_calls. */
  content?: string | null;
  /** Echoed verbatim on assistant messages; arguments stay raw strings. */
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  /** Required on role 'tool' messages — matches the call's id. */
  tool_call_id?: string;
}

/** One function/tool request emitted by the model for a single turn. */
export interface ToolCallRequest {
  id: string;
  name: string;
  /**
   * Raw JSON string exactly as the model emitted it (OpenAI echoes arguments
   * back unparsed; streaming transports concatenate fragments). The runner —
   * not the transport — parses it, so malformed JSON becomes a correctable
   * tool error instead of a thrown exception.
   */
  arguments: string;
}

/** What the transport returns for one completion: text, tool calls, or both. */
export interface AssistantTurn {
  /** Assistant text; may be absent/empty when the model only calls tools. */
  content?: string;
  toolCalls?: ToolCallRequest[];
}

/** One entry of the `tools` array sent on the wire. */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMTransport {
  complete(messages: ChatMessage[], tools: ToolSchema[]): Promise<AssistantTurn>;
  /**
   * Optional streaming hook: the runner assigns it around each complete()
   * call when an observer is attached, and a streaming transport invokes it
   * with each assistant text delta as it arrives. The deltas concatenate to
   * AssistantTurn.content; callers that only want final text can ignore it.
   */
  onText?: (delta: string) => void;
}
