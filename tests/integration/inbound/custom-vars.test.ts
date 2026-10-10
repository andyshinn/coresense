import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { captureBus } from '../../support/bus';
import { makeTestSession } from '../../support/session-harness';

describe('RESP_CUSTOM_VARS handled via the feature registry', () => {
  it('folds gps + gps_interval into GpsConfig and emits gpsConfig', async () => {
    const { receive } = makeTestSession();
    const seen = captureBus('gpsConfig');

    receive(Buffer.from([0x15, ...Buffer.from('gps:1\ngps_interval:45', 'utf8')]));
    await Promise.resolve();

    expect(seen.last()).toEqual({ enabled: true, intervalSec: 45 });
    expect(stateHolder().getGpsConfig().intervalSec).toBe(45);
  });
});
