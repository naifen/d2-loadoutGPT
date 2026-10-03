// The chat panel (ticket #8): conversation list, streamed assistant text,
// tool-activity rows, and distinct endpoint errors. Each send runs one agent
// turn via runAgentTurn with the real OpenAI-compatible transport; the wire
// history (minus system prompt) persists in session storage so it survives
// panel closes but not a browser restart.
//
// A turn that ends on the terminal propose_loadout tool arrives here as a Row
// of kind 'proposal' carrying the LoadoutProposal — rendered by BuildCard (#9).

import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';
import { runAgentTurn } from '../agent/runner';
import type { TurnResult } from '../agent/runner';
import { PROPOSE_LOADOUT_TOOL_NAME } from '../agent/system-prompt';
import type { LoadoutProposal } from '../agent/proposal';
import type { ChatMessage } from '../agent/transport';
import { getTokens } from '../bungie/auth';
import { openManifest } from '../bungie/manifest';
import type { ManifestHandle } from '../bungie/manifest';
import { getSnapshot } from '../bungie/profile';
import { createOpenAITransport, LlmError } from '../llm/openai';
import { clearChatHistory, loadChatHistory, saveChatHistory } from '../storage/chatHistory';
import { getLlmSettings, isLlmConfigured } from '../storage/llmSettings';
import { BuildCard } from './BuildCard';
import { isRecord } from '../type-guards';

type Row =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'activity'; id: string; label: string; done: boolean }
  | { kind: 'proposal'; output: LoadoutProposal }
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
  const callNames = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'user') {
      rows.push({ kind: 'user', text: m.content ?? '' });
    } else if (m.role === 'assistant') {
      if (m.content) rows.push({ kind: 'assistant', text: m.content });
      for (const tc of m.tool_calls ?? []) {
        callNames.set(tc.id, tc.function.name);
        rows.push({ kind: 'activity', id: tc.id, label: toolLabel(tc.function.name), done: true });
      }
    } else if (m.role === 'tool' && callNames.get(m.tool_call_id ?? '') === PROPOSE_LOADOUT_TOOL_NAME) {
      // The terminal tool result persists the LoadoutProposal — restore the card.
      const proposal = m.content ? restoreProposal(m.content) : undefined;
      if (proposal) rows.push({ kind: 'proposal', output: proposal });
    }
    // other tool messages need no row — the activity row already stands for them
  }
  return rows;
}

function restoreProposal(text: string): LoadoutProposal | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return;
    const p = value;
    if (typeof p.name !== 'string' || typeof p.url !== 'string' || typeof p.query !== 'string' || typeof p.card !== 'string') return;
    const url = new URL(p.url);
    if (url.origin !== 'https://app.destinyitemmanager.com' || url.pathname !== '/loadouts' || !url.searchParams.has('loadout')) return;
    return { name: p.name, url: p.url, query: p.query, card: p.card };
  } catch {
    return undefined;
  }
}

