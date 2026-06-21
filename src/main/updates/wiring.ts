import { app, autoUpdater, shell } from 'electron';
import { updateElectronApp } from 'update-electron-app';
import { APP_VERSION } from '../build-info';
import { bus, emit } from '../events/bus';
import { child } from '../log';
import { stateHolder } from '../state/holder';
import { createUpdateController, setUpdatesController, type UpdateController } from './controller';
import { checkNotify } from './notify';
import { createSilentUpdater } from './silent';

// Composition root: the ONLY module that imports electron / update-electron-app
// for the updater. Everything it wires is dependency-injected and unit-tested.
export function startUpdates(): void {
  const log = child('updates');
  let controllerRef: UpdateController | null = null;

  const silent = createSilentUpdater({
    autoUpdater: autoUpdater as unknown as Parameters<typeof createSilentUpdater>[0]['autoUpdater'],
    updateElectronApp: updateElectronApp as unknown as Parameters<typeof createSilentUpdater>[0]['updateElectronApp'],
    isPackaged: () => app.isPackaged,
    isMas: () => Boolean(process.mas),
    logger: { info: (m) => log.info(m), warn: (m) => log.warn(m), error: (m) => log.error(m) },
    onState: (p) => controllerRef?.onSilentState(p),
  });

  const controller = createUpdateController({
    platform: process.platform,
    currentVersion: APP_VERSION,
    getSettings: () => stateHolder().getAppSettings().updates,
    silent,
    checkNotify: (channel, current) => checkNotify(channel, current, { fetch: globalThis.fetch, now: () => Date.now() }),
    openExternal: (url) => void shell.openExternal(url),
    emitState: (s) => emit.updateState(s),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h),
  });

  controllerRef = controller;
  setUpdatesController(controller);
  bus.on('appSettings', () => controller.onSettingsChanged());
  controller.start();
}
