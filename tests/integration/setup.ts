import { afterEach, beforeEach } from 'vitest';
import { bus } from '../../src/main/events/bus';
import { setAppLifecycle } from '../../src/main/runtime/appLifecycle';
import { setSecretStore } from '../../src/main/runtime/secretStore';
import { transportManager } from '../../src/main/transport/manager';
import { memorySecretStore, spyLifecycle } from '../support/seams';
import { cleanupTempUserData, useTempUserData } from '../support/sqlite-temp';

beforeEach(() => {
  useTempUserData();
  setAppLifecycle(spyLifecycle());
  setSecretStore(memorySecretStore());
});

afterEach(() => {
  bus.removeAllListeners();
  transportManager.clearTransport();
  cleanupTempUserData();
  setAppLifecycle(null);
  setSecretStore(null);
});
