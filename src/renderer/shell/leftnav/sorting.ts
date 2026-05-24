import type { Channel } from '../../../shared/types';
import { sortByPinned as sortByPinnedGeneric } from '../../lib/sortByPinned';

/** Channel sort: unread → pinned (then pinnedOrder) → order asc → name. */
export function sortChannels(
  items: Channel[],
  pinSet: Set<string>,
  pinnedOrder: string[],
  unreadByKey: Record<string, number> | null,
): Channel[] {
  return sortByPinnedGeneric(items, {
    key: (c) => c.key,
    isPinned: (c) => pinSet.has(c.key),
    pinnedOrder,
    isUnread: unreadByKey ? (c) => (unreadByKey[c.key] ?? 0) > 0 : undefined,
    order: (c) => c.order ?? undefined,
    label: (c) => c.name,
  });
}

/** Generic pinned-then-alphabetical sort preserving the original call-site shape. */
export function sortByPinned<T extends { key: string }>(
  items: T[],
  pinSet: Set<string>,
  pinnedOrder: string[],
  fallbackSort: (item: T) => string,
  unreadByKey: Record<string, number> | null,
): T[] {
  return sortByPinnedGeneric(items, {
    key: (item) => item.key,
    isPinned: (item) => pinSet.has(item.key),
    pinnedOrder,
    isUnread: unreadByKey ? (item) => (unreadByKey[item.key] ?? 0) > 0 : undefined,
    label: fallbackSort,
  });
}
