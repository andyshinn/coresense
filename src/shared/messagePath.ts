// Hop-count + path-hash-mode derivation for a message, sourced from the FIRST
// observed path (messages can arrive via several flood routes).
//
// This lives in `shared` rather than the renderer because BOTH the message-row
// meta chip and the main-process macro context have to answer "how many hops?"
// the same way. They didn't: the chip derived the count from `meta.paths` while
// `{{ hops }}` read the bare `meta.hops` scalar, which nothing in the ingest
// path ever writes. A message rendered "2h" next to a macro that rendered "?".
// One definition, imported by both, is the fix — do not re-derive a hop count
// anywhere else.

import type { Message, MessagePath } from './types';

export interface PathStats {
  /** Relay hop count, or null when unknown. 0 is a valid value (direct). */
  hops: number | null;
  /** Bytes per hop used in the path encoding (1/2/3), or null when unknown. */
  hashMode: number | null;
}

/**
 * The canonical relay count for one path: intermediate repeaters only. The
 * `origin` and `sink` pseudo-hops that bookend a path are the sender and our
 * own radio, so counting them would report every direct message as 2 hops.
 */
export function relayHopCount(path: MessagePath): number {
  return path.hops.filter((h) => h.kind === 'hop').length;
}

/**
 * Stats from the first path seen (`meta.paths[0]`). Falls back to the bare
 * `meta.hops` count (with an unknown hash mode) for messages that arrived
 * without a correlated mesh observation — no current ingest path populates
 * that field, but stored messages from older builds may carry it.
 */
export function firstPathStats(message: Message): PathStats {
  const path = message.meta?.paths?.[0];
  if (path) {
    return { hops: relayHopCount(path), hashMode: path.hashMode };
  }
  return { hops: message.meta?.hops ?? null, hashMode: null };
}
