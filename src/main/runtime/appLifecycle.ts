// Injectable wrapper over the Electron app lifecycle calls used by api/routes.
// Production wires real electron.app methods in bootstrap/seams.ts; tests inject spies.
export interface AppLifecycle {
  quit(): void;
  relaunch(): void;
}

let injected: AppLifecycle | null = null;

export function setAppLifecycle(impl: AppLifecycle | null): void {
  injected = impl;
}

export function appLifecycle(): AppLifecycle {
  if (!injected) {
    throw new Error('appLifecycle not set — call setAppLifecycle() during bootstrap (bootstrap/seams.ts)');
  }
  return injected;
}
