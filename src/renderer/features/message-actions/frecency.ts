import type { EmojiUse, EmojiUsage } from '../../../shared/types';

/** Curated, airtime-aware seed shown before the user has any history. */
export const EMOJI_SEED: readonly string[] = ['👍', '✅', '📡', '🔋', '😂', '❤️'];

const HALF_LIFE_MS = 14 * 86_400_000; // recency weight halves every ~2 weeks

/** Frecency: usage count decayed by how long ago it was last used. */
export function scoreEmoji(entry: EmojiUse, nowMs: number): number {
  const ageMs = Math.max(0, nowMs - entry.lastUsedMs);
  const recency = 2 ** (-ageMs / HALF_LIFE_MS); // 1 now → 0.5 at one half-life
  return entry.count * recency;
}

/** Top-N emoji by frecency, backfilled from `seed` (deduped) to always yield N. */
export function topEmojis(usage: EmojiUsage, nowMs: number, n: number, seed: readonly string[]): string[] {
  const ranked = Object.keys(usage).sort((a, b) => scoreEmoji(usage[b], nowMs) - scoreEmoji(usage[a], nowMs));
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

/** Immutably bump an emoji's count and last-used timestamp. */
export function recordUsage(usage: EmojiUsage, emoji: string, nowMs: number): EmojiUsage {
  const prev = usage[emoji];
  return { ...usage, [emoji]: { count: (prev?.count ?? 0) + 1, lastUsedMs: nowMs } };
}
