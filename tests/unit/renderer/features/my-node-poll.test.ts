import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyPollError,
  createPoller,
  POLL_WARN_AFTER,
  type Poller,
  type PollState,
  SELF_POLL_MS,
} from '../../../../src/renderer/features/my-node/poll';
import { ApiError } from '../../../../src/renderer/lib/api';
import type { SelfLiveReadDto } from '../../../../src/shared/telemetry/types';
import type { DeviceStats } from '../../../../src/shared/types';

const READ: SelfLiveReadDto = { at: 1, rawHex: '017401a1', readings: [] };
const STATS = { at: 1 } as DeviceStats;

const BUSY = () => new ApiError('busy', 409, 'busy_skip');
const UNSUPPORTED = () => new ApiError('no', 501, 'self_telemetry_unsupported');

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let readTelemetry: ReturnType<typeof vi.fn<() => Promise<SelfLiveReadDto>>>;
let readStats: ReturnType<typeof vi.fn<() => Promise<DeviceStats>>>;
let states: PollState[];
let poller: Poller;

const ALL_ON = { mounted: true, visible: true, connected: true };

function make(intervalMs = SELF_POLL_MS) {
  poller = createPoller({ readTelemetry, readStats, onChange: (s) => states.push(s), intervalMs });
  return poller;
}

const last = () => states[states.length - 1];

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  readTelemetry = vi.fn(async () => READ);
  readStats = vi.fn(async () => STATS);
  states = [];
});

afterEach(() => {
  poller?.dispose();
  vi.useRealTimers();
});

describe('poller lifecycle', () => {
  it('reads nothing until mounted, visible and connected', async () => {
    make();
    poller.setConditions({ mounted: true, visible: true });
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS * 3);
    expect(readTelemetry).not.toHaveBeenCalled();

    poller.setConditions({ connected: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(readTelemetry).toHaveBeenCalledTimes(1);
    expect(readStats).toHaveBeenCalledTimes(1);
    expect(last().running).toBe(true);
  });

  it('reads immediately, then once per interval', async () => {
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(0);
    expect(readTelemetry).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SELF_POLL_MS - 1);
    expect(readTelemetry).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(readTelemetry).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS * 2);
    expect(readTelemetry).toHaveBeenCalledTimes(4);
  });

  it('stops when the window is hidden and resumes with an immediate read', async () => {
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(0);

    poller.setConditions({ visible: false });
    expect(last().running).toBe(false);
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS * 5);
    expect(readTelemetry).toHaveBeenCalledTimes(1);

    poller.setConditions({ visible: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(readTelemetry).toHaveBeenCalledTimes(2);
  });

  it('stops on disconnect and on unmount', async () => {
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(0);
    poller.setConditions({ connected: false });
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS * 3);
    expect(readTelemetry).toHaveBeenCalledTimes(1);

    poller.setConditions({ connected: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(readTelemetry).toHaveBeenCalledTimes(2);
    poller.setConditions({ mounted: false });
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS * 3);
    expect(readTelemetry).toHaveBeenCalledTimes(2);
  });

  it('never runs again after dispose', async () => {
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(0);
    poller.dispose();
    poller.setConditions({ visible: false });
    poller.setConditions({ visible: true });
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS * 3);
    expect(readTelemetry).toHaveBeenCalledTimes(1);
  });
});

