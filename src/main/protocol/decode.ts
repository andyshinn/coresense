import type { Buffer } from 'node:buffer';

// PUSH_STATUS_RESPONSE (firmware: companion_radio/MyMesh.cpp):
//   [0x87][1B reserved][6B sender pub_key_prefix][status bytes...]
// "status bytes" is the raw status blob the repeater returned. The firmware
// doesn't pin a layout in MyMesh.cpp — meshcore-py treats it as a sequence of
// fields keyed by a magic byte (uptime, batt mV, airtime, queue len, etc.).
// For now we surface (a) the sender prefix, (b) the raw hex payload — the
// renderer renders whatever fields it recognises and falls back to hex for
// unknown firmware versions.
export interface StatusResponse {
  senderPubKeyPrefixHex: string;
  payloadHex: string;
  fields: StatusField[];
}

// Best-effort decode of the meshcore "repeater status" blob. The well-known
// layout used by Heltec/RAK repeaters is:
//   [0..3]  bat_millivolts  uint32 LE
//   [4..7]  curr_tx_queue   uint32 LE (packets currently queued for TX)
//   [8..11] curr_free_queue uint32 LE (free slots in the TX queue)
//   [12..13] last_rssi      int16 LE (dBm × 1)
//   [14..17] n_packets_rx   uint32 LE
//   [18..21] n_packets_tx   uint32 LE (since boot)
//   [22..25] total_air_secs uint32 LE
//   [26..29] uptime_secs    uint32 LE
//   [30..33] sent_flood     uint32 LE
//   [34..37] sent_direct    uint32 LE
//   [38..41] recv_flood     uint32 LE
//   [42..45] recv_direct    uint32 LE
//   [46..47] full_evts      uint16 LE
//   [48..49] last_snr_x4    int16 LE (SNR × 4 → dB / 4)
//   [50]    n_direct_dups   uint8
//   [51]    n_flood_dups    uint8
// Older firmwares may truncate; we tolerate by stopping at the byte boundary.
export interface StatusField {
  name: string;
  value: number | string;
  unit?: string;
}

export function parseStatusResponse(frame: Buffer): StatusResponse | null {
  if (frame.length < 8) return null;
  const senderPubKeyPrefixHex = frame.subarray(2, 8).toString('hex');
  const payload = frame.subarray(8);
  return {
    senderPubKeyPrefixHex,
    payloadHex: payload.toString('hex'),
    fields: decodeStatusFields(payload),
  };
}

