import type { BrowserWindow } from 'electron';

// Single-window registry so subsystems (notifications, badge, etc.) can
// reach the renderer without index.ts having to plumb the BrowserWindow
// through every initializer. v1 is single-window; if multi-window lands,
// this becomes a Set keyed by display.
let _mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  _mainWindow = win;
  if (win) {
    win.on('closed', () => {
      if (_mainWindow === win) _mainWindow = null;
    });
  }
}

export function getMainWindow(): BrowserWindow | null {
  return _mainWindow;
}

export function isMainWindowFocused(): boolean {
  return _mainWindow?.isFocused() ?? false;
}
