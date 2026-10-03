import './app.css';
import { Settings } from './Settings';
import { ManifestStatus } from './ManifestStatus';
import { Characters } from './Characters';
import { Chat } from './Chat';

export function App() {
  return (
    <main class="app">
      <header class="app-header">
        <h1 class="wordmark">d2-loadoutGPT</h1>
        <p class="tagline">Sign in with Bungie to start building loadouts.</p>
      </header>
      <Characters />
      <Chat />
      <Settings />
      <footer class="app-footer">
        <ManifestStatus />
      </footer>
    </main>
  );
}
