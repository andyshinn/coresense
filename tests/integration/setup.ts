import { afterEach, beforeEach } from 'vitest';
import { bus } from '../../src/main/events/bus';
import { setAppInfo } from '../../src/main/runtime/appInfo';
import { setAppLifecycle } from '../../src/main/runtime/appLifecycle';
import { setSecretStore } from '../../src/main/runtime/secretStore';
import { transportManager } from '../../src/main/transport/manager';
import { memorySecretStore, spyLifecycle } from '../support/seams';
import { cleanupTempUserData, useTempUserData } from '../support/sqlite-temp';

beforeEach(() => {
  useTempUserData();
  setAppInfo({ isPackaged: false, appPath: process.cwd() });
  setAppLifecycle(spyLifecycle());
  setSecretStore(memorySecretStore());
});

afterEach(() => {
  bus.removeAllListeners();
  transportManager.clearTransport();
  cleanupTempUserData();
  setAppInfo(null);
  setAppLifecycle(null);
  setSecretStore(null);
});
