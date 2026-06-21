import { describe, expect, it, vi } from 'vitest';
import { createSilentUpdater } from '../../../../src/main/updates/silent';

function harness(over: Partial<Parameters<typeof createSilentUpdater>[0]> = {}) {
  const listeners: Record<string, (...a: unknown[]) => void> = {};
  const autoUpdater = {
    on: (e: string, fn: (...a: unknown[]) => void) => {
      listeners[e] = fn;
    },
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  };
  const updateElectronApp = vi.fn();
  const onState = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const silent = createSilentUpdater({
    autoUpdater,
    updateElectronApp,
    isPackaged: () => true,
    isMas: () => false,
    logger,
    onState,
    ...over,
  });
  return { silent, autoUpdater, updateElectronApp, onState, listeners };
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

  it('check() starts then calls checkForUpdates; install calls quitAndInstall', () => {
    const { silent, autoUpdater } = harness();
    silent.check();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    silent.installAndRestart();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
