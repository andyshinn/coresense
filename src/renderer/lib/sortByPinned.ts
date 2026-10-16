import type { Channel } from '../../shared/types';

/** Returns a sorted copy applying tiers: unread → pinned (then pinnedOrder) → order asc → label (localeCompare, case-insensitive). */
export function sortByPinned<T>(
  items: readonly T[],
  opts: {
    key: (item: T) => string;
    isUnread?: (item: T) => boolean;
    isPinned: (item: T) => boolean;
    pinnedOrder?: readonly string[];
    order?: (item: T) => number | undefined;
    label: (item: T) => string;
  },
): T[] {
  const { key, isUnread, isPinned, pinnedOrder, order, label } = opts;
  const pinnedIdx = pinnedOrder ? new Map(pinnedOrder.map((k, i) => [k, i] as const)) : null;
  return [...items].sort((a, b) => {
    if (isUnread) {
      const au = isUnread(a);
      const bu = isUnread(b);
      if (au !== bu) return au ? -1 : 1;
    }
    const ap = isPinned(a);
    const bp = isPinned(b);
    if (ap && !bp) return -1;
    if (!ap && bp) return 1;
    if (ap && bp && pinnedIdx) {
      return (pinnedIdx.get(key(a)) ?? 0) - (pinnedIdx.get(key(b)) ?? 0);
    }
    if (order) {
      const ao = order(a) ?? Number.POSITIVE_INFINITY;
      const bo = order(b) ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
    }
    return label(a).localeCompare(label(b));
  });
}

/** Channel sort: unread → pinned (then pinnedOrder) → order asc → name. Shared
 *  by the left nav and the ⌘1-9 channel shortcuts so both number channels the
 *  same way. */
export function sortChannels(
  items: Channel[],
  pinSet: Set<string>,
  pinnedOrder: string[],
  unreadByKey: Record<string, number> | null,
): Channel[] {
  return sortByPinned(items, {
    key: (c) => c.key,
    isPinned: (c) => pinSet.has(c.key),
    pinnedOrder,
    isUnread: unreadByKey ? (c) => (unreadByKey[c.key] ?? 0) > 0 : undefined,
    order: (c) => c.order ?? undefined,
    label: (c) => c.name,
  });
}
