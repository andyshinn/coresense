export interface ITransport {
  readonly type: 'ble' | 'serial';
  connect(deviceId: string): Promise<void>;
  disconnect(): Promise<void>;
  scan?(): Promise<void>;
  stopScan?(): Promise<void>;
  sendBytes?(bytes: Buffer): Promise<void>;
}
