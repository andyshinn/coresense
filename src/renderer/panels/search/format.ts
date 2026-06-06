/** Abbreviate a hex public key for compact display: first 6 chars + an
 *  ellipsis + last 4 chars. Keys of 12 chars or fewer are returned unchanged. */
export function shortPk(pk: string): string {
  if (pk.length <= 12) return pk;
  return `${pk.slice(0, 6)}…${pk.slice(-4)}`;
}
