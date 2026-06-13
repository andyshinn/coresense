import { describe, expect, it } from 'vitest';
import { sortByPinned } from '../../../../src/renderer/lib/sortByPinned';

interface Item {
  id: string;
  pinned?: boolean;
  unread?: boolean;
  ord?: number;
}

const sort = (items: Item[], opts: Partial<Parameters<typeof sortByPinned<Item>>[1]> = {}) =>
  sortByPinned(items, {
    key: (i) => i.id,
    isPinned: (i) => !!i.pinned,
    label: (i) => i.id,
    ...opts,
  }).map((i) => i.id);

describe('sortByPinned', () => {
  it('orders unread first, then pinned, then by label', () => {
    const items: Item[] = [{ id: 'b' }, { id: 'a', pinned: true }, { id: 'c', unread: true }];
    expect(sort(items, { isUnread: (i) => !!i.unread })).toEqual(['c', 'a', 'b']);
  });

  it('honors an explicit pinnedOrder', () => {
    const items: Item[] = [
      { id: 'x', pinned: true },
      { id: 'y', pinned: true },
    ];
    expect(sort(items, { pinnedOrder: ['y', 'x'] })).toEqual(['y', 'x']);
  });

  it('falls back to ascending order() then label', () => {
    const items: Item[] = [
      { id: 'b', ord: 2 },
      { id: 'a', ord: 1 },
    ];
    expect(sort(items, { order: (i) => i.ord })).toEqual(['a', 'b']);
  });

  it('sorts by label when nothing else differs', () => {
    expect(sort([{ id: 'banana' }, { id: 'apple' }, { id: 'cherry' }])).toEqual(['apple', 'banana', 'cherry']);
  });

  it('does not mutate the input array', () => {
    const items: Item[] = [{ id: 'b' }, { id: 'a' }];
    sort(items);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});
