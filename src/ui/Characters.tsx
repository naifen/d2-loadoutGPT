import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';
import { getTokens } from '../bungie/auth';
import { charactersFromSnapshot, getSnapshot } from '../bungie/profile';
import type { CharacterRow } from '../bungie/profile';
import { isRecord } from '../type-guards';
import { ClassIcon, PowerIcon } from './icons';

export function Characters() {
  const [signedIn, setSignedIn] = useState(false);
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [fetchedAt, setFetchedAt] = useState<number>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  async function refresh(force = true) {
    const current = ++generation.current;
    setBusy(true);
    setError(undefined);
    try {
      const tokens = await getTokens();
      if (current !== generation.current) return;
      setSignedIn(!!tokens);
      if (!tokens) return;
      const snapshot = await getSnapshot(force);
      if (current !== generation.current) return;
      setCharacters(charactersFromSnapshot(snapshot));
      setFetchedAt(snapshot.fetchedAt);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  useEffect(() => {
    void refresh(false);
    const onChanged = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      const change = changes.bungieTokens;
      if (area !== 'local' || !change) return;
      const previous = isRecord(change.oldValue) ? change.oldValue.sessionId : undefined;
      const next = isRecord(change.newValue) ? change.newValue.sessionId : undefined;
      if (previous === next) return;
      generation.current++;
      setCharacters([]);
      setFetchedAt(undefined);
      setError(undefined);
      setSignedIn(false);
      void refresh(false);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      generation.current++;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  if (!signedIn) return null;
  return (
    <section class="characters">
      <h2>Characters</h2>
      {characters.length > 0 && (
        <ul class="char-list">
          {characters.map((c) => (
            <li key={c.id}>
              <ClassIcon classType={c.classType} class="icon-class" />
              <span class="char-name">{c.className}</span>
              <span class="char-power">
                <PowerIcon />
                {c.light}
              </span>
              <span class="char-id">{c.id}</span>
            </li>
          ))}
        </ul>
      )}
      <p class="char-meta">
        {fetchedAt ? `Last refreshed ${formatAge(fetchedAt)}` : 'No snapshot yet.'}{' '}
        <button class="btn" disabled={busy} onClick={() => refresh()}>Refresh</button>
      </p>
      {busy && <p class="busy-note">Refreshing…</p>}
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