describe('poller pacing', () => {
  it('never overlaps a slow read, and schedules the next from its end', async () => {
    const slow = deferred<SelfLiveReadDto>();
    readTelemetry.mockImplementationOnce(() => slow.promise);
    make();
    poller.setConditions(ALL_ON);

    await vi.advanceTimersByTimeAsync(SELF_POLL_MS * 3);
    expect(readTelemetry).toHaveBeenCalledTimes(1);

    slow.resolve(READ);
    await vi.advanceTimersByTimeAsync(0);
    expect(readStats).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS - 1);
    expect(readTelemetry).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(readTelemetry).toHaveBeenCalledTimes(2);
  });

  it('awaits telemetry before asking for stats: one poll frame at a time', async () => {
    const pending = deferred<SelfLiveReadDto>();
    readTelemetry.mockImplementationOnce(() => pending.promise);
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(0);
    expect(readStats).not.toHaveBeenCalled();

    pending.resolve(READ);
    await vi.advanceTimersByTimeAsync(0);
    expect(readStats).toHaveBeenCalledTimes(1);
  });

  it('keeps one read in flight when restarted while a tick is still settling', async () => {
    const pending = deferred<SelfLiveReadDto>();
    readTelemetry.mockImplementationOnce(() => pending.promise);
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(0);

    poller.setConditions({ visible: false });
    poller.setConditions({ visible: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(readTelemetry).toHaveBeenCalledTimes(1);

    // The stale tick ends, its result is discarded, and the restart's
    // immediate read runs straight after it.
    pending.resolve({ ...READ, rawHex: 'stale' });
    await vi.advanceTimersByTimeAsync(0);
    expect(readTelemetry).toHaveBeenCalledTimes(2);
    expect(states.some((s) => s.telemetry.value?.rawHex === 'stale')).toBe(false);
  });

  it('discards a read that straddles a stop', async () => {
    const pending = deferred<SelfLiveReadDto>();
    readTelemetry.mockImplementationOnce(() => pending.promise);
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(0);

    poller.setConditions({ connected: false });
    pending.resolve(READ);
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS);

    expect(last().telemetry.value).toBeNull();
    expect(readStats).not.toHaveBeenCalled();
  });
});

describe('poller outcomes', () => {
  it('records each stream with its time', async () => {
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(0);

    expect(last().telemetry).toMatchObject({ value: READ, updatedAt: 1_000_000, failures: 0, warn: false });
    expect(last().stats).toMatchObject({ value: STATS, updatedAt: 1_000_000 });
  });

  it('skips the rest of the tick on busy_skip without counting a failure or moving "Updated"', async () => {
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(0);
    const updatedAt = last().telemetry.updatedAt;

    readTelemetry.mockRejectedValueOnce(BUSY());
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS);

    expect(readStats).toHaveBeenCalledTimes(1);
    expect(last().telemetry).toMatchObject({ failures: 0, warn: false, updatedAt });

    // And it simply tries again next tick.
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS);
    expect(readStats).toHaveBeenCalledTimes(2);
  });

  it('stops only the unsupported stream', async () => {
    readTelemetry.mockRejectedValue(UNSUPPORTED());
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS * 2);

    expect(readTelemetry).toHaveBeenCalledTimes(1);
    expect(readStats).toHaveBeenCalledTimes(3);
    expect(last().telemetry.supported).toBe(false);
    expect(last().stats.supported).toBe(true);
  });

  it('asks again after a reconnect, which may be a different radio', async () => {
    readTelemetry.mockRejectedValueOnce(UNSUPPORTED());
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(0);
    expect(last().telemetry.supported).toBe(false);

    poller.setConditions({ connected: false });
    poller.setConditions({ connected: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(readTelemetry).toHaveBeenCalledTimes(2);
    expect(last().telemetry.supported).toBe(true);
  });

  it(`warns after ${POLL_WARN_AFTER} consecutive failures and clears on success`, async () => {
    readTelemetry.mockRejectedValue(new Error('timed out'));
    make();
    poller.setConditions(ALL_ON);
    await vi.advanceTimersByTimeAsync(0);
    expect(last().telemetry).toMatchObject({ failures: 1, warn: false, error: 'timed out' });

    await vi.advanceTimersByTimeAsync(SELF_POLL_MS * (POLL_WARN_AFTER - 1));
    expect(last().telemetry).toMatchObject({ failures: POLL_WARN_AFTER, warn: true });
    // A failing stream doesn't stop the other one.
    expect(readStats).toHaveBeenCalledTimes(POLL_WARN_AFTER);

    readTelemetry.mockResolvedValue(READ);
    await vi.advanceTimersByTimeAsync(SELF_POLL_MS);
    expect(last().telemetry).toMatchObject({ failures: 0, warn: false, error: null, value: READ });
  });
});

describe('classifyPollError', () => {
  it('sorts the server answers', () => {
    expect(classifyPollError(BUSY())).toBe('busy');
    expect(classifyPollError(new ApiError('x', 501, 'stats_unsupported'))).toBe('unsupported');
    expect(classifyPollError(new ApiError('x', 409, 'radio_busy'))).toBe('failed');
    expect(classifyPollError(new ApiError('x', 503, null))).toBe('failed');
    expect(classifyPollError(new Error('network'))).toBe('failed');
  });
});
