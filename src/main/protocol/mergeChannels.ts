import type { Channel } from '../../shared/types';

/** Reconcile a fresh channel list enumerated by the radio with coresense's
 *  persisted channels.
 *
 *  meshcore-ts only carries radio-owned fields (key/name/kind/secretHex/idx);
 *  coresense adds app-owned fields the lib never sends — `order` (LeftNav sort
 *  position), `muted`, and `pinned`. A plain `setChannels(incoming)` would wipe
 *  those on every sync, so instead we take radio-owned fields from `incoming`
 *  and preserve app-owned fields from `prev` (keyed by channel key).
 *
 *  `order` is seeded from the radio slot `idx` the first time a channel is seen
 *  so the default LeftNav order matches the device rather than falling back to
 *  alphabetical; a later drag-reorder writes an explicit `order` that then wins
 *  over `idx` on subsequent syncs. */
export function mergeSyncedChannels(prev: Channel[], incoming: Channel[]): Channel[] {
  const prevByKey = new Map(prev.map((c) => [c.key, c]));
  return incoming.map((ch) => {
    const existing = prevByKey.get(ch.key);
    return {
      ...ch,
      order: existing?.order ?? ch.idx,
      muted: existing?.muted,
      pinned: existing?.pinned,
    };
  });
}
