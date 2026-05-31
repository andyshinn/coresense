import type { TransportState } from '../../shared/types';
import type { ITransport } from './types';

class TransportManager {
  private active: ITransport | null = null;
  private state: TransportState = 'idle';
  private deviceId: string | undefined;

  setTransport(t: ITransport): void {
    this.active = t;
  }

  clearTransport(): void {
    this.active = null;
  }

  getTransport(): ITransport | null {
    return this.active;
  }

  setState(state: TransportState, deviceId?: string): void {
    this.state = state;
    this.deviceId = deviceId;
  }

  getState(): { state: TransportState; deviceId?: string } {
    return { state: this.state, deviceId: this.deviceId };
  }

  async disconnect(): Promise<void> {
    if (this.active) await this.active.disconnect();
  }

  async shutdown(): Promise<void> {
    if (!this.active) return;
    if (this.active.shutdown) {
      await this.active.shutdown();
    } else {
      await this.active.disconnect();
    }
  }
}

export const transportManager = new TransportManager();
