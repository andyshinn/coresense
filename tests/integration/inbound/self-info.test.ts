import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { stateHolder } from '../../../src/main/state/holder';
import { frameBuf } from '../../support/frames';
import { makeTestSession } from '../../support/session-harness';

describe('RESP_SELF_INFO handled via the feature registry', () => {
  it('surfaces the radio identity as the app Owner and emits owner', async () => {
    const { receive } = makeTestSession();

    const owners: { name?: string; publicKeyHex?: string; publicKeyShort?: string }[] = [];
    const onOwner = (o: { name?: string; publicKeyHex?: string; publicKeyShort?: string }) => owners.push(o);
    bus.on('owner', onOwner);

    receive(frameBuf('selfInfo'));
    await Promise.resolve();
    bus.off('owner', onOwner);

    expect(owners.at(-1)?.publicKeyHex).toBe('1a3d3c6a09f057457bcf0ae5403e5c60072919d193ed8caff58501b7590dd5d5');
    expect(owners.at(-1)?.publicKeyShort).toBe('1a3d3c6a09f0');
    expect(stateHolder().getOwner()?.name).toContain('Hand');
  });
});
