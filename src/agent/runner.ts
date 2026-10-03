// The agent turn runner — the spec's single tested seam. It owns the
// tool-call loop: prepend the system prompt, call the LLM, execute any
// requested tools against the injected snapshot + manifest, append results,
// repeat until the model answers with plain text or the iteration cap hits.
// Pure with respect to its dependencies: tests drive it with a scripted fake
// transport and fixture data.

import type { Manifest } from '../bungie/manifest';
import type { ProfileSnapshot } from '../bungie/profile';
import { buildSystemPrompt } from './system-prompt';
import { executeAgentTool, TOOL_SCHEMAS } from './tools';
import type { AgentToolContext } from './item-context';
import type { LoadoutProposal } from './proposal';
import type { AssistantTurn, ChatMessage, LLMTransport } from './transport';

/** What the runner surfaces while it works — #8 renders these as activity rows. */
export type AgentEvent =
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: 'tool-result'; id: string; name: string; result: unknown }
  /** One streamed assistant text fragment, forwarded from transport.onText. */
  | { type: 'text-delta'; delta: string }
  | { type: 'text'; content: string };

export type TurnResult = (
  | { status: 'answer'; content: string; toolOutput?: never }
  | { status: 'iteration-cap'; content?: never; toolOutput?: never }
  | { status: 'proposed'; toolOutput: LoadoutProposal; content?: never }
) & { messages: ChatMessage[] };

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
  signal?: AbortSignal;
}

const DEFAULT_MAX_ITERATIONS = 12;
const MAX_TOOL_CALLS = 64;

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<TurnResult> {
  const { transport, snapshot, manifest, onEvent, signal } = options;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const ctx: AgentToolContext = { snapshot, manifest };
  signal?.throwIfAborted();

  // `history` is what we hand back (no system prompt); `wire` is what the
  // transport sees (system prompt first).
  const history: ChatMessage[] = [...options.messages];
  const wire: ChatMessage[] = [
    { role: 'system', content: await buildSystemPrompt(snapshot, manifest) },
    ...history,
  ];

  let iterations = 0;
  let toolCalls = 0;
  for (;;) {
    signal?.throwIfAborted();
    // A streaming transport (src/llm) invokes its onText hook per text
    // delta; forward those to the observer so the panel can render text as
    // it arrives. Any hook the caller set still runs.
    const previousOnText = transport.onText;
    transport.onText = (delta) => {
      previousOnText?.(delta);
      onEvent?.({ type: 'text-delta', delta });
    };
    let turn: AssistantTurn;
    try {
      turn = await transport.complete(wire, TOOL_SCHEMAS);
    } finally {
      transport.onText = previousOnText;
    }
    signal?.throwIfAborted();

    if (!turn.toolCalls?.length) {
      const content = turn.content ?? '';
      history.push({ role: 'assistant', content });
      onEvent?.({ type: 'text', content });
      return { status: 'answer', content, messages: history };
    }
    toolCalls += turn.toolCalls.length;
    if (toolCalls > MAX_TOOL_CALLS) return { status: 'iteration-cap', messages: history };

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

    let proposal: LoadoutProposal | undefined;
    for (const call of turn.toolCalls) {
      signal?.throwIfAborted();
      onEvent?.({ type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments });
      const execution = proposal
        ? { result: { error: 'Turn already ended with a loadout proposal; this call was not executed.' } }
        : await executeAgentTool(call.name, call.arguments, ctx);
      signal?.throwIfAborted();
      const toolMessage: ChatMessage = {
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(execution.result ?? null),
      };
      wire.push(toolMessage);
      history.push(toolMessage);
      onEvent?.({ type: 'tool-result', id: call.id, name: call.name, result: execution.result });
      if ('proposal' in execution && execution.proposal) proposal = execution.proposal;
    }
    if (proposal) return { status: 'proposed', toolOutput: proposal, messages: history };

    iterations++;
    if (iterations >= maxIterations) return { status: 'iteration-cap', messages: history };
  }
}

