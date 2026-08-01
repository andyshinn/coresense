import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coalesce } from '../../../src/main/events/coalesce';

// A coalescer collapses a burst of "this changed" signals into a bounded number
// of runs: one immediately (so the UI reacts without waiting), then at most one
// more per interval for everything that arrived during it.

describe('coalesce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs immediately on the first schedule', () => {
    const run = vi.fn();
    coalesce(run, 100).schedule();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst within the interval into a single trailing run', () => {
    const run = vi.fn();
    const c = coalesce(run, 100);

    for (let i = 0; i < 50; i++) c.schedule();
    expect(run).toHaveBeenCalledTimes(1); // leading only, so far

    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(2); // one trailing for all 49 others
  });

  it('does not schedule a trailing run when nothing arrived during the interval', () => {
    const run = vi.fn();
    coalesce(run, 100).schedule();

    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs a pending trailing immediately on flush', async () => {
    const run = vi.fn();
    const c = coalesce(run, 100);

    c.schedule();
    c.schedule();
    await c.flush();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('flush is a no-op when nothing is pending', async () => {
    const run = vi.fn();
    const c = coalesce(run, 100);

    c.schedule();
    await c.flush();
    await c.flush();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancel drops a pending trailing run', () => {
    const run = vi.fn();
    const c = coalesce(run, 100);

    c.schedule();
    c.schedule();
    c.cancel();
    vi.advanceTimersByTime(1000);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('starts a new cycle after the interval lapses', () => {
    const run = vi.fn();
    const c = coalesce(run, 100);

    c.schedule();
    vi.advanceTimersByTime(1000);
    c.schedule();

    expect(run).toHaveBeenCalledTimes(2); // leading of the second cycle
  });
});
