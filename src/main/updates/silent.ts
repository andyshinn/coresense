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
    deps.autoUpdater.on('checking-for-update', () => {
      deps.logger.info('silent: checking-for-update');
      deps.onState({ status: 'checking' });
    });
    deps.autoUpdater.on('update-available', () => {
      deps.logger.info('silent: update-available (downloading)');
      deps.onState({ status: 'downloading' });
    });
    deps.autoUpdater.on('update-not-available', () => {
      deps.logger.info('silent: update-not-available (up to date)');
      deps.onState({ status: 'up-to-date' });
    });
    deps.autoUpdater.on('update-downloaded', () => {
      deps.logger.info('silent: update-downloaded (ready to install)');
      deps.onState({ status: 'downloaded' });
    });
    deps.autoUpdater.on('error', (...args: unknown[]) => {
      const err = args[0];
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.error(`silent: autoUpdater error: ${message}`);
      deps.onState({ status: 'error', error: message });
    });
  }

  function ensureStarted(): boolean {
    if (started) return true;
    if (!deps.isPackaged() || deps.isMas()) {
      deps.logger.info(
        `silent: not starting (packaged=${deps.isPackaged()}, mas=${deps.isMas()}) — auto-update runs only in packaged, non-MAS builds`,
      );
      return false;
    }
    try {
      attachListeners();
      deps.updateElectronApp({ updateInterval: '1 hour', notifyUser: true, logger: deps.logger });
      started = true;
      deps.logger.info('silent: update-electron-app started (1h interval, native restart prompt)');
    } catch (err) {
      deps.logger.warn(`silent: update-electron-app init failed: ${(err as Error).message}`);
      return false;
    }
    return true;
  }

  return {
    ensureStarted,
    /** Returns true if a check was actually dispatched, false if the silent
     *  updater could not run (unpackaged / MAS / init failure). A false result
     *  lets the controller settle on a terminal state instead of spinning on
     *  'checking' forever (e.g. in a `pnpm start` dev build). */
    check(): boolean {
      if (!ensureStarted()) {
        deps.logger.info('silent: check skipped — updater not started');
        return false;
      }
      deps.logger.info('silent: dispatching checkForUpdates');
      deps.autoUpdater.checkForUpdates();
      return true;
    },
    installAndRestart(): void {
      deps.logger.info('silent: quitAndInstall');
      deps.autoUpdater.quitAndInstall();
    },
    isStarted: (): boolean => started,
  };
}
