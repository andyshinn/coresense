import { afterEach, describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { setProtocolSession } from '../../../src/main/protocol';
import { startServer } from '../../../src/main/server';
import { transportManager } from '../../../src/main/transport/manager';
import type { TransportState } from '../../../src/shared/types';
import { makeTestSession, type TestSession } from '../../support/session-harness';

// meshcore-ts 0.8.0 → 0.8.1 made `MeshCoreSession` EMIT `transportState`.
// Through v0.8.0 the event was declared in the library's events port and
// emitted from nowhere, so the handler coresense wired for it in
// adapterEvents.ts was dead code for its whole life. Adopting a version that
// emits it makes that line live, and it is the wrong line to have live:
// coresense's own transports own this bus event and emit it WITH the device id,
// which the library's `(s: TransportState) => void` signature cannot carry.
//
// These drive the real wiring — a real MeshCoreSession over a Loopback
// transport, and for the snapshot assertion the real HTTP server's subscriber
// rather than a stand-in for it.
//
// NOTE ON WHAT THESE CATCH TODAY. Against the 0.8.0 this branch pins, the first
// two cases pass whether or not the re-emit is present, because the library
// emits nothing for them to duplicate — they are guards that arm themselves on
// the next minor bump, and they were confirmed to fail (a second
// `['connected', undefined]`, and transportManager holding no device id) with
// the re-emit restored against a 0.8.1 build. The restart case below fails on
// 0.8.0 today. Keeping all three together is deliberate: the bug is one
// mechanism, and splitting it by which version happens to expose which half
// would leave the next reader to rediscover the connection.

const RESP_SELF_INFO_HEX = `05${'00'.repeat(70)}`;

let live: TestSession | null = null;
let closeServer: (() => Promise<void>) | null = null;

/** The real HTTP server on an ephemeral port with a stub bridge. It owns
 *  coresense's transportState subscriber (src/main/server.ts's
 *  `onTransportState`), which is what writes transportManager — and that
 *  subscriber is a closure, not an export, so booting the server is the only
 *  way to assert on it. */
async function bootServer(): Promise<void> {
  const bridge = { getStatus: () => ({ running: false, clients: 0 }), on: () => {}, off: () => {} };
  const handle = await startServer(null, bridge as never, { port: 0, bindAddress: '127.0.0.1' });
  closeServer = handle.close;
}

function session(): TestSession {
  const s = makeTestSession();
  live = s;
  setProtocolSession(s.adapter);
  return s;
}

/** coresense's BleTransport.connect() tail, verbatim: the bus is told first
 *  (with the device id), then the library transport (src/main/transport/ble.ts:
 *  195-196). disconnect() and onPeripheralDisconnect are the same two calls
 *  with 'idle' (ble.ts:235-236, 395-396). */
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
  transportManager.setState('idle');
  bus.removeAllListeners('transportState');
});

describe('the library re-emitting transportState onto coresense’s bus', () => {
  it('does not announce a second, device-less copy of the same transition', () => {
    const seen: Array<[TransportState, string | undefined]> = [];
    bus.on('transportState', (s: TransportState, id?: string) => seen.push([s, id]));
    const s = session();

    driveTransport(s, 'connected', 'dev-1');

    // One transition, one announcement. A second copy is not merely redundant:
    // it carries no device id, and every subscriber treats the latest value as
    // the truth.
    expect(seen).toEqual([['connected', 'dev-1']]);
  });

  // The one that reaches the screen. transportManager is what /api/snapshot
  // serves as `transport.deviceId`, which hydrates the renderer's
  // `connectedDeviceId` — the id the BLE panel's "Live link" card prints, and
  // the value its remember-this-radio effect refuses to save without. So a
  // device-less second announcement doesn't just look untidy; it loses the
  // stored radio and the user has to re-scan on every launch.
  it('leaves the connected device id intact for the snapshot to serve', async () => {
    await bootServer();
    const s = session();

    driveTransport(s, 'connected', 'dev-1');

    expect(transportManager.getState()).toEqual({ state: 'connected', deviceId: 'dev-1' });
  });
});

describe('re-starting one SessionAdapter', () => {
  // `MeshCoreSession.stop()` leaves `session.events` listeners attached, so a
  // second `wireSessionEvents` on the same session ADDS a full set rather than
  // replacing the first — and every frame after that is written through twice.
  // Nothing in src/ calls stop() today, but a restart only became a working
  // flow once the library stopped leaving `connected` latched across it, so
  // this is the wrong thing to leave armed.
  it('does not wire a second copy of every handler', () => {
    const s = session();
    const owners: unknown[] = [];
    bus.on('owner', (o: unknown) => owners.push(o));

    s.adapter.stop();
    s.adapter.start();
    s.receive(RESP_SELF_INFO_HEX);

    expect(owners).toHaveLength(1);
    bus.removeAllListeners('owner');
  });
});
