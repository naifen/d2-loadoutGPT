import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { getTokens } from '../bungie/auth';
import {
  charactersFromSnapshot,
  getCachedSnapshot,
  getSnapshot,
  type CharacterRow,
  type ProfileSnapshot,
} from '../bungie/profile';

// Set once the snapshot has been fetched this browser session, so the panel
// refreshes on first open only (storage.session is cleared on browser exit).
const SESSION_KEY = 'profileFetchedThisSession';

export function Characters() {
  const [signedIn, setSignedIn] = useState(false);
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [fetchedAt, setFetchedAt] = useState<number>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  function apply(snapshot: ProfileSnapshot) {
    setCharacters(charactersFromSnapshot(snapshot));
    setFetchedAt(snapshot.fetchedAt);
  }

  async function refresh() {
    setBusy(true);
    setError(undefined);
    try {
      apply(await getSnapshot(true));
      // Flag the session only on success — a failed fetch must not suppress
      // the first-open auto-refresh for the rest of the session.
      await browser.storage.session?.set({ [SESSION_KEY]: true }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function init() {
    if (!(await getTokens())) {
      setSignedIn(false);
      setCharacters([]);
      setFetchedAt(undefined);
      return;
    }
    setSignedIn(true);
    const cached = await getCachedSnapshot();
    if (cached) apply(cached.snapshot);
    const flagged = (await browser.storage.session?.get(SESSION_KEY).catch(() => undefined))?.[
      SESSION_KEY
    ];
    if (!flagged) await refresh();
  }

  useEffect(() => {
    init();
    // Reflect login/logout from the Settings panel without coupling state.
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && 'bungieTokens' in changes) init();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);

  if (!signedIn) return null;

  return (
    <section>
      <h2>Characters</h2>
      {characters.length > 0 && (
        <ul>
          {characters.map((c) => (
            <li key={c.id}>
              {c.className} — {c.light}
            </li>
          ))}
        </ul>
      )}
      <p>
        {fetchedAt ? `Last refreshed ${formatAge(fetchedAt)}` : 'No snapshot yet.'}{' '}
        <button disabled={busy} onClick={refresh}>
          Refresh
        </button>
      </p>
      {busy && <p>Refreshing…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function formatAge(fetchedAt: number): string {
  const mins = Math.round((Date.now() - fetchedAt) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return new Date(fetchedAt).toLocaleString();
}
