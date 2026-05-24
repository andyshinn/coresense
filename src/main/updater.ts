import { app } from 'electron';
import { updateElectronApp } from 'update-electron-app';
import { child } from './log';

const log = child('updater');

// Wires the renderer-less side of Electron's autoUpdater against the free
// update.electronjs.org service, which reads from the GitHub Releases of the
// repository configured in forge.config.ts (PublisherGithub). No additional
// server to operate.
//
// Constraint: Electron's autoUpdater only works on packaged, code-signed
// builds — macOS signing is wired via packagerConfig.osxSign in
// forge.config.ts; Windows signing is opt-in via WINDOWS_SIGN=1. Until the
// first signed Release exists, the service returns 404 and this is a quiet
// no-op rather than an error.
export function startUpdater(): void {
  if (!app.isPackaged) return;
  if (process.mas) return; // Mac App Store builds use the store's update path.
  try {
    updateElectronApp({
      updateInterval: '1 hour',
      logger: {
        log: (m: string) => log.info(m),
        info: (m: string) => log.info(m),
        warn: (m: string) => log.warn(m),
        error: (m: string) => log.error(m),
      },
    });
  } catch (err) {
    log.warn(`init failed: ${(err as Error).message}`);
  }
}
