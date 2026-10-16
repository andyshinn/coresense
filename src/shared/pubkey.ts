/** Abbreviate a hex public key for display as `<head>…<tail>` (default 6…4).
 *  Keys at most two characters longer than the abbreviation are returned whole,
 *  since eliding them would hide information without saving space. */
export function abbreviatePubkey(pk: string, opts: { head?: number; tail?: number } = {}): string {
  const { head = 6, tail = 4 } = opts;
  if (pk.length <= head + tail + 2) return pk;
  return `${pk.slice(0, head)}…${tail > 0 ? pk.slice(-tail) : ''}`;
}
