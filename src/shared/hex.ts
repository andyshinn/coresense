/** Decode a hex string to bytes. Non-hex characters (spaces, colons, dashes) are
 *  stripped first, and a trailing odd nibble is dropped. */
export function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

/** Lowercase hex for `bytes[start, end)` (slice semantics; `end` is EXCLUSIVE and
 *  clamped to the length). An inclusive `[a, z]` range is `bytesToHex(b, a, z + 1)`;
 *  add `.toUpperCase()` for the inspector-style uppercase dumps. */
export function bytesToHex(bytes: ArrayLike<number>, start = 0, end = bytes.length): string {
  let s = '';
  for (let i = start; i < end && i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}
