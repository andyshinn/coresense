export type TransportState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface BleDevice {
  id: string;
  name: string | null;
  rssi: number;
}

export interface RawPacket {
  timestamp: number;
  transportType: 'ble' | 'serial';
  hex: string;
  bytes: number[];
}

export type WsMessage =
  | { type: 'packet'; payload: RawPacket }
  | { type: 'transportState'; payload: { state: TransportState; deviceId?: string } }
  | { type: 'scanResults'; payload: BleDevice[] }
  | { type: 'error'; payload: { message: string } };

export interface Capabilities {
  isElectron: boolean;
  version: string;
  platform: string;
  httpPort: number;
}

export interface ServerStatus {
  port: number;
  wsClients: number;
  transport: TransportState;
  deviceId?: string;
}
