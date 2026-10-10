import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Bus = typeof import('../../../../../src/renderer/lib/map/bus');

const flyTo = { kind: 'flyTo' as const, lng: 1, lat: 2, zoom: 3 };

// The bus keeps its listeners and pending event in module state, so load a
// fresh copy per test.
let bus: Bus;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  bus = await import('../../../../../src/renderer/lib/map/bus');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('map bus', () => {
  it('delivers to every live subscriber and stops after unsubscribe', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = bus.subscribe(a);
    bus.subscribe(b);
    bus.publish(flyTo);
    expect(a).toHaveBeenCalledWith(flyTo);
    expect(b).toHaveBeenCalledWith(flyTo);
    offA();
    bus.publish({ ...flyTo, lng: 9 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('replays an event published with no subscriber to the next one, once', () => {
    bus.publish(flyTo);
    vi.advanceTimersByTime(4999);
    const first = vi.fn();
    bus.subscribe(first);
    expect(first).toHaveBeenCalledWith(flyTo);
    const second = vi.fn();
    bus.subscribe(second);
    expect(second).not.toHaveBeenCalled();
  });

  it('drops a pending event once it is older than the TTL', () => {
    bus.publish(flyTo);
    vi.advanceTimersByTime(5000);
    const late = vi.fn();
    bus.subscribe(late);
    expect(late).not.toHaveBeenCalled();
    // …and it does not linger for a later subscriber either.
    const later = vi.fn();
    bus.subscribe(later);
    expect(later).not.toHaveBeenCalled();
  });

  it('keeps only the latest unsubscribed event', () => {
    bus.publish(flyTo);
    bus.publish({ ...flyTo, lng: 7 });
    const fn = vi.fn();
    bus.subscribe(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ ...flyTo, lng: 7 });
  });
});
