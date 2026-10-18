import { vi } from 'vitest';
import { type BusEventMap, bus } from '../../src/main/events/bus';
import { deferTeardown } from './teardown';

export interface BusCapture<K extends keyof BusEventMap> {
  /** Every emit's argument list, in order. */
  readonly calls: BusEventMap[K][];
  /** The first argument of every emit; most events carry exactly one. */
  readonly values: BusEventMap[K][0][];
  /** The first argument of the latest emit, if any. */
  last(): BusEventMap[K][0] | undefined;
  /** Stop collecting. Only needed to stop partway through a test: the
   *  integration project's global afterEach removes every bus listener. */
  stop(): void;
}

/** Record every emit of `event` on the main-process bus from now on. */
export function captureBus<K extends keyof BusEventMap>(event: K): BusCapture<K> {
  const calls: BusEventMap[K][] = [];
  const listener = (...args: BusEventMap[K]) => {
    calls.push(args);
  };
  bus.on(event, listener);
  return {
    calls,
    get values() {
      return calls.map((args) => args[0]);
    },
    last: () => calls.at(-1)?.[0],
    stop: () => {
      bus.off(event, listener);
    },
  };
}

/** Record the name of every event emitted on the bus from now on, for
 *  asserting that a request broadcast nothing at all. Spies on `bus.emit`,
 *  which every `emit.*` looks up per call; the integration project's global
 *  afterEach restores it. 'log:entry' is left out: a log line is not a state
 *  broadcast. */
export function captureBusEvents(): { readonly names: Array<keyof BusEventMap> } {
  const spy = vi.spyOn(bus, 'emit');
  deferTeardown(() => spy.mockRestore());
  return {
    get names() {
      return spy.mock.calls.map((args) => args[0]).filter((name) => name !== 'log:entry');
    },
  };
}
