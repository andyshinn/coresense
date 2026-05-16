// Deterministic name→color mapping. Pure function of the input string so the
// same contact always lands on the same color across renders and reloads.

export interface NameColor {
  fg: string;
  bg: string;
  pillBg: string;
}

const PALETTE: ReadonlyArray<{ h: number; s: number; lFg: number; lBg: number }> = [
  { h: 15, s: 70, lFg: 60, lBg: 28 },
  { h: 35, s: 75, lFg: 60, lBg: 28 },
  { h: 55, s: 65, lFg: 55, lBg: 25 },
  { h: 95, s: 50, lFg: 55, lBg: 24 },
  { h: 160, s: 50, lFg: 50, lBg: 22 },
  { h: 195, s: 60, lFg: 60, lBg: 26 },
  { h: 220, s: 60, lFg: 65, lBg: 28 },
  { h: 265, s: 55, lFg: 68, lBg: 30 },
  { h: 310, s: 55, lFg: 65, lBg: 28 },
  { h: 345, s: 65, lFg: 62, lBg: 28 },
];

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function getNameColor(name: string): NameColor {
  const idx = djb2(name) % PALETTE.length;
  const p = PALETTE[idx];
  const fg = `hsl(${p.h} ${p.s}% ${p.lFg}%)`;
  const bg = `hsl(${p.h} ${p.s}% ${p.lBg}%)`;
  const pillBg = `color-mix(in srgb, ${fg} 18%, transparent)`;
  return { fg, bg, pillBg };
}

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
