import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../../../../src/main/util/async';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1_000, 'step')).resolves.toBe(42);
  });

  it('passes a rejection through unchanged', async () => {
    const err = new Error('boom');
    await expect(withTimeout(Promise.reject(err), 1_000, 'step')).rejects.toBe(err);
  });

  it('rejects with a labelled error once the deadline passes', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise<never>(() => {}), 500, 'peripheral.connect');
    const assertion = expect(p).rejects.toThrow('peripheral.connect timed out after 500ms');
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('clears its timer when the promise settles first', async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.resolve('ok'), 500, 'step');
    expect(vi.getTimerCount()).toBe(0);
  });
});
