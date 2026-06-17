import { Buffer } from 'node:buffer';
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

  it('parses firmware version + build date from a full DEVICE_INFO frame', async () => {
    const session = protocolSession();
    session.start();

    const info: Array<{ firmwareVersion?: string; firmwareBuildDate?: string }> = [];
    const onInfo = (d: { firmwareVersion?: string; firmwareBuildDate?: string }) => info.push(d);
    bus.on('deviceInfo', onInfo);

    // RESP_DEVICE_INFO fixed layout (firmware MyMesh.cpp CMD_DEVICE_QUERY):
    //   [0]=code 0x0d, [1]=verCode, [2]=maxContacts/2, [3]=maxChannels,
    //   [4..7]=ble_pin u32LE, [8..19]=build date, [20..59]=model,
    //   [60..79]=firmware version, [80]=client_repeat
    const frame = Buffer.alloc(82);
    frame[0] = 0x0d;
    frame[1] = 0x0b; // ver 11
    frame[2] = 0xaf; // maxContacts / 2
    frame[3] = 0x28; // maxChannels
    frame.writeUInt32LE(0, 4); // ble_pin unset
    frame.write('19 Apr 2026', 8, 'ascii');
    frame.write('Heltec T096', 20, 'ascii');
    frame.write('v1.15.0', 60, 'ascii');
    frame[80] = 1;

    emit.packet(companionPacket(frame));
    await Promise.resolve();
    bus.off('deviceInfo', onInfo);

    expect(info.at(-1)?.firmwareVersion).toBe('v1.15.0');
    expect(info.at(-1)?.firmwareBuildDate).toBe('19 Apr 2026');
    expect(stateHolder().getDeviceInfo().deviceModel).toBe('Heltec T096');
  });
});
