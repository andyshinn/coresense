import { app, autoUpdater } from 'electron';
import { updateElectronApp } from 'update-electron-app';
import { APP_VERSION } from '../build-info';
import { bus, emit } from '../events/bus';
import { child } from '../log';
import { openExternal } from '../runtime/shell';
import { stateHolder } from '../state/holder';
import { createUpdateController, setUpdatesController, type UpdateController, type UpdatesLogger } from './controller';
import { checkNotify } from './notify';
import { createSilentUpdater } from './silent';

// Composition root: the ONLY module that imports electron / update-electron-app
// for the updater. Everything it wires is dependency-injected and unit-tested.
export function startUpdates(): void {
  const log = child('updates');
  // update-electron-app swaps this in for `console` and calls `log()` (with
  // several args) during init; without it init threw and the silent updater
  // never started (issue #55). Its chatter goes to debug.
  const logger: UpdatesLogger = {
    log: (...args: unknown[]) => log.debug(...args),
    info: (m) => log.info(m),
    warn: (m) => log.warn(m),
    error: (m) => log.error(m),
  };
  let controllerRef: UpdateController | null = null;

  const silent = createSilentUpdater({
    autoUpdater,
    updateElectronApp,
    isPackaged: () => app.isPackaged,
    isMas: () => Boolean(process.mas),
    logger,
    onState: (p) => controllerRef?.onSilentState(p),
  });

  const controller = createUpdateController({
    platform: process.platform,
    currentVersion: APP_VERSION,
    getSettings: () => stateHolder().getAppSettings().updates,
    silent,
    checkNotify: (channel, current) => checkNotify(channel, current, { fetch: globalThis.fetch, now: () => Date.now() }),
    openExternal,
    emitState: (s) => emit.updateState(s),
    logger,
  });

  controllerRef = controller;
  setUpdatesController(controller);
  bus.on('appSettings', () => controller.onSettingsChanged());
  controller.start();
}