function decodeStatusFields(b: Buffer): StatusField[] {
  const fields: StatusField[] = [];
  const push = (name: string, value: number | string, unit?: string) =>
    fields.push({ name, value, unit });

  if (b.length >= 4) push('Battery', b.readUInt32LE(0) / 1000, 'V');
  if (b.length >= 8) push('TX queue', b.readUInt32LE(4));
  if (b.length >= 12) push('Free queue', b.readUInt32LE(8));
  if (b.length >= 14) push('Last RSSI', b.readInt16LE(12), 'dBm');
  if (b.length >= 18) push('RX packets', b.readUInt32LE(14));
  if (b.length >= 22) push('TX packets', b.readUInt32LE(18));
  if (b.length >= 26) push('Airtime', b.readUInt32LE(22), 's');
  if (b.length >= 30) push('Uptime', formatUptime(b.readUInt32LE(26)));
  if (b.length >= 34) push('Flood sent', b.readUInt32LE(30));
  if (b.length >= 38) push('Direct sent', b.readUInt32LE(34));
  if (b.length >= 42) push('Flood rx', b.readUInt32LE(38));
  if (b.length >= 46) push('Direct rx', b.readUInt32LE(42));
  if (b.length >= 48) push('Queue-full evts', b.readUInt16LE(46));
  if (b.length >= 50) push('Last SNR', b.readInt16LE(48) / 4, 'dB');
  if (b.length >= 51) push('Direct dups', b.readUInt8(50));
  if (b.length >= 52) push('Flood dups', b.readUInt8(51));
  return fields;
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// PUSH_TELEMETRY_RESPONSE (firmware: companion_radio/MyMesh.cpp):
//   [0x8b][1B reserved][6B sender pub_key_prefix][CayenneLPP-encoded fields...]
// CayenneLPP encoding: each field is [channel u8][type u8][data...]. The
// firmware uses a small subset (voltage, current, illumination, temperature,
// barometer); we decode those plus a fallback hex view for unknown types so
// new firmware additions surface without code changes.
export interface TelemetryResponse {
  senderPubKeyPrefixHex: string;
  payloadHex: string;
  fields: TelemetryField[];
}

export interface TelemetryField {
  channel: number;
  typeHex: string;
  name: string;
  value: number | string;
  unit?: string;
}

export function parseTelemetryResponse(frame: Buffer): TelemetryResponse | null {
  if (frame.length < 8) return null;
  const senderPubKeyPrefixHex = frame.subarray(2, 8).toString('hex');
  const payload = frame.subarray(8);
  return {
    senderPubKeyPrefixHex,
    payloadHex: payload.toString('hex'),
    fields: decodeCayenneLPP(payload),
  };
}

interface CayenneDescriptor {
  name: string;
  size: number;
  decode: (b: Buffer) => number | string;
  unit?: string;
}

// CayenneLPP type id → { name, payload size in bytes, decoder, unit }.
// Keys are decimal because biome's useSimpleNumberKeys disallows hex literals
// as object keys; the trailing comment preserves the spec id.
const CAYENNE_TYPES: Record<number, CayenneDescriptor> = {
  0: { name: 'Digital input', size: 1, decode: (b) => b.readUInt8(0) }, // 0x00
  1: { name: 'Digital output', size: 1, decode: (b) => b.readUInt8(0) }, // 0x01
  2: { name: 'Analog input', size: 2, decode: (b) => b.readInt16BE(0) / 100 }, // 0x02
  3: { name: 'Analog output', size: 2, decode: (b) => b.readInt16BE(0) / 100 }, // 0x03
  101: { name: 'Illuminance', size: 2, decode: (b) => b.readUInt16BE(0), unit: 'lx' }, // 0x65
  102: { name: 'Presence', size: 1, decode: (b) => b.readUInt8(0) }, // 0x66
  103: { name: 'Temperature', size: 2, decode: (b) => b.readInt16BE(0) / 10, unit: '°C' }, // 0x67
  104: { name: 'Humidity', size: 1, decode: (b) => b.readUInt8(0) / 2, unit: '%' }, // 0x68
  115: { name: 'Barometer', size: 2, decode: (b) => b.readUInt16BE(0) / 10, unit: 'hPa' }, // 0x73
  116: { name: 'Voltage', size: 2, decode: (b) => b.readUInt16BE(0) / 100, unit: 'V' }, // 0x74
  117: { name: 'Current', size: 2, decode: (b) => b.readUInt16BE(0) / 1000, unit: 'A' }, // 0x75
};

function decodeCayenneLPP(b: Buffer): TelemetryField[] {
  const out: TelemetryField[] = [];
  let i = 0;
  while (i + 2 <= b.length) {
    const channel = b[i];
    const type = b[i + 1];
    const desc = CAYENNE_TYPES[type];
    if (!desc) {
      // Unknown type — abort rather than mis-frame the rest.
      out.push({
        channel,
        typeHex: `0x${type.toString(16).padStart(2, '0')}`,
        name: 'Unknown',
        value: b.subarray(i + 2).toString('hex'),
      });
      break;
    }
    if (i + 2 + desc.size > b.length) break;
    const data = b.subarray(i + 2, i + 2 + desc.size);
    out.push({
      channel,
      typeHex: `0x${type.toString(16).padStart(2, '0')}`,
      name: desc.name,
      value: desc.decode(data),
      unit: desc.unit,
    });
    i += 2 + desc.size;
  }
  return out;
}
