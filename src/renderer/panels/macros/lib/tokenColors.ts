import type { TokenType } from './tokenize';

/** Syntax-highlight colours for the editor overlay and inline snippets, lifted
 *  from the Macros design's "Field Console" palette. Applied as inline `color`
 *  since these are token-specific and outside the Tailwind `--cs-*` theme. */
export const TOKEN_COLORS: Record<TokenType, string> = {
  text: '#e7e0cf',
  delim: '#7c7560',
  variable: '#f5c451',
  unavail: '#d99a3c',
  filter: '#9ed36a',
  custom: '#7fd1c4',
  string: '#c0a578',
  number: '#d8a657',
  // Control flow reads as a distinct category from data (amber) and transforms
  // (green/teal), so it gets the palette's only violet.
  tag: '#b8a1d9',
  error: '#f87171',
};
