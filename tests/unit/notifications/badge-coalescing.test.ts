import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { subscribeBadgeRecompute } from '../../../src/main/notifications/badge';

// recomputeBadge walks every channel + contact key and reads up to 200 messages
// per key out of sqlite — ~10ms on a real store. It was wired straight to
// `contacts`, which the lib fires once per contact during a sync, so a 300
// contact sync spent ~3s recomputing a dock badge nobody can see mid-sync.

// Pin the interval here rather than relying on the production default, so
// changing that default can't silently make these timer advances meaningless.
const INTERVAL = 100;

describe('subscribeBadgeRecompute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    bus.removeAllListeners();
  });

  it('recomputes once for a burst of contacts events, not once per event', async () => {
    const recomputeBadge = vi.fn();
    const sub = subscribeBadgeRecompute({ recomputeBadge }, INTERVAL);

    for (let i = 0; i < 100; i++) bus.emit('contacts', []);
    await sub.flush();

    expect(recomputeBadge).toHaveBeenCalledTimes(2); // leading + one trailing
    sub.stop();
  });

  it('still recomputes for each of the other badge-affecting events', async () => {
    const recomputeBadge = vi.fn();
    const sub = subscribeBadgeRecompute({ recomputeBadge }, INTERVAL);

    bus.emit('channels', []);
    await sub.flush();
    bus.emit('appSettings', {});
    await sub.flush();
    bus.emit('blockRules', []);
    await sub.flush();

    expect(recomputeBadge).toHaveBeenCalledTimes(3);
    sub.stop();
  });

  it('settles on a final recompute after the burst ends', async () => {
    const recomputeBadge = vi.fn();
    const sub = subscribeBadgeRecompute({ recomputeBadge }, INTERVAL);

    bus.emit('contacts', []);
    bus.emit('contacts', []);
    expect(recomputeBadge).toHaveBeenCalledTimes(1); // trailing still pending

    await vi.advanceTimersByTimeAsync(1000);
    expect(recomputeBadge).toHaveBeenCalledTimes(2);
    sub.stop();
  });

  it('stops recomputing after stop()', async () => {
    const recomputeBadge = vi.fn();
    const sub = subscribeBadgeRecompute({ recomputeBadge }, INTERVAL);

    sub.stop();
    bus.emit('contacts', []);
    await vi.advanceTimersByTimeAsync(1000);

    expect(recomputeBadge).not.toHaveBeenCalled();
  });
});
