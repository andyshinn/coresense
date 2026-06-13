import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { stateHolder } from '../../../src/main/state/holder';
import { companionPacket } from '../../support/fake-transport';

describe('RESP_CUSTOM_VARS handled via the feature registry', () => {
  afterEach(() => protocolSession().stop());

  it('folds gps + gps_interval into GpsConfig and emits gpsConfig', async () => {
    const session = protocolSession();
    session.start();
    const seen: { enabled?: boolean; intervalSec?: number }[] = [];
    const onGps = (c: { enabled?: boolean; intervalSec?: number }) => seen.push(c);
    bus.on('gpsConfig', onGps);

    emit.packet(companionPacket(Buffer.from([0x15, ...Buffer.from('gps:1\ngps_interval:45', 'utf8')])));
    await Promise.resolve();
    bus.off('gpsConfig', onGps);

    expect(seen.at(-1)).toEqual({ enabled: true, intervalSec: 45 });
    expect(stateHolder().getGpsConfig().intervalSec).toBe(45);
  });
});
