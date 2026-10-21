import { Buffer } from 'node:buffer';
import { Protocol } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { DEFAULT_GPS_CONFIG } from '../../../src/shared/types';
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

  it('a bare gps reply keeps the interval last set from CoreSense, not the library default', async () => {
    // gps_interval is write-only in firmware, so the session seeds the
    // library's mirror from the holder at start (SessionAdapter.seedGpsConfig).
    stateHolder().setGpsConfig({ ...DEFAULT_GPS_CONFIG, enabled: true, intervalSec: 120 });
    const { receive } = makeTestSession();

    receive(Buffer.from([0x15, ...Buffer.from('gps:0', 'utf8')]));
    await Promise.resolve();

    expect(stateHolder().getGpsConfig()).toEqual({ enabled: false, intervalSec: 120 });
  });

  it('a sensor-setting write from My radio lands in GpsConfig through the library', async () => {
    stateHolder().setGpsConfig({ ...DEFAULT_GPS_CONFIG, enabled: true, intervalSec: 120 });
    const s = makeTestSession();
    const send = s.transport.send.bind(s.transport);
    s.transport.send = async (bytes: Uint8Array) => {
      await send(bytes);
      if (bytes[0] === Protocol.CMD.SET_CUSTOM_VAR) s.receive(Buffer.from([Protocol.RESP.OK]));
    };
    s.transport.setState('connected');

    expect(await s.adapter.setCustomVar('gps_interval', '900')).toBe(true);

    expect(stateHolder().getGpsConfig()).toEqual({ enabled: true, intervalSec: 900 });
  });
});
