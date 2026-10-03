import { render } from 'preact';
import { App } from '../src/ui/App';

// Design-candidate loader: ?variant=<name> layers that stylesheet over the
// real app.css so candidates can be screenshotted side by side.
const variants: Record<string, () => Promise<unknown>> = {
  nightops: () => import('./variants/nightops.css'),
  menuplus: () => import('./variants/menuplus.css'),
};

const name = new URLSearchParams(location.search).get('variant') ?? '';
const start = () => render(<App />, document.getElementById('app')!);
// hasOwn: a bare variants[name] lookup would also match Object.prototype
// members (?variant=constructor…) — truthy, non-Promise, crash on .then.
const load = Object.hasOwn(variants, name) ? variants[name] : undefined;
// Render even if the variant stylesheet fails — the shipped design is the
// fallback for an unknown name and for a broken import alike.
if (load) void load().then(start, start);
else start();
