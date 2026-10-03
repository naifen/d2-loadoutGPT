import { defineConfig } from 'vite';

// Design-preview dev server: renders the REAL sidepanel App outside the
// extension runtime by aliasing the extension-bound modules (wxt/browser,
// Bungie API, storage, agent runner) to the canned mocks in ./mocks/.
//
//   pnpm exec vite dev --config preview/vite.config.ts       # live dev
//   pnpm exec vite build --config preview/vite.config.ts     # static dist/
//   pnpm exec vite preview --config preview/vite.config.ts --port 4319
//
// Never shipped: nothing here is referenced by wxt.config.ts or entrypoints/.
// Each alias regex must consume the entire import specifier — rolldown rewrites
// only the matched span, so a partial match would corrupt the path.

const mock = (name: string) => new URL(`./mocks/${name}`, import.meta.url).pathname;

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  base: './',
  resolve: {
    alias: [
      { find: /^wxt\/browser$/, replacement: mock('wxt-browser.ts') },
      { find: /^.*\/bungie\/auth$/, replacement: mock('bungie-auth.ts') },
      { find: /^.*\/bungie\/http$/, replacement: mock('bungie-http.ts') },
      { find: /^.*\/bungie\/profile$/, replacement: mock('bungie-profile.ts') },
      { find: /^.*\/bungie\/manifest$/, replacement: mock('bungie-manifest.ts') },
      { find: /^.*\/storage\/llmSettings$/, replacement: mock('storage-llmSettings.ts') },
      { find: /^.*\/storage\/chatHistory$/, replacement: mock('storage-chatHistory.ts') },
      { find: /^.*\/llm\/openai$/, replacement: mock('llm-openai.ts') },
      { find: /^.*\/agent\/runner$/, replacement: mock('agent-runner.ts') },
      { find: /^.*\/agent\/system-prompt$/, replacement: mock('agent-system-prompt.ts') },
    ],
  },
  build: { outDir: new URL('./dist', import.meta.url).pathname, emptyOutDir: true },
});
