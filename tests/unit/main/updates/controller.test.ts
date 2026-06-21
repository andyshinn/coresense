import { describe, expect, it, vi } from 'vitest';
import { computeMode, createUpdateController } from '../../../../src/main/updates/controller';
import type { UpdateState } from '../../../../src/shared/types';

describe('computeMode', () => {
  it('is silent only for stable on macOS/Windows', () => {
    expect(computeMode('darwin', 'stable')).toBe('silent');
    expect(computeMode('win32', 'stable')).toBe('silent');
    expect(computeMode('linux', 'stable')).toBe('notify');
    expect(computeMode('darwin', 'development')).toBe('notify');
    expect(computeMode('linux', 'development')).toBe('notify');
  });
});

function harness(over: Partial<Parameters<typeof createUpdateController>[0]> = {}) {
  const silent = { ensureStarted: vi.fn(() => true), check: vi.fn(), installAndRestart: vi.fn() };
  const emitState = vi.fn();
  const openExternal = vi.fn();
  const checkNotify = vi.fn(
    async (channel, current): Promise<UpdateState> => ({
      status: 'available',
      mode: 'notify',
      channel,
      currentVersion: current,
      latestVersion: '9.9.9',
      releaseUrl: 'https://gh/rel',
    }),
  );
  let settings = { channel: 'stable' as const, autoCheck: true };
  const timers: Array<() => void> = [];
  const controller = createUpdateController({
    platform: 'darwin',
    currentVersion: '0.0.10',
    getSettings: () => settings,
    silent,
    checkNotify,
    openExternal,
    emitState,
    setInterval: (fn) => {
      timers.push(fn);
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: vi.fn(),
    ...over,
  });
  return { controller, silent, emitState, openExternal, checkNotify, setSettings: (s: typeof settings) => (settings = s) };
}

describe('createUpdateController', () => {
  it('silent check delegates to the silent updater', async () => {
    const { controller, silent } = harness();
    await controller.check();
    expect(silent.check).toHaveBeenCalledTimes(1);
    expect(controller.getState().mode).toBe('silent');
  });

  it('notify check uses checkNotify and stores the result', async () => {
    const { controller, checkNotify } = harness({ platform: 'linux' });
    const s = await controller.check();
    expect(checkNotify).toHaveBeenCalledWith('stable', '0.0.10');
    expect(s.status).toBe('available');
    expect(s.releaseUrl).toBe('https://gh/rel');
  });

  it('install opens the release URL in notify mode', async () => {
    const { controller, openExternal } = harness({ platform: 'linux' });
    await controller.check();
    controller.installAndRestart();
    expect(openExternal).toHaveBeenCalledWith('https://gh/rel');
  });

  it('install delegates to the silent updater in silent mode', async () => {
    const { controller, silent } = harness();
    await controller.check();
    controller.installAndRestart();
    expect(silent.installAndRestart).toHaveBeenCalledTimes(1);
  });

  it('emits state on every transition', async () => {
    const { controller, emitState } = harness({ platform: 'linux' });
    await controller.check();
    expect(emitState).toHaveBeenCalledWith(expect.objectContaining({ status: 'checking' }));
    expect(emitState).toHaveBeenCalledWith(expect.objectContaining({ status: 'available' }));
  });
});
