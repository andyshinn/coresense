import { Protocol } from '@andyshinn/meshcore-ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { fetchAdvertPath, resetAdvertPathState } from '../../../src/main/state/advertPath';
import { isContactAutoRefreshRunning } from '../../../src/main/state/contactRefresh';
import { beginContactWalk, isContactWalkInFlight, noteContactWalkStreaming } from '../../../src/main/state/contactWalk';
import { transportManager } from '../../../src/main/transport/manager';
import type { TransportState } from '../../../src/shared/types';
import { contactSyncFrame } from '../../support/companionFrames';
import { bootTestServer } from '../../support/server';
import { makeTestSession, type TestSession } from '../../support/session-harness';

// meshcore-ts 0.8.1's session-lifecycle rewrite (#27 + #29), seen from
// coresense's own connect/disconnect machinery: a second connect on the SAME
// session object.
//
// 0.8.1 changed two things that coresense hangs reconnect work off:
//
//  - `connected` became a pure edge latch: onTransportState's connect and
//    disconnect branches run once per connect, and the disconnect branch is the
//    library's teardown (awaiter queues cleared, syncProgress reset).
//  - `stop()` now runs that same teardown and clears the latch.
//
// The other half of that rewrite — the library now EMITTING `transportState`,
// and a restarted SessionAdapter — is pinned in transport-state-emit.test.ts.
//
// Unlike that file's device-id cases, these also pass on 0.8.0: a reconnect
// worked before the rewrite too. They are here so the rewrite, and anything
// after it, cannot quietly stop re-arming what coresense hangs off a connect.
//
// These drive the real wiring — a real MeshCoreSession over a Loopback
// transport, and where the assertion is about the bus, the real HTTP server's
// subscriber rather than a stand-in for it.

const PK = 'a3'.repeat(32);

// bootTestServer() is the real HTTP server, and it is what owns coresense's
// transportState subscriber (src/main/server.ts's `onTransportState`): that
// subscriber arms/disarms the contact auto-refresh, releases the walk guard
// and writes transportManager.

/** A started session, not yet connected. */
function session(): TestSession {
  return makeTestSession({ installAsProtocolSession: true });
}

/** coresense's BleTransport.connect() tail, verbatim: the bus is told first
 *  (with the device id), then the library transport (src/main/transport/ble.ts:
 *  195-196). BleTransport.disconnect() and onPeripheralDisconnect are the same
 *  two calls with 'idle' (ble.ts:235-236, 395-396). */
function driveTransport(s: TestSession, state: TransportState, deviceId?: string): void {
  bus.emit('transportState', state, deviceId);
  s.transport.setState(state === 'connected' ? 'connected' : 'idle');
}

// Reset before each test rather than after: the previous test's session and
// server are stopped only in the global afterEach (tests/support/teardown.ts),
// which runs after this file's hooks.
beforeEach(() => {
  resetAdvertPathState();
});

afterEach(() => {
  vi.useRealTimers();
});

