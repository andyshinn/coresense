import type { Transport } from '@andyshinn/meshcore-ts';
import { createBleTransport } from '@andyshinn/meshcore-ts/transports';
import type { ITransport } from './types';

export class SerialTransport implements ITransport {
  readonly type = 'serial' as const;
  // Placeholder lib Transport so this not-implemented stub satisfies ITransport.
  // Serial transport is not wired yet; this is never consumed.
  readonly libTransport: Transport = createBleTransport({ write: async () => {}, subscribe: () => {} });

  async connect(_deviceId: string): Promise<void> {
    throw new Error('Serial transport not yet implemented');
  }

  async disconnect(): Promise<void> {
    throw new Error('Serial transport not yet implemented');
  }

  async scan(): Promise<void> {
    throw new Error('Serial transport not yet implemented');
  }

  async stopScan(): Promise<void> {
    throw new Error('Serial transport not yet implemented');
  }

  async sendBytes(_bytes: Buffer): Promise<void> {
    throw new Error('Serial transport not yet implemented');
  }
}
