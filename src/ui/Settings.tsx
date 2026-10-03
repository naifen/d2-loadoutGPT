import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { getTokens, login, logout } from '../bungie/auth';
import type { BungieTokens } from '../bungie/auth';
import { bungieFetch } from '../bungie/http';
import type { LlmEndpointSettings } from '../llm/openai';
import { DEFAULT_LLM_SETTINGS, getLlmSettings, saveLlmSettings } from '../storage/llmSettings';
import type { LlmSettings } from '../storage/llmSettings';

interface Memberships {
  bungieNetUser: { uniqueName: string };
}

export function Settings() {
  const [tokens, setTokens] = useState<BungieTokens | undefined>();
  const [name, setName] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [llm, setLlm] = useState<LlmSettings>(DEFAULT_LLM_SETTINGS);
  const [llmSaved, setLlmSaved] = useState(false);
  const generation = useRef(0);

  // Also exercises bungieFetch (API key, Origin, silent refresh) on every panel open.
  async function sync() {
    const current = ++generation.current;
    const t = await getTokens();
    if (current !== generation.current) return;
    setTokens(t);
    setName(undefined);
    if (!t) return;
    try {
      const memberships = await bungieFetch<Memberships>('/User/GetMembershipsForCurrentUser/');
      if (current === generation.current) setName(memberships.bungieNetUser.uniqueName);
    } catch (e) {
      if (current !== generation.current) return;
      setError(e instanceof Error ? e.message : String(e));
      const latest = await getTokens();
      if (current === generation.current) setTokens(latest);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
    await sync();
    setBusy(false);
  }

  useEffect(() => {
    void sync();
    getLlmSettings().then(setLlm).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && 'bungieTokens' in changes) void sync();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      generation.current++;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  async function saveLlm() {
    setLlmSaved(false);
    setError(undefined);
    try {
      await saveLlmSettings(llm);
      setLlmSaved(true);
      setTimeout(() => setLlmSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const setLlmField = (field: keyof LlmEndpointSettings) => (e: Event) => {
    const value = (e.currentTarget as HTMLInputElement).value;
    setLlm((current) => {
      let apiKey = current.apiKey;
      if (field === 'baseUrl') {
        try {
          if (new URL(value).origin !== new URL(current.baseUrl).origin) apiKey = '';
        } catch {
          apiKey = '';
        }
      }
      return { ...current, apiKey, [field]: value };
    });
    setLlmSaved(false);
  };

  return (
    <section>
      <h2>Bungie account</h2>
      {tokens ? (
        <p>
          Signed in as {name ?? `membership ${tokens.membershipId}`}{' '}
          <button disabled={busy} onClick={() => run(logout)}>
            Log out
          </button>
        </p>
      ) : (
        <button disabled={busy} onClick={() => run(login)}>
          Log in with Bungie
        </button>
      )}
      {error && <p role="alert">{error}</p>}

      <h2>LLM endpoint</h2>
      <p>
        Any OpenAI-compatible chat endpoint with tool calling. By default, the key stays
        in memory until the browser restarts or the extension reloads, and is sent only to the
        configured endpoint. Changing the endpoint origin clears the key.
      </p>
      <p>
        <label>
          Base URL{' '}
          <input
            value={llm.baseUrl}
            onInput={setLlmField('baseUrl')}
            placeholder="https://api.openai.com/v1"
            size={32}
          />
        </label>
      </p>
      <p>
        <label>
          API key{' '}
          <input
            type="password"
            value={llm.apiKey}
            onInput={setLlmField('apiKey')}
            placeholder="empty for local servers"
            size={32}
          />
        </label>
      </p>
      <p>
        <label>
          <input
            type="checkbox"
            checked={llm.rememberKey}
            onChange={(e) => {
              setLlm({ ...llm, rememberKey: e.currentTarget.checked });
              setLlmSaved(false);
            }}
            aria-describedby="remember-key-warning"
          />{' '}
          Remember key on this device
        </label>
        <br />
        <small id="remember-key-warning">
          Optional: saves the key unencrypted in your browser profile. Use only on a trusted device.
        </small>
      </p>
      <p>
        <label>
          Model{' '}
          <input
            value={llm.model}
            onInput={setLlmField('model')}
            placeholder="e.g. gpt-4o-mini, qwen3:8b"
            size={32}
          />
        </label>
      </p>
      <p>
        <button onClick={saveLlm}>Save LLM settings</button>
        {llmSaved && ' Saved.'}
      </p>
    </section>
  );
}
