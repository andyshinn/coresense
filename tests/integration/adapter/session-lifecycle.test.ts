import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { setProtocolSession } from '../../../src/main/protocol';
import { startServer } from '../../../src/main/server';
import { fetchAdvertPath, resetAdvertPathState } from '../../../src/main/state/advertPath';
import { isContactAutoRefreshRunning } from '../../../src/main/state/contactRefresh';
import { beginContactWalk, isContactWalkInFlight, noteContactWalkStreaming } from '../../../src/main/state/contactWalk';
import { transportManager } from '../../../src/main/transport/manager';
import type { TransportState } from '../../../src/shared/types';
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

const CMD_GET_AUTO_ADD_CONFIG = 0x3b;
const CMD_GET_ADVERT_PATH = 0x2a;

const PK = 'a3'.repeat(32);

/** RESP_CONTACT (0x03): seeds the library's contact map so hasRadioContact passes. */
function contactSyncFrame(pubkeyHex: string, name: string): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = 0x03;
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  frame[33] = 1; // type = chat
  frame[35] = 0xff; // out_path_len = OUT_PATH_UNKNOWN
  Buffer.from(name, 'utf8').copy(frame, 100);
  return frame;
}

let live: TestSession | null = null;
let closeServer: (() => Promise<void>) | null = null;

/** The real HTTP server, on an ephemeral port with a stub bridge. It is the
 *  thing that owns coresense's transportState subscriber (src/main/server.ts's
 *  `onTransportState`), and that subscriber is what arms/disarms the contact
 *  auto-refresh, releases the walk guard and writes transportManager. Booting it
 *  is the only way to assert on that handler — it is a closure, not an export. */
async function bootServer(): Promise<void> {
  const bridge = { getStatus: () => ({ running: false, clients: 0 }), on: () => {}, off: () => {} };
  const handle = await startServer(null, bridge as never, { port: 0, bindAddress: '127.0.0.1' });
  closeServer = handle.close;
}

/** A started session, not yet connected. */
function session(): TestSession {
  const s = makeTestSession();
  live = s;
  setProtocolSession(s.adapter);
  return s;
}

/** coresense's BleTransport.connect() tail, verbatim: the bus is told first
 *  (with the device id), then the library transport (src/main/transport/ble.ts:
 *  195-196). BleTransport.disconnect() and onPeripheralDisconnect are the same
 *  two calls with 'idle' (ble.ts:235-236, 395-396). */
function driveTransport(s: TestSession, state: TransportState, deviceId?: string): void {
  bus.emit('transportState', state, deviceId);
  s.transport.setState(state === 'connected' ? 'connected' : 'idle');
}

afterEach(async () => {
  live?.adapter.stop();
  live = null;
  setProtocolSession(null);
  await closeServer?.();
  closeServer = null;
  resetAdvertPathState();
  transportManager.setState('idle');
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
    await bootServer();
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
  // syncProgress.phase that adapterEvents tracks itself. The edge is re-armable
  // only because the library's disconnect teardown resets syncProgress to its
  // default ('idle'), so the second handshake's 'done' is a rising edge again.
  it('re-issues the post-handshake auto-add query', async () => {
    vi.useFakeTimers();
    const s = session();
    transportManager.setState('connected');
    const queries = () => s.transport.sent.filter((f) => f[0] === CMD_GET_AUTO_ADD_CONFIG).length;

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
    const asks = () => s.transport.sent.filter((f) => f[0] === CMD_GET_ADVERT_PATH).length;

    const abandoned = fetchAdvertPath(PK, { force: true });
    await vi.waitFor(() => expect(asks()).toBe(1));

    // It settles promptly rather than riding out the 5s request timeout — the
    // library's disconnect teardown clears both awaiter queues.
    //
    // `notCached`, not `failed`, and that is the library's answer rather than
    // coresense's choice: `requestOrNull` arms an entry on the ack FIFO as well
    // as the typed queue, and the teardown resolves the ack FIFO (as
    // `{ ok: false }`) BEFORE it rejects the typed queue — and the ack path
    // resolves null without looking at `ok` (meshcore-ts session.ts:638 vs
    // :650, requestOrNull's ackEntry). So a dropped link is indistinguishable
    // here from RESP_ERR NOT_FOUND. Pinned because it is exactly what a caller
    // must not assume away: nothing is written for a `notCached`, so the only
    // cost is a 60s cooldown before the user's retry reaches the radio.
    s.transport.setState('idle');
    transportManager.setState('idle');
    expect(await abandoned).toEqual({ status: 'notCached' });

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
