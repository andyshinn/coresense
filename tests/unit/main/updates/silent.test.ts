import { describe, expect, it, vi } from 'vitest';
import { createSilentUpdater } from '../../../../src/main/updates/silent';

function harness(over: Partial<Parameters<typeof createSilentUpdater>[0]> = {}) {
  const listeners: Record<string, (...a: unknown[]) => void> = {};
  const autoUpdater = {
    on: vi.fn((e: string, fn: (...a: unknown[]) => void) => {
      listeners[e] = fn;
    }),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  };
  const updateElectronApp = vi.fn();
  const onState = vi.fn();
  const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const silent = createSilentUpdater({
    autoUpdater,
    updateElectronApp,
    isPackaged: () => true,
    isMas: () => false,
    logger,
    onState,
    ...over,
  });
  return { silent, autoUpdater, updateElectronApp, onState, listeners, logger };
}

describe('createSilentUpdater', () => {
  it('does not start when unpackaged', () => {
    const { silent, updateElectronApp } = harness({ isPackaged: () => false });
    expect(silent.ensureStarted()).toBe(false);
    expect(updateElectronApp).not.toHaveBeenCalled();
  });

  it('does not start on Mac App Store builds', () => {
    const { silent, updateElectronApp } = harness({ isMas: () => true });
    expect(silent.ensureStarted()).toBe(false);
    expect(updateElectronApp).not.toHaveBeenCalled();
  });

  it('starts update-electron-app once and is idempotent', () => {
    const { silent, updateElectronApp } = harness();
    expect(silent.ensureStarted()).toBe(true);
    expect(silent.ensureStarted()).toBe(true);
    expect(updateElectronApp).toHaveBeenCalledTimes(1);
    expect(updateElectronApp).toHaveBeenCalledWith(expect.objectContaining({ updateInterval: '1 hour', notifyUser: true }));
  });

  // update-electron-app replaces `console` with the logger it is given and
  // calls logger.log() during init; a logger without it made init throw, so the
  // silent updater never started (issue #55).
  it('hands update-electron-app a logger with a log() function', () => {
    const { silent, updateElectronApp, logger } = harness();
    silent.ensureStarted();
    const opts = updateElectronApp.mock.calls[0][0];
    expect(opts.logger).toBe(logger);
    expect(typeof opts.logger.log).toBe('function');
  });

  it('does not stack duplicate autoUpdater listeners when init fails and is retried', () => {
    const updateElectronApp = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new TypeError('logger.log is not a function');
      })
      .mockImplementation(() => undefined);
    const { silent, autoUpdater } = harness({ updateElectronApp });
    expect(silent.ensureStarted()).toBe(false);
    const perAttach = autoUpdater.on.mock.calls.length;
    expect(perAttach).toBeGreaterThan(0);
    expect(silent.ensureStarted()).toBe(true);
    expect(autoUpdater.on).toHaveBeenCalledTimes(perAttach);
    expect(updateElectronApp).toHaveBeenCalledTimes(2);
  });

  it('mirrors autoUpdater events into onState', () => {
    const { silent, onState, listeners } = harness();
    silent.ensureStarted();
    listeners['checking-for-update']();
    listeners['update-available']();
    listeners['update-downloaded']();
    listeners['update-not-available']();
    listeners.error(new Error('boom'));
    expect(onState).toHaveBeenCalledWith({ status: 'checking' });
    expect(onState).toHaveBeenCalledWith({ status: 'downloading' });
    expect(onState).toHaveBeenCalledWith({ status: 'downloaded' });
    expect(onState).toHaveBeenCalledWith({ status: 'up-to-date' });
    expect(onState).toHaveBeenCalledWith({ status: 'error', error: 'boom' });
  });

  it('reports the message of a non-Error object the autoUpdater emits', () => {
    const { silent, onState, listeners } = harness();
    silent.ensureStarted();
    // String() of this used to give "[object Object]".
    listeners.error({ message: 'feed unreachable' });
    expect(onState).toHaveBeenCalledWith({ status: 'error', error: 'feed unreachable' });
  });

  it('check() starts, returns true, and calls checkForUpdates; install calls quitAndInstall', () => {
    const { silent, autoUpdater } = harness();
    expect(silent.check()).toBe(true);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    silent.installAndRestart();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('check() returns false and does not dispatch when the updater cannot start (e.g. dev build)', () => {
    const { silent, autoUpdater } = harness({ isPackaged: () => false });
    expect(silent.check()).toBe(false);
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});
