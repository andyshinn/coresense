import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { InboxCache } from '../../../../src/main/bridge/inboxCache';

const frame = (n: number) => Buffer.from([0x10, n]);

describe('InboxCache', () => {
  it('hands out absolute sequence numbers from 0', () => {
    const cache = new InboxCache();
    expect(cache.append(frame(0)).seq).toBe(0);
    expect(cache.append(frame(1)).seq).toBe(1);
    expect(cache.head()).toBe(2);
    expect(cache.get(1)?.bytes).toEqual(frame(1));
  });

  it('reports head as the oldest seq while empty', () => {
    const cache = new InboxCache();
    expect(cache.oldestSeq()).toBe(0);
    expect(cache.head()).toBe(0);
    expect(cache.get(0)).toBeNull();
  });

  // Callers hold cursors as absolute seqs, so eviction must never renumber.
  it('keeps sequence numbers stable across eviction', () => {
    const cache = new InboxCache(3);
    for (let i = 0; i < 5; i++) cache.append(frame(i));

    expect(cache.size()).toBe(3);
    expect(cache.oldestSeq()).toBe(2);
    expect(cache.head()).toBe(5);
    expect(cache.get(1)).toBeNull(); // evicted
    expect(cache.get(2)?.bytes).toEqual(frame(2));
    expect(cache.get(4)?.bytes).toEqual(frame(4));
    expect(cache.get(5)).toBeNull(); // not yet appended
  });

  it('starts over from seq 0 after a reset', () => {
    const cache = new InboxCache();
    cache.append(frame(0));
    cache.append(frame(1));

    cache.reset();

    expect(cache.size()).toBe(0);
    expect(cache.head()).toBe(0);
    expect(cache.append(frame(9)).seq).toBe(0);
  });
});
