import { useEffect, useState } from 'preact/hooks';
import { ensureManifest } from '../bungie/manifest';

type State =
  | { phase: 'checking' }
  | { phase: 'downloading'; table: string; done: number; total: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };

export function ManifestStatus() {
  const [state, setState] = useState<State>({ phase: 'checking' });

  useEffect(() => {
    let active = true;
    ensureManifest(({ table, done, total }) => {
      if (active) setState({ phase: 'downloading', table, done, total });
    })
      .then((version) => { if (active) setState({ phase: 'ready', version }); })
      .catch((e) => { if (active) setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) }); });
    return () => { active = false; };
  }, []);

  if (state.phase === 'checking') return <p class="manifest-status">Checking game definitions…</p>;
  if (state.phase === 'downloading') {
    const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
    return (
      <p class="manifest-status">
        Downloading definitions: {state.table} ({state.done}/{state.total})…
        <span
          class="manifest-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Manifest download progress"
        >
          <span style={{ width: `${pct}%` }} />
        </span>
      </p>
    );
  }
  if (state.phase === 'error')
    return (
      <p class="manifest-status is-error" role="alert">
        Manifest download failed: {state.message}
      </p>
    );
  return <p class="manifest-status">Manifest: {state.version}</p>;
}
