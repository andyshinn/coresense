import type { UpdateState } from '../../shared/types';

export interface AutoUpdaterLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
}

export interface SilentDeps {
  autoUpdater: AutoUpdaterLike;
  updateElectronApp: (opts: { updateInterval?: string; notifyUser?: boolean; logger?: unknown }) => void;
  isPackaged: () => boolean;
  isMas: () => boolean;
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  onState: (partial: Partial<UpdateState>) => void;
}

/**
 * Thin layer over update-electron-app. It owns the feed/download/poll and the
 * native restart dialog (notifyUser: true). We only add read-only status
 * listeners and a quitAndInstall() for the in-app Popover restart action.
 */
export function createSilentUpdater(deps: SilentDeps) {
  let started = false;

  function attachListeners(): void {
    deps.autoUpdater.on('checking-for-update', () => deps.onState({ status: 'checking' }));
    deps.autoUpdater.on('update-available', () => deps.onState({ status: 'downloading' }));
    deps.autoUpdater.on('update-not-available', () => deps.onState({ status: 'up-to-date' }));
    deps.autoUpdater.on('update-downloaded', () => deps.onState({ status: 'downloaded' }));
    deps.autoUpdater.on('error', (...args: unknown[]) => {
      const err = args[0];
      deps.onState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    });
  }

  function ensureStarted(): boolean {
    if (started) return true;
    if (!deps.isPackaged() || deps.isMas()) return false;
    try {
      attachListeners();
      deps.updateElectronApp({ updateInterval: '1 hour', notifyUser: true, logger: deps.logger });
      started = true;
    } catch (err) {
      deps.logger.warn(`silent updater init failed: ${(err as Error).message}`);
      return false;
    }
    return true;
  }

  return {
    ensureStarted,
    check(): void {
      if (ensureStarted()) deps.autoUpdater.checkForUpdates();
    },
    installAndRestart(): void {
      deps.autoUpdater.quitAndInstall();
    },
    isStarted: (): boolean => started,
  };
}
