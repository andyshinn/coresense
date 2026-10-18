/** First `cap` rows plus how many were withheld. A `null` cap withholds
 *  nothing. Returns the input array itself when nothing is withheld, so callers
 *  can memoise on identity. */
export function capList<T>(rows: T[], cap: number | null): { rows: T[]; hidden: number } {
  if (cap === null || rows.length <= cap) return { rows, hidden: 0 };
  const shown = rows.slice(0, cap);
  return { rows: shown, hidden: rows.length - shown.length };
}
