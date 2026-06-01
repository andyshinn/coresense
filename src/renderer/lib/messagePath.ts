// Hop-count + path-hash-mode derivation for a message, sourced from the FIRST
// observed path (messages can arrive via several flood routes). Pure so the
// meta row in MessageItem just interpolates a string and the logic stays
// unit-testable.

import type { Message } from '../../shared/types';

export interface PathStats {
  /** Relay hop count, or null when unknown. 0 is a valid value (direct). */
  hops: number | null;
  /** Bytes per hop used in the path encoding (1/2/3), or null when unknown. */
  hashMode: number | null;
}

/**
 * Stats from the first path seen (`meta.paths[0]`). Hop count is the number of
 * intermediate relay hops — the canonical count used elsewhere is the number
 * of `kind === 'hop'` entries (origin/sink are excluded), see
 * `components/path/PathItem.tsx`. Falls back to the bare `meta.hops` count
 * (with an unknown hash mode) for messages that arrived without a correlated
 * mesh observation.
 */
export function firstPathStats(message: Message): PathStats {
  const path = message.meta?.paths?.[0];
  if (path) {
    return {
      hops: path.hops.filter((h) => h.kind === 'hop').length,
      hashMode: path.hashMode,
    };
  }
  return { hops: message.meta?.hops ?? null, hashMode: null };
}

/**
 * Compact label for the meta row: e.g. "2h · 1b" | "3h" | "1b" | "". Uses
 * `!= null` checks throughout so a direct (0-hop) message renders "0h" rather
 * than collapsing to an empty string.
 */
export function formatPathStats(stats: PathStats): string {
  const parts: string[] = [];
  if (stats.hops != null) parts.push(`${stats.hops}h`);
  if (stats.hashMode != null) parts.push(`${stats.hashMode}b`);
  return parts.join(' · ');
}
