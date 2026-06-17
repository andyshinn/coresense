import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { stateHolder } from '../../../src/main/state/holder';
import { makeTestSession } from '../../support/session-harness';

describe('RESP_CUSTOM_VARS handled via the feature registry', () => {
  it('folds gps + gps_interval into GpsConfig and emits gpsConfig', async () => {
    const { receive } = makeTestSession();
    const seen: { enabled?: boolean; intervalSec?: number }[] = [];
    const onGps = (c: { enabled?: boolean; intervalSec?: number }) => seen.push(c);
    bus.on('gpsConfig', onGps);

    receive(Buffer.from([0x15, ...Buffer.from('gps:1\ngps_interval:45', 'utf8')]));
    await Promise.resolve();
    bus.off('gpsConfig', onGps);

    expect(seen.at(-1)).toEqual({ enabled: true, intervalSec: 45 });
    expect(stateHolder().getGpsConfig().intervalSec).toBe(45);
  });
});
