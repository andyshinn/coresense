// My Node's live poll: the companion's own telemetry and its local stats,
// read on an interval while the page can be seen.
//
// Pure: no React, no DOM, no fetch. The fetchers, the clock and the timer are
// injected, so the lifecycle is unit-tested with fake timers and useNodePoll
// binds it to the page.
//
// Rules (plan: "Sharing the BLE link with user commands"):
// - Runs only while the page is mounted, the window is visible and a radio is
//   connected. Losing any of them stops it; regaining all three starts it
//   again with an immediate read.
// - One tick at a time. The next tick is scheduled from the END of the
//   previous one, so a slow read never overlaps the next.
// - Within a tick, telemetry then stats, each awaited before the next, so at
//   most one poll frame is on the link and a user frame can slot in between.
// - A `busy_skip` answer (a user command was in flight) skips the rest of the
//   tick. It is not a failure and leaves "Updated N s ago" as it was.
// - An "unsupported" answer stops that stream only, for as long as the poller
//   lives. A transient failure keeps polling; three in a row raise `warn`.

import type { SelfLiveReadDto } from '../../../shared/telemetry/types';
import type { DeviceStats } from '../../../shared/types';
import { ApiError } from '../../lib/api';

/** Default poll interval. Fixed for now (plan, open question 4). */
export const SELF_POLL_MS = 10_000;

/** Consecutive failures before a stream reports `warn`. */
export const POLL_WARN_AFTER = 3;

export type PollOutcome = 'busy' | 'unsupported' | 'failed';

/** How a rejected fetch should be treated. */
export function classifyPollError(err: unknown): PollOutcome {
  if (err instanceof ApiError) {
    if (err.status === 409 && err.code === 'busy_skip') return 'busy';
    if (err.status === 501) return 'unsupported';
  }
  return 'failed';
}

export interface StreamState<T> {
  value: T | null;
  /** Epoch ms of the last successful read; null before the first. */
  updatedAt: number | null;
  supported: boolean;
  /** Consecutive failures since the last success. */
  failures: number;
  /** POLL_WARN_AFTER or more consecutive failures. */
  warn: boolean;
  /** The latest failure's message, cleared by a success. */
  error: string | null;
}

export interface PollState {
  running: boolean;
  telemetry: StreamState<SelfLiveReadDto>;
  stats: StreamState<DeviceStats>;
}

export interface PollConditions {
  mounted: boolean;
  visible: boolean;
  connected: boolean;
}

export interface PollerOptions {
  readTelemetry: () => Promise<SelfLiveReadDto>;
  readStats: () => Promise<DeviceStats>;
  onChange: (state: PollState) => void;
  intervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  classify?: (err: unknown) => PollOutcome;
}

export interface Poller {
  /** Report the page/window/link conditions; starts or stops the poll. */
  setConditions(next: Partial<PollConditions>): void;
  /** Stop for good (unmount). */
  dispose(): void;
  getState(): PollState;
}

function emptyStream<T>(): StreamState<T> {
  return { value: null, updatedAt: null, supported: true, failures: 0, warn: false, error: null };
}

export function initialPollState(): PollState {
  return { running: false, telemetry: emptyStream(), stats: emptyStream() };
}

export function createPoller(opts: PollerOptions): Poller {
  const intervalMs = opts.intervalMs ?? SELF_POLL_MS;
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const classify = opts.classify ?? classifyPollError;

  let conditions: PollConditions = { mounted: false, visible: false, connected: false };
  let state = initialPollState();
  let timer: unknown = null;
  let ticking = false;
  /** Bumped on every stop, so a tick that straddles one is discarded. */
  let generation = 0;
  let disposed = false;

  const runnable = () => !disposed && conditions.mounted && conditions.visible && conditions.connected;

  const publish = (next: PollState) => {
    state = next;
    opts.onChange(state);
  };

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const schedule = () => {
    cancelTimer();
    if (!runnable()) return;
    timer = setTimer(() => {
      timer = null;
      void tick();
    }, intervalMs);
  };

  /** One stream read. Returns false when the tick should end here. */
  async function read<K extends 'telemetry' | 'stats'>(
    key: K,
    fetch: () => Promise<NonNullable<PollState[K]['value']>>,
    gen: number,
  ): Promise<boolean> {
    if (!state[key].supported) return true;
    try {
      const value = await fetch();
      if (gen !== generation) return false;
      publish({
        ...state,
        [key]: { value, updatedAt: now(), supported: true, failures: 0, warn: false, error: null },
      });
      return true;
    } catch (err) {
      if (gen !== generation) return false;
      const outcome = classify(err);
      if (outcome === 'busy') return false;
      const prev = state[key];
      const message = err instanceof Error ? err.message : String(err);
      if (outcome === 'unsupported') {
        publish({ ...state, [key]: { ...prev, supported: false, error: message } });
        return true;
      }
      const failures = prev.failures + 1;
      publish({ ...state, [key]: { ...prev, failures, warn: failures >= POLL_WARN_AFTER, error: message } });
      return true;
    }
  }

  async function tick(): Promise<void> {
    if (ticking || !runnable()) return;
    ticking = true;
    const gen = generation;
    try {
      if (await read('telemetry', opts.readTelemetry, gen)) {
        await read('stats', opts.readStats, gen);
      }
    } finally {
      ticking = false;
      if (gen === generation) schedule();
      // A stop during the tick bumped the generation. If the poll was started
      // again meanwhile, that start is waiting on this tick (one poll frame on
      // the link at a time) and wants its immediate read now.
      else if (runnable()) void tick();
    }
  }

  const start = () => {
    publish({ ...state, running: true });
    // A tick still settling from before the stop runs this one when it ends.
    if (!ticking) void tick();
  };

  const stop = () => {
    generation++;
    cancelTimer();
    if (state.running) publish({ ...state, running: false });
  };

  return {
    setConditions(next) {
      const was = runnable();
      const reconnected = next.connected === true && !conditions.connected;
      conditions = { ...conditions, ...next };
      if (reconnected) {
        // Possibly a different radio: what the last one couldn't do, this one
        // may, and old failures say nothing about it.
        state = {
          ...state,
          telemetry: { ...state.telemetry, supported: true, failures: 0, warn: false },
          stats: { ...state.stats, supported: true, failures: 0, warn: false },
        };
      }
      const is = runnable();
      if (is && !was) start();
      else if (!is && was) stop();
    },
    dispose() {
      stop();
      disposed = true;
    },
    getState: () => state,
  };
}