// #29 made `connected` an edge latch — the connect and disconnect branches run
// once per connect. Everything coresense arms on a connect is keyed off its own
// transports' `transportState` bus announcement (adapterEvents deliberately does
// not re-emit the library's), and the library's teardown lives in the disconnect
// branch, so a second connect on the SAME session object has to re-arm all of
// it.
describe('a reconnect on the same session object', () => {
  it('releases the contact-walk guard and re-arms the auto-refresh timer', async () => {
    await bootTestServer();
    const s = session();

    driveTransport(s, 'connected', 'dev-1');
    expect(isContactAutoRefreshRunning()).toBe(true);

    // A walk is mid-stream when the link drops. Its END_OF_CONTACTS is never
    // coming, so nothing but the disconnect can release the guard — and while
    // it is held, the refresh button answers "already syncing".
    beginContactWalk();
    noteContactWalkStreaming();
    expect(isContactWalkInFlight()).toBe(true);

    driveTransport(s, 'idle', 'dev-1');
    expect(isContactWalkInFlight()).toBe(false);
    expect(isContactAutoRefreshRunning()).toBe(false);

    driveTransport(s, 'connected', 'dev-1');
    expect(isContactAutoRefreshRunning()).toBe(true);
  });

  // The post-handshake CMD_GET_AUTO_ADD_CONFIG fires on a rising edge of
  // syncProgress.phase that adapterEvents tracks itself. What re-arms that edge
  // is the library's handshake, not its teardown: every handshake opens by
  // emitting phase 'syncing', so the next 'done' is a rising edge again. (The
  // teardown's reset to 'idle' would do the same, but it is redundant here —
  // this test stays green with it deleted, so it does NOT guard that reset.)
  //
  // What it does guard: that the library runs a second handshake on the same
  // session object after an idle → connected edge (the `connected` latch
  // clears), and that adapterEvents does not latch the query to once per
  // wiring.
  it('re-issues the post-handshake auto-add query', async () => {
    vi.useFakeTimers();
    const s = session();
    transportManager.setState('connected');
    const queries = () => s.sentWithCode(Protocol.CMD.GET_AUTO_ADD_CONFIG).length;

    s.transport.setState('connected');
    // The handshake's two contact waiters resolve on their own watchdogs when
    // the radio answers nothing, which is enough to reach phase 'done'.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(queries()).toBe(1);

    s.transport.setState('idle');
    await vi.advanceTimersByTimeAsync(100);
    // Nothing is commandable while the link is down, and `isCommandable()`
    // returning early is the right answer rather than a frame into the void.
    expect(queries()).toBe(1);

    s.transport.setState('connected');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(queries()).toBe(2);
  });

  // advertPath.ts keeps per-pubkey in-flight and cooldown maps in process
  // memory. The in-flight slot is the one that could wedge a contact: a round
  // trip the disconnect abandoned must not leave the pubkey looking busy
  // forever.
  it('leaves no contact permanently un-measurable', async () => {
    const s = session();
    transportManager.setState('connected');
    s.transport.setState('connected');
    s.receive(contactSyncFrame(PK, 'Erin'));
    const asks = () => s.sentWithCode(Protocol.CMD.GET_ADVERT_PATH).length;

    const abandoned = fetchAdvertPath(PK, { force: true });
    await vi.waitFor(() => expect(asks()).toBe(1));

    // It settles promptly rather than riding out the 5s request timeout — the
    // library's disconnect teardown clears both awaiter queues.
    //
    // The library hands it back as a null, exactly like RESP_ERR NOT_FOUND:
    // `requestOrNull` arms an entry on the ack FIFO as well as the typed queue,
    // and the teardown resolves the ack FIFO (as `{ ok: false }`) BEFORE it
    // rejects the typed queue — and the ack path resolves null without looking
    // at `ok` (meshcore-ts session.ts:638 vs :650, requestOrNull's ackEntry).
    // advertPath.ts tells the two apart by the link: coresense's transports
    // announce 'idle' on the bus (moving transportManager) before the library
    // hears it, so a null read with the link gone is `failed`, not a miss.
    // Reported as `notCached`, a pressed button toasted "no recent advert path"
    // for a request the radio never heard, and the rail's automatic measurement
    // spent its one attempt per contact on it.
    //
    // Order as BleTransport has it: the bus is told first, then the library.
    transportManager.setState('idle');
    s.transport.setState('idle');
    expect(await abandoned).toMatchObject({ status: 'failed' });

    // The in-flight slot was released, so the same pubkey is askable again on
    // the next connect. A slot left behind would make every later caller await
    // the dead round trip's promise instead, forever.
    transportManager.setState('connected');
    s.transport.setState('connected');
    const retried = fetchAdvertPath(PK, { force: true });
    await vi.waitFor(() => expect(asks()).toBe(2));
    s.transport.setState('idle');
    await retried;
  });
});
