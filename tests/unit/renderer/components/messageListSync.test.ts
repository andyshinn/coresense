import { describe, expect, it } from 'vitest';
import type { Item } from '../../../../src/renderer/components/messageListItems';
import { locationFor, planSync } from '../../../../src/renderer/components/messageListSync';
import type { Message } from '../../../../src/shared/types';

const DAY = 86_400_000;
const T0 = new Date('2026-07-25T12:00:00').getTime();

const msg = (id: string, over: Partial<Message> = {}): Message => ({
  id,
  key: 'ch:x',
  body: id,
  ts: T0 + Number(id.replace(/\D/g, '')) * 1000,
  state: 'received',
  fromPublicKeyHex: 'alicepk',
  ...over,
});

const mine = (id: string, over: Partial<Message> = {}): Message => {
  const m = msg(id, over);
  // Self-sent messages are identified by the ABSENCE of the key, not by null.
  delete (m as { fromPublicKeyHex?: string }).fromPublicKeyHex;
  return m;
};

const run = (prev: Message[], next: Message[], over: Partial<Parameters<typeof planSync>[2]> = {}) =>
  planSync(prev, next, { conversationChanged: false, unreadCutoff: 0, ...over });

const ids = (items: Item[]) => items.filter((i) => i.kind === 'msg').map((i) => (i as { m: Message }).m.id);

describe('planSync', () => {
  it('rebuilds on a conversation switch even when the arrays match', () => {
    const list = [msg('m1')];
    expect(run(list, list, { conversationChanged: true }).op).toBe('replace');
  });

  it('does nothing when the array is referentially unchanged', () => {
    const list = [msg('m1')];
    expect(run(list, list)).toEqual({ op: 'none' });
  });

  it('rebuilds for the first batch into an empty conversation', () => {
    const plan = run([], [msg('m1'), msg('m2')]);
    expect(plan.op).toBe('replace');
    expect(plan.op === 'replace' && ids(plan.items)).toEqual(['m1', 'm2']);
  });

  it('does nothing when both sides are empty', () => {
    expect(run([], [])).toEqual({ op: 'none' });
  });

  describe('tail growth', () => {
    it('appends only the new messages', () => {
      const prev = [msg('m1'), msg('m2')];
      const plan = run(prev, [...prev, msg('m3')]);
      expect(plan.op).toBe('append');
      expect(plan.op === 'append' && ids(plan.items)).toEqual(['m3']);
    });

    it('flags a batch containing our own send so it can force-scroll', () => {
      const prev = [msg('m1')];
      expect(run(prev, [...prev, mine('m2')])).toMatchObject({ op: 'append', isOwnSend: true });
      expect(run(prev, [...prev, msg('m2')])).toMatchObject({ op: 'append', isOwnSend: false });
    });

    // A broadcast can carry a state change to an older message alongside a new
    // arrival. A bare append renders the new row and silently keeps the stale
    // copy of the old one.
    it('carries state changes to already-rendered messages riding the same batch', () => {
      const prev = [msg('m1'), msg('m2')];
      const next = [prev[0], { ...prev[1], state: 'ack' as const }, msg('m3')];
      const plan = run(prev, next);
      expect(plan.op).toBe('append');
      expect(plan.op === 'append' && plan.updated?.get('m2')?.state).toBe('ack');
      expect(plan.op === 'append' && plan.updated?.has('m1')).toBe(false);
    });

    it('leaves updated null when the overlapping prefix is untouched', () => {
      const prev = [msg('m1')];
      expect(run(prev, [...prev, msg('m2')])).toMatchObject({ updated: null });
    });

    it('emits a date separator when the appended message starts a new day', () => {
      const prev = [msg('m1')];
      const plan = run(prev, [...prev, msg('m2', { ts: T0 + DAY })]);
      expect(plan.op === 'append' && plan.items.map((i) => i.kind)).toEqual(['date', 'msg']);
    });
  });

  describe('head growth', () => {
    it('prepends the older batch', () => {
      const prev = [msg('m5')];
      const plan = run(prev, [msg('m3'), msg('m4'), ...prev]);
      expect(plan.op).toBe('prepend');
      expect(plan.op === 'prepend' && ids(plan.items)).toEqual(['m3', 'm4']);
    });
  });

  describe('in-place updates', () => {
    it('maps only the messages whose identity changed', () => {
      const prev = [msg('m1'), msg('m2')];
      const next = [prev[0], { ...prev[1], state: 'ack' as const }];
      const plan = run(prev, next);
      expect(plan.op).toBe('update');
      expect(plan.op === 'update' && [...plan.updated.keys()]).toEqual(['m2']);
    });

    // Every WS broadcast used to hand over freshly deserialized objects, so an
    // equal-but-new array would map every row for nothing.
    it('does nothing when same-length arrays hold the same object references', () => {
      const prev = [msg('m1'), msg('m2')];
      expect(run(prev, [...prev])).toEqual({ op: 'none' });
    });
  });

  describe('fallback', () => {
    // This is the shape the server's trailing-200 window produced on every
    // inbound message once a conversation passed 200 stored rows: same length,
    // every index shifted by one.
    it('rebuilds for a slid window', () => {
      const prev = [msg('m1'), msg('m2'), msg('m3')];
      const next = [msg('m2'), msg('m3'), msg('m4')];
      const plan = run(prev, next);
      expect(plan.op).toBe('replace');
      expect(plan.op === 'replace' && ids(plan.items)).toEqual(['m2', 'm3', 'm4']);
    });

    it('rebuilds when messages are reordered', () => {
      const prev = [msg('m1'), msg('m2')];
      const plan = run(prev, [msg('m2'), msg('m1')]);
      expect(plan.op).toBe('replace');
    });

    it('rebuilds when the list shrinks', () => {
      expect(run([msg('m1'), msg('m2')], [msg('m1')]).op).toBe('replace');
    });

    it('carries the unread divider through the rebuild', () => {
      const prev = [msg('m1')];
      const next = [msg('m1'), msg('m2'), msg('m3')];
      const plan = run(prev.concat(msg('m9')), next, { unreadCutoff: next[0].ts });
      expect(plan.op === 'replace' && plan.items.some((i) => i.kind === 'divider')).toBe(true);
    });
  });
});

