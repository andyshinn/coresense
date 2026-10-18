import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { captureBus } from '../../support/bus';
import { frameBuf } from '../../support/frames';
import { makeTestSession } from '../../support/session-harness';

describe('RESP_SELF_INFO handled via the feature registry', () => {
  it('surfaces the radio identity as the app Owner and emits owner', async () => {
    const { receive } = makeTestSession();

    const owners = captureBus('owner');

    receive(frameBuf('selfInfo'));
    await Promise.resolve();

    expect(owners.last()?.publicKeyHex).toBe('1a3d3c6a09f057457bcf0ae5403e5c60072919d193ed8caff58501b7590dd5d5');
    expect(owners.last()?.publicKeyShort).toBe('1a3d3c6a09f0');
    expect(stateHolder().getOwner()?.name).toContain('Hand');
  });
});
