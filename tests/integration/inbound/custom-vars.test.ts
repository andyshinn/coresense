import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { stateHolder } from '../../../src/main/state/holder';
import { DEFAULT_GPS_CONFIG } from '../../../src/shared/types';
import { makeTestSession } from '../../support/session-harness';

describe('RESP_CUSTOM_VARS handled via the feature registry', () => {
  it('folds gps into GpsConfig and emits gpsConfig, keeping the interval last set from CoreSense', async () => {
    const { receive } = makeTestSession();
    // gps_interval is write-only in firmware: the value CoreSense last wrote.
    stateHolder().setGpsConfig({ ...DEFAULT_GPS_CONFIG, enabled: false, intervalSec: 900 });
    const seen: { enabled?: boolean; intervalSec?: number }[] = [];
    const onGps = (c: { enabled?: boolean; intervalSec?: number }) => seen.push(c);
    bus.on('gpsConfig', onGps);

    // The library fills intervalSec from its own unseeded mirror (300) — and
    // would take a reported gps_interval, which real firmware never sends.
    receive(Buffer.from([0x15, ...Buffer.from('gps:1\ngps_interval:45', 'utf8')]));
    await Promise.resolve();
    bus.off('gpsConfig', onGps);

    expect(seen.at(-1)).toEqual({ enabled: true, intervalSec: 900 });
    expect(stateHolder().getGpsConfig()).toEqual({ enabled: true, intervalSec: 900 });
  });

  it('a bare gps reply no longer resets the interval to the library default', async () => {
    const { receive } = makeTestSession();
    stateHolder().setGpsConfig({ ...DEFAULT_GPS_CONFIG, enabled: true, intervalSec: 120 });

    receive(Buffer.from([0x15, ...Buffer.from('gps:0', 'utf8')]));
    await Promise.resolve();

    expect(stateHolder().getGpsConfig()).toEqual({ enabled: false, intervalSec: 120 });
  });
});
