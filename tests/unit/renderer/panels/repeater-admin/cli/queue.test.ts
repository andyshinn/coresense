import { describe, expect, it } from 'vitest';
import type { CliEntry, CliQueueState } from '@/panels/repeater-admin/cli/lib/queue';
import { abortAll, beginNext, cancel, enqueue, historyStatusFor, settle } from '@/panels/repeater-admin/cli/lib/queue';

let seq = 0;
const entry = (over: Partial<CliEntry> = {}): CliEntry => ({
  id: `e${seq++}`,
  text: 'ver',
  cmd: null,
  state: 'queued',
  queuedAt: 0,
  startedAt: null,
  endedAt: null,
  reply: null,
  error: null,
  ...over,
});

const state = (entries: CliEntry[]): CliQueueState => ({ entries });

describe('queue transitions', () => {
  it('enqueue appends in order', () => {
    const s = enqueue(enqueue(state([]), entry({ id: 'a' })), entry({ id: 'b' }));
    expect(s.entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('beginNext promotes the earliest queued entry to sending', () => {
    const { state: s, next } = beginNext(state([entry({ id: 'a' }), entry({ id: 'b' })]));
    expect(next?.id).toBe('a');
    expect(s.entries[0].state).toBe('sending');
    expect(s.entries[0].startedAt).toEqual(expect.any(Number));
    expect(s.entries[1].state).toBe('queued');
  });

  it('beginNext returns null while an entry is already sending (one-at-a-time)', () => {
    const { next } = beginNext(state([entry({ id: 'a', state: 'sending' }), entry({ id: 'b' })]));
    expect(next).toBeNull();
  });

  it('beginNext returns null when nothing is queued', () => {
    expect(beginNext(state([entry({ id: 'a', state: 'ok' })])).next).toBeNull();
  });

  it('settle patches an entry by id', () => {
    const s = settle(state([entry({ id: 'a', state: 'sending' })]), 'a', { state: 'ok', reply: 'pong', endedAt: 5 });
    expect(s.entries[0]).toMatchObject({ state: 'ok', reply: 'pong', endedAt: 5 });
  });

  it('cancel moves a queued entry to cancelled and leaves others alone', () => {
    const s = cancel(state([entry({ id: 'a', state: 'sending' }), entry({ id: 'b' })]), 'b');
    expect(s.entries[0].state).toBe('sending');
    expect(s.entries[1].state).toBe('cancelled');
  });

  it('cancel is a no-op on a non-queued entry', () => {
    const s = cancel(state([entry({ id: 'a', state: 'sending' })]), 'a');
    expect(s.entries[0].state).toBe('sending');
  });

  it('abortAll cancels the sending entry too, so beginNext recovers', () => {
    const aborted = abortAll(state([entry({ id: 'a', state: 'sending' }), entry({ id: 'b' })]));
    expect(aborted.entries[0].state).toBe('cancelled');
    expect(aborted.entries[0].error).toEqual({ kind: 'transport', message: expect.any(String) });
    expect(aborted.entries[1].state).toBe('cancelled');
    // Nothing is left sending, so the queue is not wedged.
    expect(beginNext(aborted).next).toBeNull();
  });

  it('abortAll leaves terminal entries untouched', () => {
    const s = abortAll(state([entry({ id: 'a', state: 'ok' })]));
    expect(s.entries[0].state).toBe('ok');
  });

  it('excludes cancelled and non-terminal entries from history', () => {
    expect(historyStatusFor(entry({ state: 'ok' }))).toBe('ok');
    expect(historyStatusFor(entry({ state: 'sent' }))).toBe('sent');
    expect(historyStatusFor(entry({ state: 'cancelled' }))).toBeNull();
    expect(historyStatusFor(entry({ state: 'queued' }))).toBeNull();
  });
});