function errorText(e: unknown): string {
  if (e instanceof LlmError) {
    switch (e.kind) {
      case 'auth':
        return `${e.message} — check the API key under LLM endpoint in Settings.`;
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
  const manifestRef = useRef<Promise<ManifestHandle>>();
  const listRef = useRef<HTMLUListElement>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const generation = useRef(0);
  const controller = useRef<AbortController>();
  const [historyReady, setHistoryReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    let manifest: ManifestHandle | undefined;
    const current = generation.current;
    manifestRef.current = openManifest().then((m) => {
      if (mounted) {
        manifest = m;
        setManifestReady(true);
      } else m.close();
      return m;
    });
    manifestRef.current.catch((e) => {
      setRows((r) => [...r, { kind: 'error', text: `Could not open the manifest database: ${(e as Error).message}` }]);
    });
    loadChatHistory().then((h) => {
      if (current !== generation.current) return;
      historyRef.current = h;
      setRows((r) => [...rowsFromHistory(h), ...r]);
      setHistoryReady(true);
    }).catch((e) => {
      if (current !== generation.current) return;
      setRows((r) => [...r, { kind: 'error', text: errorText(e) }]);
      setHistoryReady(true);
    });
    const onChanged = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      const change = changes.bungieTokens;
      if (area !== 'local' || !change) return;
      const previous = isRecord(change.oldValue) ? change.oldValue.sessionId : undefined;
      const next = isRecord(change.newValue) ? change.newValue.sessionId : undefined;
      if (previous === next) return;
      resetConversation();
      setHistoryReady(true);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      mounted = false;
      manifest?.close();
      generation.current++;
      controller.current?.abort();
      browser.storage.onChanged.removeListener(onChanged);
    };
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
    if (!text || runningRef.current || !manifestReady || !historyReady) return;
    runningRef.current = true;
    setRunning(true);
    const current = generation.current;
    const active = () => current === generation.current;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const [settings, tokens] = await Promise.all([getLlmSettings(), getTokens()]);
      if (!active()) return;
      if (!isLlmConfigured(settings)) {
        return appendRow({ kind: 'notice', text: 'Set your LLM endpoint (base URL + model) first — expand LLM endpoint in Settings below.' });
      }
      if (!tokens) {
        return appendRow({ kind: 'notice', text: 'Log in with Bungie first — the assistant works from your inventory.' });
      }
      setInput('');
      appendRow({ kind: 'user', text });
      const [snapshot, manifest] = await Promise.all([getSnapshot(), manifestRef.current!]);
      if (!active()) return;
      const result: TurnResult = await runAgentTurn({
        transport: createOpenAITransport(settings, abort.signal),
        snapshot,
        manifest,
        signal: abort.signal,
        messages: [...historyRef.current, { role: 'user', content: text }],
        onEvent: (event) => {
          if (!active()) return;
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
      if (!active()) return;
      historyRef.current = result.messages;
      if (result.status === 'proposed') appendRow({ kind: 'proposal', output: result.toolOutput });
      await saveChatHistory(result.messages, tokens.sessionId, abort.signal);
      if (!active()) return;
      if (result.status === 'iteration-cap') {
        appendRow({
          kind: 'notice',
          text: 'The assistant hit its tool-call limit before finishing — try a narrower request.',
        });
      }
    } catch (e) {
      if (active()) appendRow({ kind: 'error', text: errorText(e) });
    } finally {
      if (!active()) return;
      liveRef.current = '';
      setLive('');
      runningRef.current = false;
      setRunning(false);
    }
  }

  function resetConversation() {
    generation.current++;
    controller.current?.abort();
    historyRef.current = [];
    runningRef.current = false;
    setRunning(false);
    liveRef.current = '';
    setLive('');
    setRows([]);
    setInput('');
  }

  async function newConversation() {
    resetConversation();
    setHistoryReady(false);
    try {
      await clearChatHistory();
    } catch (e) {
      appendRow({ kind: 'error', text: errorText(e) });
    } finally {
      setHistoryReady(true);
    }
  }

  return (
    <section class="chat">
      <h2>Loadout assistant</h2>
      <ul ref={listRef} class="chat-log">
        {rows.length === 0 && !live && !running && (
          <li class="chat-empty">
            <p>
              <em>Ask for a loadout — the assistant works from your inventory.</em>
            </p>
          </li>
        )}
        {rows.map((row, i) => (
          <li key={i} class={`row row-${row.kind}`}>
            {renderRow(row)}
          </li>
        ))}
        {live && (
          <li class="row row-live">
            <em>{live}</em>
          </li>
        )}
        {running && !live && (
          <li class="row row-thinking">
            <em>Thinking…</em>
          </li>
        )}
      </ul>
      <form
        class="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          onInput={(e) => setInput(e.currentTarget.value)}
          disabled={running || !manifestReady || !historyReady}
          placeholder="e.g. Solar Titan for a Grandmaster Nightfall"
          aria-label="Loadout request"
        />
        <button
          class="btn"
          type="submit"
          disabled={running || !manifestReady || !historyReady || !input.trim()}
        >
          Send
        </button>
        <button class="btn" type="button" onClick={newConversation}>
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
      return <p>{row.text}</p>;
    case 'activity':
      return (
        <p>
          {row.done && (
            <svg class="icon-check" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" stroke-width="1.5" />
            </svg>
          )}
          <em>{row.done ? row.label.replace(/…$/, '') : row.label}</em>
        </p>
      );
    case 'proposal':
      return <BuildCard proposal={row.output} />;
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
