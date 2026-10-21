import { Protocol } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { messagesStore } from '../../../src/main/storage/messages';
import { captureBus } from '../../support/bus';
import { channelMsgV3, contactSyncFrame, newAdvertFrame } from '../../support/companionFrames';
import { frameBuf } from '../../support/frames';
import { makeTestSession } from '../../support/session-harness';

// Read-path smoke tests for the SessionAdapter: inject a companion frame through
// the LoopbackTransport and assert the adapter writes through to coresense's
// holder/discoveredStore/messagesStore and re-emits the identical emit.* bus
// event the renderer already listens for.

const PUBKEY = 'cc'.repeat(32);

describe('SessionAdapter read-path (inject frame → persist + bus)', () => {
  it('folds RESP_DEVICE_INFO into the holder and re-emits deviceInfo', async () => {
    const { receive } = makeTestSession();

    const seen = captureBus('deviceInfo');

    // A captured RESP_DEVICE_INFO: ver 11, maxContacts/2 0xaf, built
    // '19 Apr 2026', model 'Heltec T114', firmware 'v1.15.0'.
    receive(frameBuf('deviceInfo'));
    await Promise.resolve();

    expect(seen.last()?.firmwareVersion).toBe('v1.15.0');
    expect(seen.last()?.firmwareBuildDate).toBe('19 Apr 2026');
    expect(stateHolder().getDeviceInfo().deviceModel).toBe('Heltec T114');
    expect(stateHolder().getDeviceInfo().maxContacts).toBe(0xaf * 2);
  });

  it('ingests a PUSH_NEW_ADVERT into discoveredStore and emits discovered', async () => {
    const { receive } = makeTestSession();

    const discovered = captureBus('contactDiscovered');

    receive(newAdvertFrame(PUBKEY, 'Carol'));
    await Promise.resolve();

    expect(discovered.values).toEqual([{ key: `c:${PUBKEY}`, name: 'Carol', kind: 'chat' }]);

    const row = discoveredStore.get(PUBKEY);
    expect(row).not.toBeNull();
    expect(row?.name).toBe('Carol');
    // A freshly-heard advert is not on the radio until explicitly added.
    expect(row?.on_radio).toBe(0);
  });

  it('writes the lib discovered on_radio/favourite through to the sqlite mirror', async () => {
    const { adapter, receive, ackCommands } = makeTestSession();
    // Both commands below wait for the radio's RESP_OK.
    ackCommands(Protocol.CMD.REMOVE_CONTACT, Protocol.CMD.ADD_UPDATE_CONTACT);
    const pk = 'ab'.repeat(32);

    // Establish an on-radio contact in coresense's mirror via the sync path:
    // RESP_CONTACT → contactObserved('sync') → discoveredStore on_radio=1. This
    // also seeds the lib's own discovered store (needed by the commands below).
    receive(contactSyncFrame(pk, 'Dave'));
    await Promise.resolve();
    expect(discoveredStore.get(pk)?.on_radio).toBe(1);

    // Removing from the radio goes through the lib, which emits a cooked
    // `discovered` (onRadio:false) but NO contactObserved. The handler must
    // write that through, flipping coresense's mirror to off-radio.
    await adapter.removeContactFromRadio(pk);
    await Promise.resolve();
    expect(discoveredStore.get(pk)?.on_radio).toBe(0);

    // Same shape for favourite: setContactFavourite emits `discovered`
    // (favourite:true) with no contactObserved, and must reach the mirror.
    await adapter.setContactFavourite(pk, true);
    await Promise.resolve();
    expect(discoveredStore.get(pk)?.favourite).toBe(1);
  });

  it('routes a channel-message frame to storage and re-emits messages', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.markChannelPresent({ key: 'ch:General', name: 'General', kind: 'public', idx: 0 });

    const emitted = captureBus('messages');

    receive(channelMsgV3(0, 1_700_000_000, 'Alice: hi'));
    await Promise.resolve();

    expect(emitted.last()).toBe('ch:General');
    const rows = messagesStore.byKey('ch:General');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'ch:General', body: 'hi', state: 'received' });
  });
});
