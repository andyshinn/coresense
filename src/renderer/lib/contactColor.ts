// Deterministic identity→colour mapping. Pure function of the input string, so
// the same identity always lands on the same slot across renders and reloads.
//
// The returned strings are CSS variable *references*, never literal colours:
// the 12-slot ramp has different values in dark and light mode (see the
// --cs-id-* blocks in index.css), and resolving them in CSS keeps this function
// theme-agnostic — no mode argument to thread through callers, and no re-render
// when the theme flips.
//
// The hash INPUT is chosen by the caller, not here: under the 'byKey' identity
// colour mode it is a pubkey, under 'byName' a display name. See lib/identity.ts.

export interface NameColor {
  fg: string;
  bg: string;
  pillBg: string;
}

/** Ramp slot count. Hues are 30° apart: 25, 55, … 355. */
export const IDENTITY_SLOTS = 12;

export function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function identitySlotFor(id: string): number {
  return djb2(id) % IDENTITY_SLOTS;
}

export function getNameColor(id: string): NameColor {
  const slot = identitySlotFor(id);
  const fg = `rgb(var(--cs-id-fg-${slot}))`;
  return {
    fg,
    bg: `rgb(var(--cs-id-bg-${slot}))`,
    pillBg: `color-mix(in srgb, ${fg} 18%, transparent)`,
  };
}

/** The 7px identity dot's colour. A different, more saturated ramp than the
 *  text one — the dot is a graphical object at a 3:1 bar, text is at 4.5:1. */
export function identityDotVar(id: string): string {
  return `rgb(var(--cs-id-${identitySlotFor(id)}))`;
}

/** A keyless identity: a mark without a hue. */
export const IDENTITY_NEUTRAL_VAR = 'rgb(var(--cs-id-neutral))';

export function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??';
  const emoji = firstEmoji(trimmed);
  if (emoji) return emoji;
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return firstAlnum(parts[0]) + firstAlnum(parts[1]) || '??';
  }
  const word = parts[0];
  return firstAlnum(word) + firstAlnum(word.slice(1)) || '??';
}

function firstAlnum(s: string): string {
  for (const ch of s) {
    if (/[A-Za-z0-9]/.test(ch)) return ch;
  }
  return '';
}

// Returns the first emoji grapheme in the string, or '' if none. Uses the
// Unicode RGI_Emoji property + Intl.Segmenter so we capture multi-codepoint
// sequences (ZWJ, skin-tone modifiers, flags) as a single icon.
function firstEmoji(s: string): string {
  const emojiRe = /\p{Extended_Pictographic}/u;
  // Segmenter walks user-perceived characters, so a ZWJ sequence comes through
  // as one segment we can test against the emoji property.
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const { segment } of seg.segment(s)) {
    if (emojiRe.test(segment)) return segment;
  }
  return '';
}
