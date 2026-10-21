// "Unknown command: stat — did you mean stats?"

/** Optimal string alignment distance (Damerau–Levenshtein with adjacent
 *  transpositions): the edits a typo most often needs. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // d[i][j]: distance between a[0..i) and b[0..j).
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** Beyond this many edits a suggestion is more confusing than helpful. */
export const MAX_SUGGESTION_DISTANCE = 2;

/** The candidate `input` most plausibly meant, or null. A candidate the input
 *  is a unique prefix of wins outright ("adv" → "advert"); otherwise the
 *  closest within MAX_SUGGESTION_DISTANCE, ties going to the earlier
 *  candidate. Case-insensitive. */
export function didYouMean(input: string, candidates: readonly string[]): string | null {
  const needle = input.toLowerCase();
  if (needle.length === 0) return null;
  const unique = [...new Set(candidates)];
  const prefixed = unique.filter((c) => c.toLowerCase().startsWith(needle));
  if (prefixed.length === 1) return prefixed[0];
  let best: string | null = null;
  let bestDistance = MAX_SUGGESTION_DISTANCE + 1;
  for (const c of unique) {
    const distance = editDistance(needle, c.toLowerCase());
    if (distance < bestDistance) {
      best = c;
      bestDistance = distance;
    }
  }
  return best;
}
