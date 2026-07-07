import { describe, expect, it } from 'vitest';
import {
  buildAppended,
  buildItems,
  buildPrepended,
  computeFirstUnreadIdx,
} from '../../../../src/renderer/components/messageListItems';
import type { Message } from '../../../../src/shared/types';

const JUL2 = new Date(2026, 6, 2, 12, 0, 0).getTime();
const JUL2_LATER = new Date(2026, 6, 2, 18, 0, 0).getTime();
const JUL4 = new Date(2026, 6, 4, 9, 0, 0).getTime();
const JUL6 = new Date(2026, 6, 6, 9, 0, 0).getTime();

function msg(id: string, ts: number, over: Partial<Message> = {}): Message {
  return { id, key: 'k', body: id, ts, state: 'received', fromPublicKeyHex: 'aa', ...over };
}

describe('buildItems', () => {
  it('emits no date separator for a single-day conversation', () => {
    const items = buildItems([msg('a', JUL2), msg('b', JUL2_LATER)], -1);
    expect(items.map((i) => i.kind)).toEqual(['msg', 'msg']);
  });

  it('never emits a separator above the first message', () => {
    const items = buildItems([msg('a', JUL2)], -1);
    expect(items.map((i) => i.kind)).toEqual(['msg']);
  });

  it('inserts one date separator at a day transition, labeled with the newer day', () => {
    const items = buildItems([msg('a', JUL2), msg('b', JUL4)], -1);
    expect(items.map((i) => i.kind)).toEqual(['msg', 'date', 'msg']);
    const date = items[1];
    expect(date.kind === 'date' && date.ts).toBe(JUL4);
  });

  it('emits exactly one separator across a multi-day gap (newest date)', () => {
    const items = buildItems([msg('a', JUL2), msg('b', JUL6)], -1);
    const dates = items.filter((i) => i.kind === 'date');
    expect(dates).toHaveLength(1);
    expect(dates[0].kind === 'date' && dates[0].ts).toBe(JUL6);
  });

  it('orders date before the unread divider when they coincide', () => {
    // firstUnreadIdx = 1 (msg b), which is also a day transition.
    const items = buildItems([msg('a', JUL2), msg('b', JUL4)], 1);
    expect(items.map((i) => i.kind)).toEqual(['msg', 'date', 'divider', 'msg']);
  });
});

describe('computeFirstUnreadIdx', () => {
  it('returns -1 when cutoff is 0', () => {
    expect(computeFirstUnreadIdx([msg('a', JUL2)], 0)).toBe(-1);
  });

  it('finds the first received message newer than the cutoff', () => {
    const msgs = [msg('a', JUL2), msg('b', JUL4)];
    expect(computeFirstUnreadIdx(msgs, JUL2)).toBe(1);
  });

  it('skips self-sent messages (no fromPublicKeyHex)', () => {
    const msgs = [msg('a', JUL2), msg('b', JUL4, { fromPublicKeyHex: undefined })];
    expect(computeFirstUnreadIdx(msgs, JUL2)).toBe(-1);
  });
});

describe('buildAppended', () => {
  it('emits no date separator when the append stays on the same day', () => {
    const items = buildAppended([msg('b', JUL2_LATER)], msg('a', JUL2));
    expect(items.map((i) => i.kind)).toEqual(['msg']);
  });

  it('emits a date separator when the first appended message starts a new day', () => {
    const items = buildAppended([msg('b', JUL4)], msg('a', JUL2));
    expect(items.map((i) => i.kind)).toEqual(['date', 'msg']);
    expect(items[0].kind === 'date' && items[0].ts).toBe(JUL4);
  });

  it('emits separators at internal transitions within the appended batch', () => {
    const items = buildAppended([msg('b', JUL2_LATER), msg('c', JUL4)], msg('a', JUL2));
    expect(items.map((i) => i.kind)).toEqual(['msg', 'date', 'msg']);
  });
});

describe('buildPrepended', () => {
  it('emits no boundary separator when older batch shares the head day', () => {
    const items = buildPrepended([msg('a', JUL2)], msg('b', JUL2_LATER));
    expect(items.map((i) => i.kind)).toEqual(['msg']);
  });

  it('emits a boundary separator (head day) when days differ', () => {
    const items = buildPrepended([msg('a', JUL2)], msg('b', JUL4));
    expect(items.map((i) => i.kind)).toEqual(['msg', 'date']);
    const date = items[1];
    expect(date.kind === 'date' && date.ts).toBe(JUL4);
  });

  it('never emits a separator above the batch topmost message', () => {
    const items = buildPrepended([msg('a', JUL2), msg('b', JUL4)], msg('c', JUL4));
    // internal Jul2->Jul4 transition only; no leading separator, no boundary (Jul4==Jul4).
    expect(items.map((i) => i.kind)).toEqual(['msg', 'date', 'msg']);
  });
});
