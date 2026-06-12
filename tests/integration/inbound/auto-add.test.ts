import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { companionPacket } from '../../support/fake-transport';

describe('RESP_AUTOADD_CONFIG folds the flags byte into auto-add config', () => {
  afterEach(() => protocolSession().stop());

  it('maps the flags byte into auto-add config and emits autoAddConfig', async () => {
    const session = protocolSession();
    session.start();

    const seen: Array<{ chat: boolean; repeater: boolean; overwriteOldest: boolean }> = [];
    const onCfg = (c: { chat: boolean; repeater: boolean; overwriteOldest: boolean }) => {
      seen.push(c);
    };
    bus.on('autoAddConfig', onCfg);

    emit.packet(companionPacket(Buffer.from([0x19, 0x06]))); // chat(0x02)|repeater(0x04)
    await Promise.resolve();
    bus.off('autoAddConfig', onCfg);

    const cfg = seen.at(-1);
    expect(cfg?.chat).toBe(true);
    expect(cfg?.repeater).toBe(true);
    expect(cfg?.overwriteOldest).toBe(false);
  });
});
