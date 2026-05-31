import { afterEach, beforeEach } from 'vitest';
import { bus } from '../../src/main/events/bus';
import { setAppInfo } from '../../src/main/runtime/appInfo';
import { setAppLifecycle } from '../../src/main/runtime/appLifecycle';
import { setSecretStore } from '../../src/main/runtime/secretStore';
import { flushSettings } from '../../src/main/storage/settings';
import { transportManager } from '../../src/main/transport/manager';
import { memorySecretStore, spyLifecycle } from '../support/seams';
import { cleanupTempUserData, useTempUserData } from '../support/sqlite-temp';

beforeEach(() => {
  useTempUserData();
  setAppInfo({ isPackaged: false, appPath: process.cwd() });
  setAppLifecycle(spyLifecycle());
  setSecretStore(memorySecretStore());
});

afterEach(async () => {
  bus.removeAllListeners();
  transportManager.clearTransport();
  // Drain fire-and-forget settings writes before removing the temp dir, so a
  // pending channels.json/map-settings.json write can't race the cleanup and
  // log a spurious ENOENT.
  await flushSettings();
  cleanupTempUserData();
  setAppInfo(null);
  setAppLifecycle(null);
  setSecretStore(null);
});
