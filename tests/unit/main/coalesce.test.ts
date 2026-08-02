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

  // A coalesced run() executes work that can throw (a DB rebuild hitting a
  // transient SQLite error, or a synchronous bus listener throwing). The main
  // process installs no uncaughtException handler, so a throw escaping the
  // trailing timer callback would terminate the app. Contain it instead.
  it('does not propagate an error thrown by run() on the leading edge', () => {
    const run = vi.fn(() => {
      throw new Error('boom');
    });
    const c = coalesce(run, 100);

    expect(() => c.schedule()).not.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not let an error from a trailing run() escape the timer callback', () => {
    let calls = 0;
    const run = vi.fn(() => {
      calls += 1;
      if (calls === 2) throw new Error('boom'); // throw on the trailing run only
    });
    const c = coalesce(run, 100);

    c.schedule(); // leading run (calls=1)
    c.schedule(); // pending

    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
  });

  it('keeps firing on later schedules after a run() throws', () => {
    let first = true;
    const run = vi.fn(() => {
      if (first) {
        first = false;
        throw new Error('boom');
      }
    });
    const c = coalesce(run, 100);

    expect(() => c.schedule()).not.toThrow(); // leading throws, contained
    vi.advanceTimersByTime(100); // the armed empty cycle lapses
    c.schedule(); // the coalescer is still usable and fires again

    expect(run).toHaveBeenCalledTimes(2);
  });
});
