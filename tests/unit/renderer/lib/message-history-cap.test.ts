import { beforeEach, describe, expect, it } from 'vitest';
import { planSync } from '../../../../src/renderer/components/messageListSync';
import { useStore } from '../../../../src/renderer/lib/store';
import type { Message } from '../../../../src/shared/types';

const T0 = 1_700_000_000_000;
const KEY = 'ch:Busy';

const m = (n: number): Message => ({
  id: `m${n}`,
  key: KEY,
  body: `b${n}`,
  ts: T0 + n * 1000,
  state: 'received',
  fromPublicKeyHex: 'alicepk',
});

/** What main broadcasts: the trailing 200 rows, re-derived every time. */
const windowEndingAt = (n: number): Message[] => {
  const out: Message[] = [];
  for (let i = Math.max(0, n - 199); i <= n; i++) out.push(m(i));
  return out;
};

const held = () => useStore.getState().messagesByKey[KEY] ?? [];

beforeEach(() => {
  useStore.setState({ messagesByKey: {} });
});

describe('retained history cap', () => {
  it('accumulates past the server window instead of sliding with it', () => {
    const apply = useStore.getState().applyMessages;
    for (let n = 199; n < 400; n++) apply(KEY, windowEndingAt(n));
    expect(held().length).toBe(400);
    expect(held()[0].id).toBe('m0');
  });

  it('bounds growth', () => {
    const apply = useStore.getState().applyMessages;
    for (let n = 199; n < 6000; n++) apply(KEY, windowEndingAt(n));
    expect(held().length).toBeLessThanOrEqual(5000);
    // Newest are always kept.
    expect(held().at(-1)?.id).toBe('m5999');
  });

  // The load-bearing property. Trimming back to exactly the cap would drop one
  // row per arrival once full — same length, every index shifted — which is the
  // shape that forces planSync into a full rebuild. That is the original bug,
  // relocated from 200 to the cap. Dropping a block at a time makes the rebuild
  // rare instead of constant.
  it('does not force a rebuild on every arrival once the cap is reached', () => {
    const apply = useStore.getState().applyMessages;
    for (let n = 199; n < 5200; n++) apply(KEY, windowEndingAt(n));

    let rebuilds = 0;
    for (let n = 5200; n < 5400; n++) {
      const before = held();
      apply(KEY, windowEndingAt(n));
      const plan = planSync(before, held(), { conversationChanged: false, unreadCutoff: 0 });
      if (plan.op === 'replace') rebuilds += 1;
      expect(plan.op === 'replace' || plan.op === 'append').toBe(true);
    }
    // 200 arrivals, at most one trim block among them.
    expect(rebuilds).toBeLessThanOrEqual(1);
  });

  it('keeps the array contiguous and ascending after a trim', () => {
    const apply = useStore.getState().applyMessages;
    for (let n = 199; n < 5600; n++) apply(KEY, windowEndingAt(n));
    const rows = held();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].ts).toBeGreaterThan(rows[i - 1].ts);
    }
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
});
