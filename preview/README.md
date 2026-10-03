# Design preview harness

Renders the **real** `src/ui` components in a plain page — no extension
runtime needed — by aliasing the extension-bound modules (`wxt/browser`,
`src/bungie/*`, `src/storage/*`, `src/agent/*`, `src/llm/openai`) to the canned
mocks in `preview/mocks/`. Signed-in state, three characters, ready manifest,
a populated chat history with one build card, and a scripted agent turn on
send.

```sh
pnpm install
pnpm exec vite dev --config preview/vite.config.ts            # live dev server
pnpm exec vite build --config preview/vite.config.ts          # static build to preview/dist/
pnpm exec vite preview --config preview/vite.config.ts --port 4319
```

`?variant=<name>` layers a candidate stylesheet from `preview/variants/`
over the shipped design (`nightops`, `menuplus`) so losing candidates stay
comparable — see DESIGN.md → "Design candidates explored".

Nothing under `preview/` is referenced by `wxt.config.ts` or `entrypoints/` —
it is never shipped in the extension bundle.
