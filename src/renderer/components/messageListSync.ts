// The decision layer between "the store's message array changed" and "which
// imperative Virtuoso operation to run". Pure, so the operation chosen and the
// place the list lands are unit-testable without mounting a virtual list — the
// component itself is then just a switch that calls the matching ref method.
//
// This exists as its own module because three separate concerns all want to
// decide where the list lands after a data change (a pending search jump, the
// unread divider, and staying pinned to the bottom) and they were each about to
// grow their own branch inside one 76-line effect. Precedence between them is
// declared once, in locationFor.

import type { Message } from '../../shared/types';
import { buildAppended, buildItems, buildPrepended, computeFirstUnreadIdx, type Item } from './messageListItems';

/** Mirrors @virtuoso.dev/message-list's ItemLocationWithAlign, restated here so
 *  this module stays dependency-free and testable under the `unit` project. */
export interface ListLocation {
  index: number | 'LAST';
  align?: 'start' | 'center' | 'end' | 'start-no-overflow';
  behavior?: 'auto' | 'smooth' | 'instant';
}

export type SyncPlan =
  | { op: 'none' }
  /** Wholesale rebuild. Carries the landing spot, because a replace that omits
   *  one leaves the browser's raw scrollTop in place — which is how the bottom
   *  pin used to get silently dropped. */
  | { op: 'replace'; items: Item[] }
  /** Tail growth. `updated` carries any already-rendered message whose object
   *  identity changed in the same batch, which a bare append would drop. */
  | { op: 'append'; items: Item[]; isOwnSend: boolean; updated: Map<string, Message> | null }
  /** Head growth (load-older). */
  | { op: 'prepend'; items: Item[] }
  /** Same ids in the same order — state or path merges only. */
  | { op: 'update'; updated: Map<string, Message> };

/**
 * Where the list should land after a wholesale data operation.
 *
 * Precedence is load-bearing:
 *   1. an explicit jump target — the user asked to be taken somewhere;
 *   2. the unread divider — returning to a conversation with unread messages
 *      should land on the boundary, not past it;
 *   3. the bottom.
 *
 * The `focusFirstUnread` action (notification clicks) jumps to the very message
 * the divider sits above. Letting the jump win there would scroll the divider
 * just off the top edge — the one case where rule 2 beats rule 1, so a jump
 * that resolves to the item directly below the divider defers to it.
 *
 * The align is deliberately never 'center' or 'end' on an index. The library
 * resolves those two from its size tree and THROWS for an index it has not
 * measured yet, which is exactly the state a fresh replace leaves it in; the
 * error is swallowed and the scroll silently dropped. 'start-no-overflow' pins
 * to the top of the viewport but clamps to the scrollable range, so a target
 * near the end still settles at the natural bottom instead of overscrolling.
 */
export function locationFor(items: Item[], jumpToId?: string | null): ListLocation {
  const dividerIdx = items.findIndex((i) => i.kind === 'divider');
  if (jumpToId) {
    const jumpIdx = items.findIndex((i) => i.kind === 'msg' && i.m.id === jumpToId);
    // `dividerIdx + 1` is the first unread message — the jump's own target when
    // the caller was focusFirstUnread.
    if (jumpIdx >= 0 && !(dividerIdx >= 0 && jumpIdx === dividerIdx + 1)) {
      return { index: jumpIdx, align: 'start-no-overflow' };
    }
  }
  if (dividerIdx >= 0) return { index: dividerIdx, align: 'start-no-overflow' };
  return { index: 'LAST', align: 'end' };
}

/** Overlapping messages whose object identity changed, or null when none did.
 *  Compares the first `count` entries by reference — the store hands out frozen
 *  objects, so a changed reference is a changed message. */
function changedPrefix(prev: Message[], next: Message[], count: number): Map<string, Message> | null {
  let out: Map<string, Message> | null = null;
  for (let i = 0; i < count; i++) {
    if (next[i] !== prev[i] && next[i].id === prev[i].id) {
      out ??= new Map();
      out.set(next[i].id, next[i]);
    }
  }
  return out;
}

/**
 * Pick the cheapest operation that turns `prev` into `next`.
 *
 * Order matters: the cheap structural cases are tried first and the wholesale
 * replace is the fallback. A replace re-measures every row, so reaching it on
 * every inbound message (which is what the server's sliding history window used
 * to cause) is both a scroll bug and a performance one.
 */
export function planSync(
  prev: Message[],
  next: Message[],
  opts: { conversationChanged: boolean; unreadCutoff: number },
): SyncPlan {
  const rebuild = (): SyncPlan => ({
    op: 'replace',
    items: buildItems(next, computeFirstUnreadIdx(next, opts.unreadCutoff)),
  });

  if (opts.conversationChanged) return rebuild();
  if (prev === next) return { op: 'none' };
  if (prev.length === 0) return next.length > 0 ? rebuild() : { op: 'none' };

  // Tail growth — the common case: new arrivals and our own sends.
  //
  // Both ends are checked, not just the last overlapping id. With only the tail
  // pinned, a batch that simultaneously drops a row from the head and adds one
  // to the tail (a block rule hiding the oldest visible message while a jump
  // backfill lands, say) still matched — and the append left the removed row on
  // screen and the new head row absent, permanently. Anchoring the head too
  // sends that case to the rebuild, where it belongs.
  if (next.length > prev.length && next[0]?.id === prev[0]?.id && next[prev.length - 1]?.id === prev[prev.length - 1]?.id) {
    const added = next.slice(prev.length);
    return {
      op: 'append',
      items: buildAppended(added, prev[prev.length - 1]),
      // Self-sent messages carry no sender pubkey. Our own send must become
      // visible even when we are scrolled up; someone else's must not yank us.
      isOwnSend: added.some((m) => m.fromPublicKeyHex === undefined),
      updated: changedPrefix(prev, next, prev.length),
    };
  }

  // Head growth (load-older pagination).
  if (next.length > prev.length && next[next.length - prev.length]?.id === prev[0]?.id) {
    return { op: 'prepend', items: buildPrepended(next.slice(0, next.length - prev.length), prev[0]) };
  }

  // Same ids in the same order — a state change or a path merge. Date and
  // divider items are untouched: neither of those updates moves a message's
  // timestamp across a calendar day, and anything that reorders fails the id
  // check and falls through to the rebuild below, which re-derives separators.
  if (next.length === prev.length && next.every((m, i) => m.id === prev[i].id)) {
    const updated = changedPrefix(prev, next, prev.length);
    return updated ? { op: 'update', updated } : { op: 'none' };
  }

  return rebuild();
}
