import { describe, expect, it } from 'vitest';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const seed = (key: string, ts: number, from: string | undefined, body: string) =>
  messagesStore.insert({ id: `${key}-${ts}-${body}`, key, ts, body, state: 'received', fromPublicKeyHex: from } as Message);

describe('messagesStore.statsByKey', () => {
  it('aggregates counts, windows, roster and distinct senders', () => {
    const noon = new Date(1_700_000_000_000);
    noon.setHours(12, 0, 0, 0);
    const now = noon.getTime();
    seed('ch:Stats', now - 1 * HOUR, undefined, 'a'); // self
    seed('ch:Stats', now - 2 * HOUR, 'name:alice', 'b');
    seed('ch:Stats', now - 2 * DAY, 'name:bob', 'c');
    seed('ch:Stats', now - 6 * DAY, 'name:alice', 'd');
    seed('ch:Other', now, 'name:zed', 'x'); // different channel, must be excluded

    const s = messagesStore.statsByKey('ch:Stats', now);
    expect(s.count).toBe(4);
    expect(s.firstTs).toBe(now - 6 * DAY);
    expect(s.lastTs).toBe(now - 1 * HOUR);
    expect(s.count24h).toBe(2); // the two hour-old messages
    expect(s.count7d).toBe(4);
    expect(s.distinctSenders).toBe(2); // alice + bob; self excluded
    expect(s.roster.map((r) => r.fromPk)).toEqual([null, 'name:alice', 'name:bob']); // by lastTs desc
    const alice = s.roster.find((r) => r.fromPk === 'name:alice');
    expect(alice?.count).toBe(2);
  });

  it('buckets messages into 7 local-day sparkline buckets', () => {
    const noon = new Date(1_700_000_000_000);
    noon.setHours(12, 0, 0, 0);
    const now = noon.getTime();
    seed('ch:Spark', now, 'name:a', '0'); // today -> index 6
    seed('ch:Spark', now - 2 * DAY, 'name:a', '2'); // -> index 4
    seed('ch:Spark', now - 6 * DAY, 'name:a', '6'); // -> index 0

    const s = messagesStore.statsByKey('ch:Spark', now);
    expect(s.perDay).toEqual([1, 0, 0, 0, 1, 0, 1]);
  });

  it('returns an empty-shaped struct for an unknown key', () => {
    const s = messagesStore.statsByKey('ch:Nope', 1_700_000_000_000);
    expect(s).toEqual({
      count: 0,
      firstTs: null,
      lastTs: null,
      count24h: 0,
      count7d: 0,
      distinctSenders: 0,
      roster: [],
      perDay: [0, 0, 0, 0, 0, 0, 0],
    });
  });
});
