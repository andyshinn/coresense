import type { Message } from '../../shared/types';

/**
 * Fold a freshly-broadcast history window into what the renderer already holds.
 *
 * Main answers every `messages` broadcast and every `GET /api/messages/:key`
 * with the TRAILING window of a conversation (200 rows by default), re-derived
 * from SQLite each time. Assigning that window straight into the store made the
 * rendered array *slide* once a conversation passed the window size: previous
 * `[m1..m200]`, next `[m2..m201]`. Same length, every index shifted by one — no
 * append, no prepend, no in-place update, so the list fell through to a
 * wholesale replace on literally every inbound message, which discarded the
 * scroll position and re-measured every row.
 *
 * Merging by id instead makes the renderer's copy append-only and monotonic, so
 * an arrival is an arrival. It also stops the window's head from rolling
 * messages out from under a search jump that just fetched them.
 *
 * Incoming wins on collision, so state changes and path merges riding a
 * broadcast are applied rather than dropped. Ordering is by `ts`; a message's
 * `ts` never changes once assigned (state and meta updates leave it alone), so
 * the two sorted inputs can be merged linearly. Ties keep the existing entry
 * first, which keeps the order stable across re-broadcasts.
 *
 * Nothing deletes messages in production — `trimPerKey` has no caller outside
 * tests — so there is no case where the renderer needs to forget a row it has
 * already seen. If pruning is ever introduced it will need an explicit event
 * rather than the absence of a row from a window.
 */
function isAscending(list: Message[]): boolean {
  for (let i = 1; i < list.length; i++) if (list[i].ts < list[i - 1].ts) return false;
  return true;
}

export function mergeMessages(prev: Message[], incoming: Message[]): Message[] {
  if (prev.length === 0) return incoming;
  if (incoming.length === 0) return prev;

  // The linear merge below is only correct for two ascending inputs, which is
  // what every caller supplies (`ORDER BY ts` on both the broadcast and the
  // fetch). Rather than trust that silently, fall back to a sort when it does
  // not hold — an out-of-order window should cost time, not corrupt the list.
  if (!isAscending(prev) || !isAscending(incoming)) {
    const byId = new Map<string, Message>();
    for (const msg of prev) byId.set(msg.id, msg);
    for (const msg of incoming) byId.set(msg.id, msg);
    return [...byId.values()].sort((a, b) => a.ts - b.ts);
  }

  const incomingIds = new Set<string>();
  for (const m of incoming) incomingIds.add(m.id);

  const out: Message[] = [];
  let i = 0;
  let j = 0;
  while (i < prev.length && j < incoming.length) {
    const a = prev[i];
    // Anything in prev that the window also carries is emitted from the window
    // instead, at the window's position — skip it here so it cannot appear
    // twice when timestamps tie.
    if (incomingIds.has(a.id)) {
      i++;
      continue;
    }
    if (a.ts <= incoming[j].ts) {
      out.push(a);
      i++;
    } else {
      out.push(incoming[j]);
      j++;
    }
  }
  for (; i < prev.length; i++) {
    if (!incomingIds.has(prev[i].id)) out.push(prev[i]);
  }
  for (; j < incoming.length; j++) out.push(incoming[j]);
  return out;
}
