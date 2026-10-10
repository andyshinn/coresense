import { type BusEventMap, bus } from '../../src/main/events/bus';

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
