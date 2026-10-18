// Wire production implementations of the injectable seams. index.ts imports
// this as its second side-effect import, right after
// src/main/runtime/devUserDataRedirect.ts, and ES modules evaluate in import
// order: the dev userData redirect has applied before this runs, and this runs
// before any module index.ts imports after it is evaluated. Modules this file itself
// imports are evaluated earlier, so they must still read the seams lazily.
import { app, safeStorage } from 'electron';
import { setTileCacheOpener } from '../map/tile-cache';
import { setAppInfo } from '../runtime/appInfo';
import { setAppLifecycle } from '../runtime/appLifecycle';
import { setSecretStore } from '../runtime/secretStore';
import { revealPath } from '../runtime/shell';
import { setUserDataDir } from '../runtime/userData';

setAppInfo({ isPackaged: app.isPackaged, appPath: app.getAppPath() });
setUserDataDir(app.getPath('userData'));
setAppLifecycle({
  quit: () => app.quit(),
  relaunch: () => app.relaunch(),
});
setSecretStore({
  available: () => safeStorage.isEncryptionAvailable(),
  encryptString: (s) => safeStorage.encryptString(s),
  decryptString: (b) => safeStorage.decryptString(b),
});
setTileCacheOpener((dir) => {
  void revealPath(dir);
});
