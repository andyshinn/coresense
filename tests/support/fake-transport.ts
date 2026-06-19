import { Buffer } from 'node:buffer';
import { type Ports, Transports } from '@andyshinn/meshcore-ts';
import type { ITransport } from '../../src/main/transport/types';
import type { RawPacket } from '../../src/shared/types';

/** Build a kind:'companion' RawPacket from a full companion frame (code byte +
 *  payload). This is exactly what the session's onPacket consumes. */
export function companionPacket(frame: Buffer | string): RawPacket {
  const bytes = typeof frame === 'string' ? Buffer.from(frame, 'hex') : frame;
  const payload = bytes.subarray(1);
  return {
    timestamp: 0,
    transportType: 'ble',
    kind: 'companion',
    hex: bytes.toString('hex'),
    bytes: [...bytes],
    payloadHex: payload.toString('hex'),
    payloadBytes: [...payload],
    code: bytes[0],
  };
}

/** ITransport double that captures every sendBytes payload. */
export class FakeTransport implements ITransport {
  readonly type = 'ble' as const;
  readonly sent: Buffer[] = [];
  // Placeholder lib Transport satisfying ITransport. These tests inject frames
  // via emit.packet, not through the lib Transport.
  readonly libTransport: Ports.Transport = new Transports.Loopback();

  async connect(): Promise<void> {
    /* no-op: nothing to connect to */
  }
  async disconnect(): Promise<void> {
    /* no-op: nothing to disconnect */
  }
  async sendBytes(bytes: Buffer): Promise<void> {
    this.sent.push(Buffer.from(bytes));
  }
}
