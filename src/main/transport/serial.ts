import type { ITransport } from './types';

export class SerialTransport implements ITransport {
  readonly type = 'serial' as const;

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
