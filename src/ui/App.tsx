import { Settings } from './Settings';
import { ManifestStatus } from './ManifestStatus';
import { Characters } from './Characters';

export function App() {
  return (
    <main>
      <h1>d2-loadoutGPT</h1>
      <p>Sign in with Bungie to start building loadouts.</p>
      <Settings />
      <Characters />
      <ManifestStatus />
    </main>
  );
}
