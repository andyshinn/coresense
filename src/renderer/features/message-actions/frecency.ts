import type { UsageEntry, UsageMap } from '../../../shared/types';

/** Curated, airtime-aware seed shown before the user has any history. */
export const EMOJI_SEED: readonly string[] = ['👍', '✅', '📡', '🔋', '😂', '❤️'];

const HALF_LIFE_MS = 14 * 86_400_000; // recency weight halves every ~2 weeks

/** Frecency: usage count decayed by how long ago it was last used. An absent
 *  entry scores 0, so never-used ids rank below every used one. */
export function score(entry: UsageEntry | undefined, nowMs: number): number {
  if (!entry) return 0;
  const ageMs = Math.max(0, nowMs - entry.lastUsedMs);
  const recency = 2 ** (-ageMs / HALF_LIFE_MS); // 1 now → 0.5 at one half-life
  return entry.count * recency;
}

/** Top-N ids by frecency, backfilled from `seed` (deduped) to always yield N. */
export function topIds(usage: UsageMap, nowMs: number, n: number, seed: readonly string[]): string[] {
  const ranked = Object.keys(usage).sort((a, b) => score(usage[b], nowMs) - score(usage[a], nowMs));
  const out: string[] = [];
  for (const e of ranked) {
    if (out.length >= n) break;
    if (!out.includes(e)) out.push(e);
  }
  for (const e of seed) {
    if (out.length >= n) break;
    if (!out.includes(e)) out.push(e);
  }
  return out.slice(0, n);
}

/** Immutably bump an id's count and last-used timestamp. */
export function recordUsage(usage: UsageMap, id: string, nowMs: number): UsageMap {
  const prev = usage[id];
  return { ...usage, [id]: { count: (prev?.count ?? 0) + 1, lastUsedMs: nowMs } };
}
