import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { makeTestSession } from '../../support/session-harness';

describe('RESP_AUTOADD_CONFIG folds the flags byte into auto-add config', () => {
  it('maps the flags byte into auto-add config and emits autoAddConfig', async () => {
    const { receive } = makeTestSession();

    const seen: Array<{ chat: boolean; repeater: boolean; overwriteOldest: boolean }> = [];
    const onCfg = (c: { chat: boolean; repeater: boolean; overwriteOldest: boolean }) => {
      seen.push(c);
    };
    bus.on('autoAddConfig', onCfg);

    receive(Buffer.from([0x19, 0x06])); // chat(0x02)|repeater(0x04)
    await Promise.resolve();
    bus.off('autoAddConfig', onCfg);

    const cfg = seen.at(-1);
    expect(cfg?.chat).toBe(true);
    expect(cfg?.repeater).toBe(true);
    expect(cfg?.overwriteOldest).toBe(false);
  });
});
