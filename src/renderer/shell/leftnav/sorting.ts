import { sortByPinned as sortByPinnedGeneric } from '../../lib/sortByPinned';

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
