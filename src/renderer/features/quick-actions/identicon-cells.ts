// Deterministic 5x5 horizontally-mirrored identicon derived from a public-key
// hex string. Ported from the design prototype (owc-card.jsx). Returns 25
// booleans in column-major order: index = col*5 + row, col 0..4, row 0..4.
export function identiconCells(hex: string): boolean[] {
  // Generate the left 3 columns from the key, then mirror to 5.
  const base: boolean[] = [];
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 5; row++) {
      const i = col * 5 + row;
      const start = (i * 2) % hex.length;
      const b = parseInt(hex.slice(start, start + 2), 16) || hex.charCodeAt(i % hex.length);
      base.push(b % 7 < 3);
    }
  }
  const out: boolean[] = [];
  for (let col = 0; col < 5; col++) {
    const srcCol = col < 3 ? col : 4 - col;
    for (let row = 0; row < 5; row++) {
      out.push(base[srcCol * 5 + row]);
    }
  }
  return out;
}
