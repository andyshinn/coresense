export type TransportState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface BleDevice {
  id: string;
  name: string | null;
  rssi: number;
}

export interface RawPacket {
  timestamp: number;
  transportType: 'ble' | 'serial';
  kind: 'mesh' | 'companion';
  // Verbatim transport frame — what the bridge fans out to TCP/WS proxy clients.
  // Companion: includes the type code byte. Mesh: includes the 0x84/0x88 + SNR/RSSI prefix.
  hex: string;
  bytes: number[];
  // Parsed payload — what the renderer displays / feeds to MeshCoreDecoder.
  // Companion: payload after the type code. Mesh: the mesh packet only.
  payloadHex: string;
  payloadBytes: number[];
  // Mesh-only: link metrics extracted from companion-radio RAW_DATA / LOG_RX_DATA frames.
  snr?: number;
  rssi?: number;
  // Companion-only: the frame-type byte (e.g. 0x84) and human-readable name.
  code?: number;
  codeName?: string;
}

export interface BridgeStatus {
  tcpPort: number | null;
  wsPort: number | null;
  bindAddress: string;
  lanAddress: string | null;
  tcpClients: number;
  wsClients: number;
  mdnsServiceName: string | null;
  radioConnected: boolean;
}

export type WsMessage =
  | { type: 'packet'; payload: RawPacket }
  | { type: 'transportState'; payload: { state: TransportState; deviceId?: string } }
  | { type: 'scanResults'; payload: BleDevice[] }
  | { type: 'error'; payload: { message: string } }
  | { type: 'bridgeStatus'; payload: BridgeStatus };

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
  bridge: BridgeStatus;
}
