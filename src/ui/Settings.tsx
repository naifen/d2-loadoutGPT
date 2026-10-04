import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { getTokens, login, logout } from '../bungie/auth';
import type { BungieTokens } from '../bungie/auth';
import { bungieFetch } from '../bungie/http';
import type { LlmEndpointSettings } from '../llm/openai';
import { completionUrl } from '../llm/openai';
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

  // Also exercises bungieFetch (API key, Origin, token expiry) on every panel open.
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
      if (area === 'session' && 'bungieTokens' in changes) void sync();
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
      const endpoint = new URL(completionUrl(llm.baseUrl));
      // Match patterns omit ports for Firefox compatibility; the transport
      // still sends only to the exact configured URL and refuses redirects.
      const granted = await browser.permissions.request({ origins: [`${endpoint.protocol}//${endpoint.hostname}/*`] });
      if (!granted) throw new Error('Access to the LLM endpoint was denied. Your saved settings were not changed.');
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
    <section class="settings">
      <h2>Settings</h2>
      <div class="account">
        {tokens ? (
          <p class="account-line">
            Signed in as <strong>{name ?? `membership ${tokens.membershipId}`}</strong>{' '}
            <button class="btn btn-danger" disabled={busy} onClick={() => run(logout)}>
              Log out
            </button>
          </p>
        ) : (
          <button class="btn" disabled={busy} onClick={() => run(login)}>
            Log in with Bungie
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </div>

      <details class="disclosure">
        <summary>LLM endpoint</summary>
        <div class="disclosure-body">
          <p class="hint">
            Any OpenAI-compatible chat endpoint with tool calling. By default, the key stays
            in memory until the browser restarts or the extension reloads, and is sent only to the
            configured endpoint. Saving asks for access to that host. Changing the endpoint origin clears the key.
            Your messages and inventory details are sent to that provider; its retention policy
            applies. Bungie access tokens are never sent to the model.
          </p>
          <label class="field">
            <span>Base URL</span>
            <input
              value={llm.baseUrl}
              onInput={setLlmField('baseUrl')}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label class="field">
            <span>API key</span>
            <input
              type="password"
              value={llm.apiKey}
              onInput={setLlmField('apiKey')}
              placeholder="empty for local servers"
            />
          </label>
          <label class="field field-check">
            <input
              type="checkbox"
              checked={llm.rememberKey}
              onChange={(e) => {
                setLlm({ ...llm, rememberKey: e.currentTarget.checked });
                setLlmSaved(false);
              }}
              aria-describedby="remember-key-warning"
            />
            Remember key on this device
          </label>
          <p class="field-note" id="remember-key-warning">
            Optional: saves the key unencrypted in your browser profile. Use only on a trusted
            device.
          </p>
          <label class="field">
            <span>Model</span>
            <input
              value={llm.model}
              onInput={setLlmField('model')}
              placeholder="e.g. gpt-4o-mini, qwen3:8b"
            />
          </label>
          <p>
            <button class="btn btn-confirm" onClick={saveLlm}>
              Save LLM settings
            </button>
            {llmSaved && <span class="save-note">Saved.</span>}
          </p>
        </div>
      </details>
    </section>
  );
}
