import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { stateHolder } from '../../../src/main/state/holder';
import { makeTestSession } from '../../support/session-harness';

describe('RESP_BATT_AND_STORAGE handled via the feature registry', () => {
  it('folds battery + storage into device info and emits deviceInfo', async () => {
    const { receive } = makeTestSession();

    const emitted: { batteryMv?: number; storageUsedKb?: number }[] = [];
    const onInfo = (info: { batteryMv?: number; storageUsedKb?: number }) => {
      emitted.push(info);
    };
    bus.on('deviceInfo', onInfo);

    receive(Buffer.from([0x0c, 0x10, 0x0e, 0x00, 0x01, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00]));
    await Promise.resolve();
    bus.off('deviceInfo', onInfo);

    expect(emitted.at(-1)?.batteryMv).toBe(3600);
    expect(emitted.at(-1)?.storageUsedKb).toBe(256);
    expect(stateHolder().getDeviceInfo().storageTotalKb).toBe(4096);
  });
});
