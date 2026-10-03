// Scripted agent turn for the preview: emits the same event sequence the real
// runner does (tool calls, streamed text, proposal) with short delays, so
// activity rows, live text, and the build card all render.

import type { ChatMessage } from '../../src/agent/transport';
import type { LoadoutProposal } from '../../src/agent/proposal';
import { PREVIEW_PROPOSAL } from './fixtures';

interface AgentEventTool {
  type: 'tool-call' | 'tool-result';
  id: string;
  name: string;
}
type AgentEvent =
  | AgentEventTool
  | { type: 'text-delta'; delta: string }
  | { type: 'text'; content: string };

interface TurnResult {
  status: 'answer' | 'iteration-cap' | 'proposed';
  toolOutput?: LoadoutProposal;
  content?: string;
  messages: ChatMessage[];
}

interface RunAgentTurnOptions {
  messages: ChatMessage[];
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
  [key: string]: unknown;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<TurnResult> {
  const emit = options.onEvent ?? (() => {});
  const tools = [
    { id: 'pv_01', name: 'get_characters' },
    { id: 'pv_02', name: 'search_items' },
    { id: 'pv_03', name: 'list_subclass_options' },
    { id: 'pv_04', name: 'propose_loadout' },
  ];
  for (const [i, t] of tools.entries()) {
    emit({ type: 'tool-call', id: t.id, name: t.name });
    await wait(350);
    emit({ type: 'tool-result', id: t.id, name: t.name });
    if (i === 1) {
      for (const chunk of ['All three characters are eligible. ', 'I found a GM-ready Solar set…']) {
        emit({ type: 'text-delta', delta: chunk });
        await wait(140);
      }
    }
  }
  emit({ type: 'text', content: 'Done — the build card above is ready for review.' });
  return {
    status: 'proposed',
    toolOutput: PREVIEW_PROPOSAL,
    messages: [...options.messages],
  };
}

export type { AgentEvent, TurnResult, RunAgentTurnOptions };
