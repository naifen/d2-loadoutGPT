# Design — "Director's Cut"

The visual identity is the Destiny 2 in-game menu system: the pause menu,
character screen, and item tooltips a player already knows. Quiet dark ground,
translucent surfaces, spaced-caps type, and one signature interaction. A player
should feel they opened a surface that shipped with the game.

Everything lives in `src/ui/app.css` as custom properties; components in
`src/ui/` consume classes only — no other stylesheets. The one exception is
dynamic values that can't be a static class (the manifest progress width),
which may be set inline.

## The world (tokens)

Palette, sampled from the game UI:

| token | value | job |
|---|---|---|
| `--d2-ground` | `#12171d` | page ground |
| `--d2-surface` | `rgba(255,255,255,.05)` | buttons, inputs |
| `--d2-tooltip` | `rgba(15,18,23,.92)` | build card body |
| `--d2-border` / `--d2-border-faint` | `.25` / `.12` white | control borders / separators |
| `--d2-separator` | `.07` white | hairline row rules |
| `--d2-text` | `#b6bbb7` | body copy |
| `--d2-heading` | `#fff` | headings, strong text |
| `--d2-cream` | `#fcedd3` | alt-header cream, "You:" label, card subtitle |
| `--d2-dim` | `.55` white | secondary text, placeholders (≥4.5:1 on ground) |
| `--d2-green` / `--d2-danger` | `#5aa56a` / `#c73632` | confirm / danger borders + fills |
| `--d2-danger-text` | `#e07a72` | error text (the raw `#c73632` fails contrast on ground) |
| `--d2-warning` | `#eade8b` | power level (light) color |
| `--d2-xp` | `#c0e8b4` | completed-objective check, "Saved." note |
| `--d2-gold` / `--d2-gold-band` | `#ceae33` / `color-mix(60% + black)` | exotic accent / tooltip header band |

Type: `'Neue Haas Grotesk Display Pro', 'Helvetica Neue', Helvetica, Arial,
sans-serif` — the authentic D2 face, system-resolved so the extension works
offline. Wordmark: 14px / 700 / 0.45em uppercase. Section headers: 11.5px /
600 / 0.18em uppercase with the small white marker bar under the leading edge —
the nav-tab treatment. Buttons: 11px / 600 / 0.12em uppercase. Body: 13px
regular case. `ui-monospace` + tabular numerals only for character IDs and
inline code.

## The signature move

**White-fill hover inversion.** Every interactive control — `.btn`, the
`summary` disclosure row, links — fills solid `#fff` with `#000` text and a
white border on hover/focus, on a single `--d2-invert` token (120ms ease on
background/color/border). This is the most recognizable interaction in the
game and the only motion the design allows itself. Do not add other hover
effects; extend this one.

Variant fills keep the same move: `.btn-confirm` green (`#5aa56a`, black text),
`.btn-danger` red (`#c73632`, white text), `.btn-gold` exotic (`#ceae33`, cream
text → gold fill, black text).

## Component vocabulary

- **Shell** — `.app` is a 100dvh flex column: wordmark header bar →
  `.characters` strip → `.chat` (flexes to own remaining height) →
  `.settings` → `.app-footer` status line. `.app` scrolls only when the open
  disclosure needs room; `.chat` has `min-height: 170px` so the composer is
  never squeezed out.
- **Chat log** — `.chat-log` owns the scroll (`overflow-y`), hairline
  separators between `.chat-log > li` rows. Composer is `flex:none`, pinned at
  the bottom of the section. Empty log renders an explicit `.chat-empty` hint
  row — a `:empty` selector would be unreliable because `{live && …}` leaves an
  empty text node when `live` is `''`, and engines disagree on whether that
  defeats `:empty`.
- **Objective rows** — activity entries are quiet italic lines; a drawn 1.5px
  SVG check in `--d2-xp` appears when done. "Thinking…" pulses opacity.
- **BuildCard = the item tooltip** — `rgba(15,18,23,.92)` body, 1px
  `rgba(255,255,255,.15)` border, `0 12px 30px rgba(0,0,0,.6)` shadow, and a
  deep exotic-gold header band (`#ceae33` darkened ~40% via `color-mix` — the
  brief's ~12% fails text contrast) carrying the uppercase bold white loadout
  name + "LOADOUT PROPOSAL" subtitle in cream.
- **Characters** — menu-list rows: uppercase class name, drawn power diamond
  (1.5px stroke) + light level in `--d2-warning`, membership ID right-aligned
  in small muted tabular mono.
- **Disclosure** — the LLM form collapses behind a real `<details>/<summary>`
  menu row that also plays the white-fill move; drawn chevron, scrollable
  `.disclosure-body` capped at 46dvh.
- **ManifestStatus** — quiet 11px dim footer line; downloading state adds a
  2px progress bar (`--d2-track` rail, `#fcfcfc` fill).

## State model

Every control ships: default, hover (white inversion), `:focus-visible`
(1px white ring at 2px offset, visible on every fill), `:active`, `:disabled`
(`opacity:.35`, no pointer), loading ("Thinking…" pulse, manifest progress
bar), error (`--d2-danger-text`, always via `role="alert"`), empty (chat-log
hint). `prefers-reduced-motion` zeroes transitions and the pulse.

Browser surfaces are themed from the palette: `::selection` inverts to
white-on-black, `caret-color` is white, `.chat-log` scrollbars are thin
white-on-transparent, `color-scheme: dark` keeps native controls honest.

## What future work must preserve

- **Operate-mode discipline.** The world lends type, palette, density, and the
  ONE move — never layout, navigation, or controls. Real buttons, inputs,
  lists, scroll areas. No HUD costume (no fake crosshairs, hex grids, radial
  menus, Bungie art).
- All icons are hand-drawn inline SVG at one 1.5px stroke weight. No emoji or
  unicode glyphs as icons.
- Contrast: body/placeholder ≥4.5:1, large text ≥3:1. Tint secondary text from
  white at ≥.55 alpha on dark surfaces; on the gold band use cream/white.
- New interactive elements play the inversion through `--d2-invert`; don't
  invent new hover effects or transition speeds.
- Keep ARIA roles, `role="alert"` errors, and disabled logic exactly as the
  components define them — the CSS is built around them.
- The panel is designed for 320–480px; check both ends before shipping any
  change.
