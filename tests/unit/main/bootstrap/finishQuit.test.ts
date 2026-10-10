import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishQuit } from '../../../../src/main/bootstrap/finishQuit';

afterEach(() => {
  vi.useRealTimers();
});

function harness(overrides: { shutdown?: () => Promise<void>; flushLog?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const deps = {
    shutdown: overrides.shutdown ?? vi.fn(async () => void calls.push('shutdown')),
    onShutdownError: vi.fn((err: unknown) => void calls.push(`error:${(err as Error).message}`)),
    flushLog: overrides.flushLog ?? vi.fn(async () => void calls.push('flush')),
    flushTimeoutMs: 1000,
    exit: vi.fn(() => void calls.push('exit')),
  };
  return { deps, calls };
}

describe('finishQuit', () => {
  it('shuts down, then flushes the log, then exits', async () => {
    const { deps, calls } = harness();
    await finishQuit(deps);
    expect(calls).toEqual(['shutdown', 'flush', 'exit']);
  });

  it('logs a failed shutdown, still flushes after it, and still exits', async () => {
    const { deps, calls } = harness({
      shutdown: async () => {
        throw new Error('ble stuck');
      },
    });
    await finishQuit(deps);
    expect(calls).toEqual(['error:ble stuck', 'flush', 'exit']);
  });

  it('exits once the flush timeout passes when the log write stalls', async () => {
    vi.useFakeTimers();
    const { deps } = harness({ flushLog: () => new Promise<void>(() => {}) });
    const done = finishQuit(deps);
    await vi.advanceTimersByTimeAsync(999);
    expect(deps.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });
});
