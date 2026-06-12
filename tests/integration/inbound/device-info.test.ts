import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { stateHolder } from '../../../src/main/state/holder';
import { companionPacket } from '../../support/fake-transport';
import { frameBuf } from '../../support/frames';

describe('RESP_DEVICE_INFO handled via the feature registry', () => {
  afterEach(() => protocolSession().stop());

  it('folds firmware info into device state and emits deviceInfo + deviceCapabilities', async () => {
    const session = protocolSession();
    session.start();

    const info: { firmwareVerCode?: number }[] = [];
    const caps: { repeatMode?: boolean; identityKeyIO?: boolean }[] = [];
    const onInfo = (d: { firmwareVerCode?: number }) => info.push(d);
    const onCaps = (c: { repeatMode?: boolean; identityKeyIO?: boolean }) => caps.push(c);
    bus.on('deviceInfo', onInfo);
    bus.on('deviceCapabilities', onCaps);

    emit.packet(companionPacket(frameBuf('deviceInfo')));
    await Promise.resolve();
    bus.off('deviceInfo', onInfo);
    bus.off('deviceCapabilities', onCaps);

    expect(info.at(-1)?.firmwareVerCode).toBe(0x0b);
    expect(caps.at(-1)?.repeatMode).toBe(true); // ver 11 >= 9
    expect(caps.at(-1)?.identityKeyIO).toBe(false); // ver 11 < 25
    expect(stateHolder().getDeviceInfo().maxContacts).toBe(0xaf * 2);
  });
});
