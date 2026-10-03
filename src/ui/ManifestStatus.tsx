import { useEffect, useState } from 'preact/hooks';
import { ensureManifest } from '../bungie/manifest';

type State =
  | { phase: 'downloading'; table: string; done: number; total: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };

export function ManifestStatus() {
  const [state, setState] = useState<State>();

  useEffect(() => {
    ensureManifest(({ table, done, total }) =>
      setState({ phase: 'downloading', table, done, total }),
    )
      .then((version) => setState({ phase: 'ready', version }))
      .catch((e) => setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) }));
  }, []);

  if (!state) return null;
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
