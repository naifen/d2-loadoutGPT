# d2-loadoutGPT

A Destiny 2 loadout assistant that lives in a Chrome side panel / Firefox sidebar.
It logs into Bungie with its own OAuth flow, keeps a local snapshot of your characters,
vault, and the Destiny manifest, and lets an LLM (any OpenAI-compatible endpoint) build
loadouts from your actual items. Finished builds are handed off to
[DIM](https://app.destinyitemmanager.com) as a loadout link plus an `id:` search query.

Built with [WXT](https://wxt.dev), Preact, and TypeScript. MIT licensed. Sideload only.

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest
pnpm build            # Chrome MV3  -> .output/chrome-mv3/
pnpm build:firefox    # Firefox MV2 -> .output/firefox-mv2/
pnpm dev              # Chrome dev build with HMR (pnpm dev:firefox for Firefox)
```

Load unpacked: Chrome `chrome://extensions` -> Developer mode -> Load unpacked -> `.output/chrome-mv3`.
Firefox `about:debugging#/runtime/this-firefox` -> Load Temporary Add-on -> `.output/firefox-mv2/manifest.json`.
Clicking the toolbar button opens the side panel / sidebar.

### Environment

Copy `.env.example` to `.env.chrome` and `.env.firefox` and fill in the Bungie app credentials.
WXT loads `.env.<browser>` for the matching build target (`pnpm build` / `pnpm build:chrome`
reads `.env.chrome`, `pnpm build:firefox` reads `.env.firefox`), so each browser gets its own
Bungie app. `.env.*` files are gitignored; only `.env.example` is committed. Variables:

| Variable                   | Purpose                           |
| -------------------------- | --------------------------------- |
| `WXT_BUNGIE_API_KEY`       | Bungie API key                    |
| `WXT_BUNGIE_CLIENT_ID`     | OAuth client id (Confidential)    |
| `WXT_BUNGIE_CLIENT_SECRET` | OAuth client secret               |

Access them in code via `import.meta.env.WXT_BUNGIE_API_KEY` etc.

## Register your Bungie app

The extension talks to Bungie with its own OAuth credentials. Register at
<https://www.bungie.net/en/Application> — **one app per browser**, because Bungie allows a
single redirect URL per app and Chrome/Firefox use different redirect hosts (see
"Extension IDs and OAuth redirect URLs" below).

For each app (Chrome and Firefox):

- **OAuth Client Type**: `Confidential` — required for refresh tokens (Public clients get none).
- **Redirect URL**: exactly that browser's redirect URL from the table below — the string
  `browser.identity.getRedirectURL()` returns, trailing `/` included. It must be `https`.
- **Scope**: tick `ReadBasicUserProfile` (account/membership lookup) and
  `ReadDestinyInventoryAndVault` (profile, vault, progression). Do not tick
  `MoveEquipDestinyItems`; this extension never writes to your account.
- **Origin Header**: `*` — the extension's `Origin:` is `chrome-extension://…` /
  `moz-extension://…`, and anything narrower fails Bungie's Origin check
  (`OriginHeaderDoesNotMatchKey`).

After saving, copy **API Key**, **OAuth client_id**, and **OAuth client_secret** into the
matching `.env.chrome` / `.env.firefox`. Keys can be regenerated on the same page if leaked.
There is no server-side revoke; users manage authorized apps at
<https://www.bungie.net/en/Profile/Settings> → "Authorized Applications".

## LLM settings

The assistant talks to any **OpenAI-compatible chat-completions endpoint** that supports
tool calling and SSE streaming. Configure it in the Settings panel (persisted in extension
local storage; the API key is sent only to the configured base URL — nowhere else):

| Provider   | Base URL                          | Notes                                          |
| ---------- | --------------------------------- | ---------------------------------------------- |
| OpenAI     | `https://api.openai.com/v1`       | Needs an API key and a tool-capable model.      |
| OpenRouter | `https://openrouter.ai/api/v1`    | Reach Claude, Gemini, etc. with one key.        |
| Ollama     | `http://localhost:11434/v1`       | No key. `ollama pull` a tool-capable model.     |
| LM Studio  | `http://localhost:1234/v1`        | No key. Load a tool-capable model first.        |

The model must support **function/tool calling** — the assistant drives vault search and
subclass/artifact lookups through tools, and the panel shows a distinct error when the
endpoint or model can't. Chat history lives in session storage and clears on browser
close; "New conversation" clears it on demand.

Because the base URL is user-configured (including `http://localhost:*`), the manifest
requests `<all_urls>` host permission — a fixed list can't cover arbitrary endpoints.
The extension still only ever contacts Bungie.net plus the endpoint you configure.

## Extension IDs and OAuth redirect URLs

Bungie allows one redirect URL per app, and Chrome and Firefox use different redirect hosts,
so there is one Bungie app per browser. The extension ID is pinned per browser so the redirect
URL does not change between rebuilds or reinstalls.

| Browser | Pinned by                                             | Extension ID                       | `identity.launchWebAuthFlow` redirect URL                               |
| ------- | ----------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Chrome  | `key` in `wxt.config.ts`                              | `godlpcbbbcibenblemaffmgpolkjobgp` | `https://godlpcbbbcibenblemaffmgpolkjobgp.chromiumapp.org/`             |
| Firefox | `browser_specific_settings.gecko.id` in `wxt.config.ts` | `d2-loadoutgpt@naifen.github.io`   | `https://ef06e5df905092e1d06c37ab01bb8c3390ca9099.extensions.allizom.org/` |

Register the matching redirect URL in each Bungie app (origin header `*`).

**Chrome.** The ID is derived from the RSA public key in the manifest `key` field. The private
half of the keypair is **not** in this repo; it lives at
`/Users/jg/Repos/.worktrees/d2-loadoutGPT-notes/chrome-extension-key.pem` on the maintainer's
machine. It is only needed to pack a `.crx`; unpacked loads use the manifest `key` alone.
To re-derive the ID from the private key:

```sh
openssl rsa -in chrome-extension-key.pem -pubout -outform DER | shasum -a 256 | head -c 32 | tr '0-9a-f' 'a-p'
```

**Firefox.** `browser.identity.getRedirectURL()` returns `https://<sha1(gecko.id)>.extensions.allizom.org/`.
Either read it at runtime (open the sidebar, run `browser.identity.getRedirectURL()` in the
extension's console from `about:debugging` -> Inspect) or compute it:

```sh
printf 'd2-loadoutgpt@naifen.github.io' | shasum -a 1
```

## Layout

```
entrypoints/   WXT entrypoints: background.ts, sidepanel/
src/ui/        Preact components for the side panel
src/bungie/    OAuth, API client, profile snapshot, manifest
src/agent/     agent turn runner and tools
src/llm/       OpenAI-compatible transport (SSE + tool calls)
src/storage/   thin wrappers for local/session storage keys
tests/         Vitest specs and fixtures
```
