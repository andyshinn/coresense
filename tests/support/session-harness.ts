import type { Buffer } from 'node:buffer';
import { LoopbackTransport } from '@andyshinn/meshcore-ts';
import { SessionAdapter } from '../../src/main/protocol/sessionAdapter';

export interface TestSession {
  adapter: SessionAdapter;
  transport: LoopbackTransport;
  /** Deliver one inbound companion frame (hex or Buffer) to the session. */
  receive(frame: Buffer | string): void;
}

/** Construct a SessionAdapter over a LoopbackTransport, started but NOT connected
 *  (so the handshake doesn't fire). Inject frames with `receive()`; assert on the
 *  emit.* bus + holder + transport.sent. */
export function makeTestSession(): TestSession {
  const transport = new LoopbackTransport();
  const adapter = new SessionAdapter(transport);
  adapter.start();
  return {
    adapter,
    transport,
    receive(frame) {
      const hex = typeof frame === 'string' ? frame : frame.toString('hex');
      transport.receiveHex(hex);
    },
  };
}
