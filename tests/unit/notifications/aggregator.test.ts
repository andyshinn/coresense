import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAggregator, type StaleDescriptor } from '../../../src/main/notifications/aggregator';
import type { Message } from '../../../src/shared/types';

const NOW = 1_000_000_000_000;
const config = { staleThresholdMs: 5 * 60_000, flushDelayMs: 1_000, rollupCap: 5 };
const msg = (over: Partial<Message>): Message => ({ id: 'm', key: 'ch:a', body: 'hi', ts: NOW, state: 'received', ...over });

function harness() {
  const individual: Message[] = [];
  const summaries: StaleDescriptor[][] = [];
  const globals: Array<{ total: number; conversationCount: number; lastKey: string }> = [];
  const agg = createAggregator({
    now: () => NOW,
    config,
    callbacks: {
      onIndividual: (m) => individual.push(m),
      onSummaries: (s) => summaries.push(s),
      onGlobalSummary: (g) => globals.push(g),
    },
  });
  return { agg, individual, summaries, globals };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('aggregator', () => {
  it('fires fresh messages individually and immediately', () => {
    const h = harness();
    h.agg.ingest(msg({ id: 'm1', ts: NOW - 1_000 }), 'Alice');
    expect(h.individual).toHaveLength(1);
    expect(h.summaries).toHaveLength(0);
  });

  it('debounces stale messages into one per-conversation summary', () => {
    const h = harness();
    const stale = NOW - 10 * 60_000;
    h.agg.ingest(msg({ id: 'm1', key: 'ch:a', ts: stale }), 'Alice');
    h.agg.ingest(msg({ id: 'm2', key: 'ch:a', ts: stale }), 'Bob');
    h.agg.ingest(msg({ id: 'm3', key: 'c:x', ts: stale }), '');
    expect(h.summaries).toHaveLength(0); // still debouncing
    vi.advanceTimersByTime(1_000);
    expect(h.individual).toHaveLength(0);
    expect(h.summaries).toHaveLength(1);
    const byKey = Object.fromEntries(h.summaries[0].map((d) => [d.key, d]));
    expect(byKey['ch:a']).toMatchObject({ count: 2, senders: ['Alice', 'Bob'] });
    expect(byKey['c:x']).toMatchObject({ count: 1, senders: [] });
  });

  it('rolls up into a global summary past the cap', () => {
    const h = harness();
    const stale = NOW - 10 * 60_000;
    for (let i = 0; i < 6; i++) h.agg.ingest(msg({ id: `m${i}`, key: `ch:${i}`, ts: stale }), 'S');
    vi.advanceTimersByTime(1_000);
    expect(h.summaries).toHaveLength(0);
    expect(h.globals).toEqual([{ total: 6, conversationCount: 6, lastKey: 'ch:5' }]);
  });

  it('clear(key) drops a conversation from later summaries', () => {
    const h = harness();
    const stale = NOW - 10 * 60_000;
    h.agg.ingest(msg({ id: 'm1', key: 'ch:a', ts: stale }), 'Alice');
    h.agg.clear('ch:a');
    vi.advanceTimersByTime(1_000);
    expect(h.summaries).toHaveLength(0);
  });
});
