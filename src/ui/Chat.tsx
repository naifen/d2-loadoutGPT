// The chat panel (ticket #8): conversation list, streamed assistant text,
// tool-activity rows, and distinct endpoint errors. Each send runs one agent
// turn via runAgentTurn with the real OpenAI-compatible transport; the wire
// history (minus system prompt) persists in session storage so it survives
// panel closes but not a browser restart.
//
// Hook for #9: a turn that ends on the terminal tool arrives here as a Row of
// kind 'proposal' carrying TurnResult.toolOutput — replace the placeholder
// rendering with the build card + DIM link + copy buttons.

import { useEffect, useRef, useState } from 'preact/hooks';
import { runAgentTurn, type TurnResult } from '../agent/runner';
import type { ChatMessage } from '../agent/transport';
import { getTokens } from '../bungie/auth';
import { getManifestVersion, openManifest, type Manifest } from '../bungie/manifest';
import { getSnapshot } from '../bungie/profile';
import { createOpenAITransport, LlmError } from '../llm/openai';
import { clearChatHistory, loadChatHistory, saveChatHistory } from '../storage/chatHistory';
import { getLlmSettings, isLlmConfigured } from '../storage/llmSettings';

type Row =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'activity'; id: string; label: string; done: boolean }
  | { kind: 'proposal'; status: string; output: unknown }
  | { kind: 'notice'; text: string }
  | { kind: 'error'; text: string };

const TOOL_LABELS: Record<string, string> = {
  get_characters: 'Reading characters…',
  search_items: 'Searching the vault…',
  get_item: 'Reading item details…',
  list_subclass_options: 'Reading subclass options…',
  get_artifact: 'Reading the seasonal artifact…',
  propose_loadout: 'Assembling the loadout…',
};

const toolLabel = (name: string) => TOOL_LABELS[name] ?? `Running ${name}…`;

/** Rebuild display rows from a persisted wire history (panel reopened). */
function rowsFromHistory(messages: ChatMessage[]): Row[] {
  const rows: Row[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      rows.push({ kind: 'user', text: m.content ?? '' });
    } else if (m.role === 'assistant') {
      if (m.content) rows.push({ kind: 'assistant', text: m.content });
      for (const tc of m.tool_calls ?? []) {
        rows.push({ kind: 'activity', id: tc.id, label: toolLabel(tc.function.name), done: true });
      }
    }
    // tool messages need no row — the activity row already stands for them
  }
  return rows;
}

