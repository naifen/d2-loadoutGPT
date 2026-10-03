// The agent turn runner — the spec's single tested seam. It owns the
// tool-call loop: prepend the system prompt, call the LLM, execute any
// requested tools against the injected snapshot + manifest, append results,
// repeat until the model answers with plain text or the iteration cap hits.
// Pure with respect to its dependencies: tests drive it with a scripted fake
// transport and fixture data.

import type { Manifest } from '../bungie/manifest';
import type { ProfileSnapshot } from '../bungie/profile';
import { buildSystemPrompt } from './system-prompt';
import { AGENT_TOOLS, executeAgentTool, TOOL_SCHEMAS, type AgentToolContext } from './tools';
import type { AssistantTurn, ChatMessage, LLMTransport } from './transport';

/** What the runner surfaces while it works — #8 renders these as activity rows. */
export type AgentEvent =
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: 'tool-result'; id: string; name: string; result: unknown }
  | { type: 'text'; content: string };

export interface TurnResult {
  /**
   * 'answer' — the model replied with text and no tool calls.
   * 'iteration-cap' — maxIterations tool rounds exhausted without an answer.
   * A terminal tool may end the turn with its own status (e.g. #7's
   * propose_loadout), in which case `toolOutput` carries its payload.
   */
  status: 'answer' | 'iteration-cap' | (string & {});
  /** Final assistant text when status === 'answer'. */
  content?: string;
  /** Payload produced by a terminal tool, when it ended the turn. */
  toolOutput?: unknown;
  /**
   * The conversation history in OpenAI wire shape — user/assistant/tool
   * messages only (the system prompt is prepended per call and excluded so it
   * can be rebuilt fresh each turn). Pass this back as `messages` to continue
   * the conversation.
   */
  messages: ChatMessage[];
}

export interface RunAgentTurnOptions {
  transport: LLMTransport;
  snapshot: ProfileSnapshot;
  manifest: Manifest;
  /** Prior conversation (user/assistant/tool messages; no system prompt needed). */
  messages: ChatMessage[];
  /** Optional observer for tool-call/tool-result/text events (activity UI). */
  onEvent?: (event: AgentEvent) => void;
  /** Max LLM→tool rounds before the turn aborts with 'iteration-cap'. */
  maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 12;

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<TurnResult> {
  const { transport, snapshot, manifest, onEvent } = options;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const ctx: AgentToolContext = { snapshot, manifest };

  // `history` is what we hand back (no system prompt); `wire` is what the
  // transport sees (system prompt first).
  const history: ChatMessage[] = [...options.messages];
  const wire: ChatMessage[] = [
    { role: 'system', content: await buildSystemPrompt(snapshot, manifest) },
    ...history,
  ];

  let iterations = 0;
  for (;;) {
    const turn: AssistantTurn = await transport.complete(wire, TOOL_SCHEMAS);

    if (!turn.toolCalls?.length) {
      const content = turn.content ?? '';
      history.push({ role: 'assistant', content });
      onEvent?.({ type: 'text', content });
      return { status: 'answer', content, messages: history };
    }

    const assistant: ChatMessage = {
      role: 'assistant',
      content: turn.content ?? null,
      tool_calls: turn.toolCalls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.arguments },
      })),
    };
    wire.push(assistant);
    history.push(assistant);

    for (const call of turn.toolCalls) {
      onEvent?.({ type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments });
      const execution = await executeAgentTool(call.name, call.arguments, ctx);
      const toolMessage: ChatMessage = {
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(execution.result ?? null),
      };
      wire.push(toolMessage);
      history.push(toolMessage);
      onEvent?.({ type: 'tool-result', id: call.id, name: call.name, result: execution.result });
      if (execution.terminal) {
        return { status: execution.terminal.status, toolOutput: execution.terminal.output, messages: history };
      }
    }

    iterations++;
    if (iterations >= maxIterations) return { status: 'iteration-cap', messages: history };
  }
}

// Re-export so callers see the whole seam from one module.
export { AGENT_TOOLS, TOOL_SCHEMAS };
export type { AgentToolContext };
