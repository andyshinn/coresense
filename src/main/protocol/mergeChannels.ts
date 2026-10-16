import { isChannelKey } from '../../shared/conversationKey';
import type { Channel } from '../../shared/types';

/** A channel as meshcore-ts reports it: the same shape, with the key typed as a
 *  plain string. */
type LibChannel = Omit<Channel, 'key'> & { key: string };

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
 *  over `idx` on subsequent syncs.
 *
 *  This is a UNION, not a replace: a channel present in `prev` but absent from
 *  `incoming` is retained untouched. The lib emits `channels` incrementally
 *  (one cumulative list per RESP_CHANNEL_INFO during a sync burst), so a channel
 *  simply hasn't been re-enumerated yet; and coresense keeps app-only channels
 *  that aren't on the radio at all (e.g. after "remove from device"). Membership
 *  is owned by explicit user actions (DELETE /api/channels/:key), never by a
 *  sync — dropping here would erase a not-yet-enumerated channel's muted/order. */
export function mergeSyncedChannels(prev: Channel[], incoming: LibChannel[]): Channel[] {
  const prevByKey = new Map<string, Channel>(prev.map((c) => [c.key, c]));
  const incomingKeys = new Set(incoming.map((c) => c.key));
  // The library builds every channel key as `ch:<name>`; the guard narrows the
  // type and would drop anything else rather than store it.
  const synced = incoming.flatMap((ch): Channel[] => {
    const { key } = ch;
    if (!isChannelKey(key)) return [];
    const existing = prevByKey.get(key);
    return [
      {
        ...ch,
        key,
        order: existing?.order ?? ch.idx,
        muted: existing?.muted,
        pinned: existing?.pinned,
        createdAt: existing?.createdAt ?? Date.now(),
      },
    ];
  });
  // Carry over channels the radio didn't mention this pass (see the union note
  // above). Sorting for display happens in the renderer, so append order here
  // is irrelevant.
  const carried = prev.filter((c) => !incomingKeys.has(c.key));
  return [...synced, ...carried];
}
