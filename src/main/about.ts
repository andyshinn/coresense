import { app, type BrowserWindow, dialog } from 'electron';
import { APP_VERSION, GIT_SHA } from './build-info';

const COPYRIGHT = `Copyright © ${new Date().getFullYear()} Andy Shinn`;
const WEBSITE = 'https://github.com/andyshinn/coresense';

// Set once at boot. macOS shows this when the user picks `app.name > About …`,
// and Linux (GTK builds) shows it from `Help > About` when the menu role is
// `about`. Windows has no native About panel; `dialog.showMessageBox` below
// covers that case (see showAboutDialog).
export function applyAboutPanel(): void {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return;
  app.setAboutPanelOptions({
    applicationName: app.name,
    applicationVersion: APP_VERSION,
    version: GIT_SHA, // macOS labels this "Build" under the version number
    copyright: COPYRIGHT,
    website: WEBSITE,
  });
}

// Custom About dialog for Windows and as a Help-menu entry on all platforms
// (macOS's app menu already has the native panel via applyAboutPanel).
export function showAboutDialog(parent?: BrowserWindow | null): void {
  const detail = [
    `Version ${APP_VERSION} (${GIT_SHA})`,
    `Electron ${process.versions.electron ?? 'unknown'}`,
    `Chromium ${process.versions.chrome ?? 'unknown'}`,
    `${process.platform} ${process.arch}`,
    '',
    COPYRIGHT,
    WEBSITE,
  ].join('\n');
  const opts = {
    type: 'info' as const,
    title: `About ${app.name}`,
    message: app.name,
    detail,
    buttons: ['OK'],
    defaultId: 0,
  };
  if (parent) {
    void dialog.showMessageBox(parent, opts);
  } else {
    void dialog.showMessageBox(opts);
  }
}
