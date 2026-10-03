// Hand-drawn icon set: every SVG icon in the UI lives here — one 1.5px
// stroke, no fill, currentColor, aria-hidden. The class, engram, ghost,
// sigil, objective, and power marks are original geometric approximations
// in the Destiny icon idiom, not copies of Bungie art.

interface IconProps {
  class?: string;
}

const S = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.5,
} as const;

/** Character class mark by Bungie classType (0 Titan, 1 Hunter, 2 Warlock). */
export function ClassIcon({ classType, ...rest }: IconProps & { classType: number }) {
  switch (classType) {
    case 0: // Titan — bulwark: slab over a two-posted gate
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" {...rest}>
          <path d="M1.8 3.4h12.4M4.6 6.2v7M11.4 6.2v7" {...S} />
        </svg>
      );
    case 1: // Hunter — swept double chevron, the winged arrowhead
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" {...rest}>
          <path d="M2.2 4.2L8 11.6 13.8 4.2M5.6 4.2L8 7.6l2.4-3.4" {...S} />
        </svg>
      );
    case 2: // Warlock — arcane circle with an inner focus
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" {...rest}>
          <circle cx="8" cy="8" r="5" {...S} />
          <path d="M8 5.3l1.9 2.7L8 10.7 6.1 8Z" {...S} />
        </svg>
      );
    default:
      // Unknown class (Bungie's enum has 3=Unknown) — keep the icon slot so
      // the row still aligns with siblings that carry a mark.
      return <svg viewBox="0 0 16 16" aria-hidden="true" {...rest} />;
  }
}

/** Tracker objective — the check when done. */
export function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" {...props}>
      <path d="M2 6.5l2.5 2.5L10 3.5" {...S} />
    </svg>
  );
}

/** Tracker objective — the hollow diamond while pending. */
export function ObjectiveIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" {...props}>
      <path d="M6 1.6L10.4 6 6 10.4 1.6 6Z" {...S} />
    </svg>
  );
}

/** Power level — the small light diamond. */
export function PowerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" {...props}>
      <path d="M5 0.8L9.2 5L5 9.2L0.8 5Z" {...S} />
    </svg>
  );
}

/** Engram — faceted diamond, the loot-item glyph. */
export function EngramIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path d="M8 1.6 14.4 8 8 14.4 1.6 8Z" {...S} />
      <path d="M8 5.4 10.6 8 8 10.6 5.4 8Z" {...S} />
    </svg>
  );
}

/** Ghost shell — core sphere with four diagonal fins. */
export function GhostMark(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <circle cx="8" cy="8" r="2.7" {...S} />
      <path d="M3.4 3.4l1.8 1.8M10.8 10.8l1.8 1.8M12.6 3.4l-1.8 1.8M5.2 10.8l-1.8 1.8" {...S} />
    </svg>
  );
}

/** Sigil — triskelion in a ring; faint watermark scale, not UI size. */
export function SigilMark(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <circle cx="8" cy="8" r="6.6" {...S} />
      <path d="M8 8V1.6M8 8l5.55 3.2M8 8l-5.55 3.2" {...S} />
    </svg>
  );
}