function errorText(e: unknown): string {
  if (e instanceof LlmError) {
    switch (e.kind) {
      case 'auth':
        return `${e.message} — check the API key in Settings.`;
      case 'rate-limit':
        return `${e.message} — wait ${e.retryAfterSeconds ? `~${e.retryAfterSeconds}s` : 'a moment'} and try again.`;
      case 'tools-unsupported':
        return `${e.message} — this endpoint or model cannot drive the assistant; pick one that supports tool calling.`;
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

export function Chat() {
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState('');
  const [live, setLive] = useState('');
  const [running, setRunning] = useState(false);
  const [manifestReady, setManifestReady] = useState(false);
  const runningRef = useRef(false); // state is stale within the submit tick
  const liveRef = useRef('');
  const manifestRef = useRef<Promise<Manifest>>();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    manifestRef.current = openManifest().then((m) => {
      setManifestReady(true);
      return m;
    });
    manifestRef.current.catch((e) => {
      setRows((r) => [...r, { kind: 'error', text: `Could not open the manifest database: ${(e as Error).message}` }]);
    });
    loadChatHistory().then((h) => setRows(rowsFromHistory(h)));
  }, []);

  // Keep the latest exchange in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [rows, live]);

  const appendRow = (row: Row) => setRows((r) => [...r, row]);

  /** Move streamed-but-interim assistant text into a row before a tool row. */
  const flushLive = () => {
    if (!liveRef.current) return;
    appendRow({ kind: 'assistant', text: liveRef.current });
    liveRef.current = '';
    setLive('');
  };

  async function send() {
    const text = input.trim();
    if (!text || runningRef.current || !manifestReady) return;

    const settings = await getLlmSettings();
    if (!isLlmConfigured(settings)) {
      return appendRow({ kind: 'notice', text: 'Set your LLM endpoint (base URL + model) in Settings above first.' });
    }
    if (!(await getTokens())) {
      return appendRow({ kind: 'notice', text: 'Log in with Bungie first — the assistant works from your inventory.' });
    }
    if (!(await getManifestVersion())) {
      return appendRow({ kind: 'notice', text: 'Game definitions are still downloading — try again in a moment.' });
    }

    setInput('');
    appendRow({ kind: 'user', text });
    runningRef.current = true;
    setRunning(true);
    try {
      const [snapshot, manifest] = await Promise.all([getSnapshot(), manifestRef.current!]);
      const result: TurnResult = await runAgentTurn({
        transport: createOpenAITransport(settings),
        snapshot,
        manifest,
        // Session storage is the source of truth for prior context — a
        // send can land before the mount-time restore resolved.
        messages: [...(await loadChatHistory()), { role: 'user', content: text }],
        onEvent: (event) => {
          switch (event.type) {
            case 'text-delta':
              liveRef.current += event.delta;
              setLive(liveRef.current);
              break;
            case 'tool-call':
              flushLive();
              appendRow({ kind: 'activity', id: event.id, label: toolLabel(event.name), done: false });
              break;
            case 'tool-result':
              setRows((r) =>
                r.map((row) => (row.kind === 'activity' && row.id === event.id ? { ...row, done: true } : row)),
              );
              break;
            case 'text':
              // The final content IS the accumulated deltas — drop the live
              // line and push the finished message once.
              liveRef.current = '';
              setLive('');
              if (event.content) appendRow({ kind: 'assistant', text: event.content });
              break;
          }
        },
      });
      await saveChatHistory(result.messages);
      if (result.status === 'iteration-cap') {
        appendRow({
          kind: 'notice',
          text: 'The assistant hit its tool-call limit before finishing — try a narrower request.',
        });
      } else if (result.status !== 'answer') {
        // Terminal tool (propose_loadout, #7): #9 renders the real build card.
        appendRow({ kind: 'proposal', status: result.status, output: result.toolOutput });
      }
    } catch (e) {
      appendRow({ kind: 'error', text: errorText(e) });
    } finally {
      liveRef.current = '';
      setLive('');
      runningRef.current = false;
      setRunning(false);
    }
  }

  async function newConversation() {
    liveRef.current = '';
    setLive('');
    setRows([]);
    await clearChatHistory();
  }

  return (
    <section>
      <h2>Loadout assistant</h2>
      <ul
        ref={listRef}
        style={{ listStyle: 'none', padding: 0, maxHeight: '24em', overflowY: 'auto' }}
      >
        {rows.map((row, i) => (
          <li key={i}>{renderRow(row)}</li>
        ))}
        {live && (
          <li>
            <em style={{ whiteSpace: 'pre-wrap' }}>{live}</em>
          </li>
        )}
        {running && !live && (
          <li>
            <em>Thinking…</em>
          </li>
        )}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          onInput={(e) => setInput(e.currentTarget.value)}
          disabled={running || !manifestReady}
          placeholder="e.g. Solar Titan for a Grandmaster Nightfall"
          style={{ width: '70%' }}
        />
        <button type="submit" disabled={running || !manifestReady || !input.trim()}>
          Send
        </button>{' '}
        <button type="button" disabled={running} onClick={newConversation}>
          New conversation
        </button>
      </form>
    </section>
  );
}

function renderRow(row: Row) {
  switch (row.kind) {
    case 'user':
      return (
        <p>
          <strong>You:</strong> {row.text}
        </p>
      );
    case 'assistant':
      return <p style={{ whiteSpace: 'pre-wrap' }}>{row.text}</p>;
    case 'activity':
      return (
        <p>
          <em>{row.done ? `✓ ${row.label.replace(/…$/, '')}` : row.label}</em>
        </p>
      );
    case 'proposal':
      // #9 replaces this placeholder with the build card, DIM link and copy buttons.
      return (
        <div>
          <p>Loadout proposed (status: {row.status}).</p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(row.output, null, 2)}</pre>
        </div>
      );
    case 'notice':
      return (
        <p>
          <em>{row.text}</em>
        </p>
      );
    case 'error':
      return <p role="alert">{row.text}</p>;
  }
}
