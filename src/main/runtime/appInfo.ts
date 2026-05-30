// Injectable wrapper over the Electron app metadata used outside path/lifecycle
// concerns: app.isPackaged and app.getAppPath(). Production wires real electron
// values in index.ts; tests inject doubles. No 'electron' import here.
export interface AppInfo {
  isPackaged: boolean;
  appPath: string;
}

let injected: AppInfo | null = null;

export function setAppInfo(info: AppInfo | null): void {
  injected = info;
}

function get(): AppInfo {
  if (!injected) {
    throw new Error('appInfo not set — call setAppInfo() during bootstrap (index.ts)');
  }
  return injected;
}

export function isPackaged(): boolean {
  return get().isPackaged;
}

export function appPath(): string {
  return get().appPath;
}
