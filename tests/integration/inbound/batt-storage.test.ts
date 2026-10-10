import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { captureBus } from '../../support/bus';
import { makeTestSession } from '../../support/session-harness';

describe('RESP_BATT_AND_STORAGE handled via the feature registry', () => {
  it('folds battery + storage into device info and emits deviceInfo', async () => {
    const { receive } = makeTestSession();

    const emitted = captureBus('deviceInfo');

    receive(Buffer.from([0x0c, 0x10, 0x0e, 0x00, 0x01, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00]));
    await Promise.resolve();

    expect(emitted.last()?.batteryMv).toBe(3600);
    expect(emitted.last()?.storageUsedKb).toBe(256);
    expect(stateHolder().getDeviceInfo().storageTotalKb).toBe(4096);
  });
});
