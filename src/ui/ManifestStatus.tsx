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

  if (state.phase === 'checking') return <p>Checking game definitions…</p>;
  if (state.phase === 'downloading') {
    return (
      <p>
        Downloading definitions: {state.table} ({state.done}/{state.total})…
      </p>
    );
  }
  if (state.phase === 'error') return <p role="alert">Manifest download failed: {state.message}</p>;
  return <p>Manifest: {state.version}</p>;
}
