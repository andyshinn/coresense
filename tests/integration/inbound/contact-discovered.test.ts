import { describe, expect, it } from 'vitest';
import { captureBus } from '../../support/bus';
import { newAdvertFrame } from '../../support/companionFrames';
import { makeTestSession } from '../../support/session-harness';

const PUBKEY = 'cc'.repeat(32);

describe('inbound PUSH_NEW_ADVERT discovery', () => {
  it('emits contactDiscovered the first time a pubkey is heard', () => {
    const { receive } = makeTestSession();

    const discovered = captureBus('contactDiscovered');

    receive(newAdvertFrame(PUBKEY, 'Carol'));

    expect(discovered.values).toEqual([{ key: `c:${PUBKEY}`, name: 'Carol', kind: 'chat' }]);
  });

  it('does not emit on a re-advert of a known pubkey', () => {
    const { receive } = makeTestSession();

    const discovered = captureBus('contactDiscovered');

    receive(newAdvertFrame(PUBKEY, 'Carol')); // first → emits
    receive(newAdvertFrame(PUBKEY, 'Carol')); // second → silent
    expect(discovered.calls).toHaveLength(1);
  });
});
