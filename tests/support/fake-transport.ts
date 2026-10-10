import { Buffer } from 'node:buffer';
import { type Ports, Transports } from '@andyshinn/meshcore-ts';
import type { ITransport } from '../../src/main/transport/types';

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
