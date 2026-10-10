import { Buffer } from 'node:buffer';
import { Transports } from '@andyshinn/meshcore-ts';
import { setProtocolSession } from '../../src/main/protocol';
import { SessionAdapter } from '../../src/main/protocol/sessionAdapter';
import { transportManager } from '../../src/main/transport/manager';
import { deferTeardown } from './teardown';

export interface TestSession {
  adapter: SessionAdapter;
  transport: Transports.Loopback;
  /** Deliver one inbound companion frame (hex or Buffer) to the session. */
  receive(frame: Buffer | string): void;
  /** Every outbound frame whose code byte is `code` (use Protocol.CMD), in
   *  send order. */
  sentWithCode(code: number): Buffer[];
}

export interface TestSessionOptions {
  /** Mark coresense's transportManager 'connected', so code paths that refuse
   *  without a radio (fetchAdvertPath, the advert sampler) run. The library
   *  transport is left idle, so no handshake fires. */
  connected?: boolean;
  /** Install the adapter as the module-level protocolSession(), which is the
   *  seam the API routes and state modules reach the radio through. */
  installAsProtocolSession?: boolean;
}

/** Construct a SessionAdapter over a LoopbackTransport, started but NOT connected
 *  (so the handshake doesn't fire). Inject frames with `receive()`; assert on the
 *  emit.* bus + holder + transport.sent.
 *
 *  The integration project's global afterEach stops the session (the library
 *  arms watchdog and resync timers on a live one), drops it from the
 *  protocolSession() seam and resets transportManager to 'idle', so tests need
 *  no teardown of their own. Stopping is idempotent: a test may stop it first. */
export function makeTestSession(opts: TestSessionOptions = {}): TestSession {
  const transport = new Transports.Loopback();
  const adapter = new SessionAdapter(transport);
  adapter.start();
  deferTeardown(() => adapter.stop());
  if (opts.connected) transportManager.setState('connected');
  if (opts.installAsProtocolSession) {
    setProtocolSession(adapter);
    deferTeardown(() => setProtocolSession(null));
  }
  return {
    adapter,
    transport,
    receive(frame) {
      const hex = typeof frame === 'string' ? frame : frame.toString('hex');
      transport.receiveHex(hex);
    },
    sentWithCode(code) {
      return transport.sent.filter((f) => f[0] === code).map((f) => Buffer.from(f));
    },
  };
}
