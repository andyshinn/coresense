// Minimal stub of the `electron` module for integration tests running in a
// plain Node environment (no Electron host process). Only exports the subset
// consumed by the code paths under test.
export const app = {
  isPackaged: false,
  getPath: (_name: string) => '/tmp/coresense-stub',
  setPath: (_name: string, _value: string) => {},
};

export const ipcMain = {
  on: () => {},
  handle: () => {},
  removeHandler: () => {},
};

export const shell = {
  openExternal: async (_url: string) => {},
};

export const BrowserWindow = class {};
export const Notification = class {};
export const Menu = {
  buildFromTemplate: () => ({ popup: () => {} }),
  setApplicationMenu: () => {},
};
export const screen = {
  getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
};
export const dialog = {};
export const safeStorage = { isEncryptionAvailable: () => false };
