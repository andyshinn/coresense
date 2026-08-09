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

/**
 * Does the freshly-decoded copy say anything the held one doesn't?
 *
 * Every broadcast arrives as new objects off the wire, so a naive merge hands
 * back 200 new references for 200 unchanged rows. Downstream that reads as "the
 * whole window changed": the list re-maps and re-renders every mounted row on
 * each single arrival, and a duplicate broadcast does the same work for nothing.
 * Keeping the held object whenever it is equivalent makes reference identity
 * mean what the rest of the renderer assumes it means.
 *
 * Only the mutable fields are compared. `meta` is compared structurally but
 * cheaply — path count and timesHeard are the parts that actually change as
 * receptions merge, and `blocked` flips when a block rule is added.
 */
function sameMessage(a: Message, b: Message): boolean {
  return (
    a.state === b.state &&
    a.body === b.body &&
    a.ts === b.ts &&
    a.meta?.blocked === b.meta?.blocked &&
    a.meta?.timesHeard === b.meta?.timesHeard &&
    (a.meta?.paths?.length ?? 0) === (b.meta?.paths?.length ?? 0) &&
    a.meta?.snr === b.meta?.snr
  );
}

/** The held copy when nothing changed, so unchanged rows keep their identity. */
function pick(held: Message | undefined, incoming: Message): Message {
  return held && sameMessage(held, incoming) ? held : incoming;
}

/** First index in an ascending list whose `ts` is >= `ts`. */
function lowerBound(list: Message[], ts: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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
    for (const m of prev) byId.set(m.id, m);
    for (const m of incoming) byId.set(m.id, pick(byId.get(m.id), m));
    return [...byId.values()].sort((a, b) => a.ts - b.ts);
  }

  // Everything held older than the window's first message cannot possibly be IN
  // that window, so it passes through untouched and never enters the lookup
  // structures below. This is what keeps the per-broadcast cost proportional to
  // the window (200 rows) instead of to however much history has accumulated —
  // without it, a conversation holding 20k rows rebuilt a 20k-entry Map on
  // every single inbound message.
  const start = lowerBound(prev, incoming[0].ts);

  const held = new Map<string, Message>();
  for (let k = start; k < prev.length; k++) held.set(prev[k].id, prev[k]);
  const incomingIds = new Set<string>();
  for (const m of incoming) incomingIds.add(m.id);

  /** Emit the window's copy, but reuse the held object when it says the same. */
  const take = (m: Message): Message => pick(held.get(m.id), m);

  const tail: Message[] = [];
  let i = start;
  let j = 0;
  while (i < prev.length && j < incoming.length) {
    const a = prev[i];
    // Anything held that the window also carries is emitted from the window
    // instead, at the window's position — skip it here so it cannot appear
    // twice when timestamps tie.
    if (incomingIds.has(a.id)) {
      i++;
      continue;
    }
    if (a.ts <= incoming[j].ts) {
      tail.push(a);
      i++;
    } else {
      tail.push(take(incoming[j]));
      j++;
    }
  }
  for (; i < prev.length; i++) if (!incomingIds.has(prev[i].id)) tail.push(prev[i]);
  for (; j < incoming.length; j++) tail.push(take(incoming[j]));

  // A re-broadcast that says nothing new returns the very array it was given,
  // so the store can skip the update and the list can skip the diff entirely.
  if (tail.length === prev.length - start && tail.every((m, k) => m === prev[start + k])) return prev;
  return start === 0 ? tail : prev.slice(0, start).concat(tail);
}
