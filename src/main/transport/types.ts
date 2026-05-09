export interface ITransport {
  readonly type: 'ble' | 'serial';
  connect(deviceId: string): Promise<void>;
  disconnect(): Promise<void>;
  scan?(): Promise<void>;
  stopScan?(): Promise<void>;
  sendBytes?(bytes: Buffer): Promise<void>;
  // Optional teardown invoked at app shutdown. Distinct from disconnect()
  // because it may release native resources that can't be re-initialized.
  shutdown?(): Promise<void>;
}