describe('locationFor', () => {
  const items = (over: { divider?: number; count?: number } = {}): Item[] => {
    const out: Item[] = [];
    for (let i = 0; i < (over.count ?? 4); i++) {
      if (i === over.divider) out.push({ kind: 'divider', id: '__unread__' });
      out.push({ kind: 'msg', m: msg(`m${i}`) });
    }
    return out;
  };

  it('lands on the bottom with no divider and no jump', () => {
    expect(locationFor(items())).toEqual({ index: 'LAST', align: 'end' });
  });

  it('lands on the divider when one is present', () => {
    expect(locationFor(items({ divider: 2 }))).toEqual({ index: 2, align: 'start-no-overflow' });
  });

  it('lets an explicit jump beat the divider', () => {
    // divider at index 2, so messages sit at 0,1,3,4 — m3 is at index 4.
    expect(locationFor(items({ divider: 2 }), 'm3')).toEqual({ index: 4, align: 'start-no-overflow' });
  });

  // focusFirstUnread targets exactly the message the divider sits above.
  // Honouring the jump there would scroll the divider off the top edge.
  it('defers to the divider when the jump target is the first unread message', () => {
    expect(locationFor(items({ divider: 2 }), 'm2')).toEqual({ index: 2, align: 'start-no-overflow' });
  });

  it('falls back to the bottom when the jump target is not in the list', () => {
    expect(locationFor(items(), 'nope')).toEqual({ index: 'LAST', align: 'end' });
  });

  it('falls back to the divider when the jump target is not in the list', () => {
    expect(locationFor(items({ divider: 1 }), 'nope')).toEqual({ index: 1, align: 'start-no-overflow' });
  });

  // 'center' and 'end' are resolved from the size tree and throw for an index
  // that has not been measured — which is precisely the state a fresh replace
  // leaves the list in. Every index-based landing has to use a safe align.
  it('never uses an align that throws on an unmeasured index', () => {
    for (const loc of [locationFor(items({ divider: 1 })), locationFor(items(), 'm2'), locationFor(items())]) {
      if (typeof loc.index === 'number') expect(loc.align).toBe('start-no-overflow');
    }
  });
});
