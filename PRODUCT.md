# Product

<!-- impeccable:product-schema 1 -->

## Platform

web — browser extension side panel (Chrome side panel / Firefox sidebar). The
usable surface is a narrow, full-height panel: roughly 320–480 px wide.

## Stack

WXT + Preact + TypeScript, plain DOM (no UI framework/components library).
Styles land in `src/ui/`; the panel entry is `entrypoints/sidepanel/`.
(Existing codebase — no stack decision to record.)

## Users

Destiny 2 players (PC) who already use or know DIM. Context: mid-session or
loadout planning — they want a build assembled from *their own* vault and
characters without hand-picking items themselves. They judge the tool by
whether it feels like it belongs in the Destiny universe and whether the
handoff to DIM is trustworthy.

## Product Purpose

An LLM-driven loadout assistant: sign in with Bungie, point it at any
OpenAI-compatible endpoint, ask for a build in plain language. The agent reads
your real characters, inventory, subclass options, and the seasonal artifact
through read-only tools, then proposes a build card — item list, subclass
config, mods, rationale — exported to DIM as a loadout link plus an `id:`
search query. Success = a player goes from "build me a Solar Titan for GMs"
to applying the loadout in DIM in under a minute.

## Positioning

DIM requires you to know what you want; this tool lets an LLM *reason* over
your actual inventory and manifest data and hand off to DIM for the apply
step — read-only, never writes to your account. (Inferred from README/code —
user-confirmed only as product direction.)

## Operating Context

Runs as a sideloaded extension panel alongside the browser. First-run
downloads Destiny manifest tables into IndexedDB (progress is visible).
Chat history persists per panel session; Bungie OAuth, LLM endpoint settings
(base URL + model + optional remembered key) live in extension storage.
All LLM traffic goes only to the user-configured endpoint.

## Capabilities and Constraints

- Narrow vertical panel; content scrolls; chat is the primary surface.
- Components: Settings (Bungie login + LLM endpoint form), Characters list,
  ManifestStatus, Chat (streamed text, tool-activity rows, notices, errors),
  BuildCard (markdown body + DIM/copy actions).
- Chat rows: user, assistant, activity (running/done), proposal, notice, error.
- Build-card markdown is sanitized (DOMPurify) — no scripts/images; links open
  externally.
- No remote assets guaranteed: extension should render with local/system
  resources; avoid hard dependencies on CDN fonts or imagery.

## Brand Commitments

- Name: `d2-loadoutGPT`.
- **Pinned by user brief:** the visual identity must carry the look and feel
  of the Destiny 2 game UI (palette, type treatment, iconography register,
  signature interactions).

## Evidence on Hand

Real copy and structure in `src/ui/*.tsx` and `README.md`. No imagery, logos,
or licensed Bungie art assets in the repo — iconography must be drawn (SVG)
or typographic, and no Bungie-copyrighted assets may be vendored.

## Product Principles

- Destiny-native: the panel should feel like a surface that shipped with the
  game — type, palette, and one signature interaction, not a costume.
- Tool first: this is a working utility (Operate mode) — density, clear
  states, and familiar controls outrank atmosphere.
- Trustworthy handoff: builds always end at DIM for review before apply.
- Read-only honesty: surface errors and degraded states clearly; never fake
  success.
