import type { Buffer } from 'node:buffer';

// RESP_CHANNEL_INFO frame layout (firmware: companion_radio/MyMesh.cpp):
//   [0]: 0x12
//   [1]: idx
//   [2..33]: name 32B null-padded
//   [34..49]: shared key 16B
export interface ChannelInfo {
  idx: number;
  name: string;
  secretHex: string;
  /** Channels with an all-zero key are unconfigured slots — skip them. */
  empty: boolean;
}

const CHANNEL_INFO_FRAME_LEN = 50;

export function parseChannelInfo(frame: Buffer): ChannelInfo | null {
  if (frame.length < CHANNEL_INFO_FRAME_LEN) return null;
  const idx = frame[1];
  // The 32B region after idx holds a null-terminated channel name; firmware
  // packs a second field (looks like a topic/owner) into the remaining bytes
  // of the same 32B, so we must stop at the FIRST null — not strip trailing
  // nulls.
  const nameRegion = frame.subarray(2, 34);
  const firstNull = nameRegion.indexOf(0);
  const nameBytes = firstNull === -1 ? nameRegion : nameRegion.subarray(0, firstNull);
  const name = nameBytes.toString('utf8');
  const key = frame.subarray(34, 50);
  const empty = key.every((b) => b === 0);
  return {
    idx,
    name,
    secretHex: key.toString('hex'),
    empty,
  };
}

// RESP_CHANNEL_MSG_RECV_V3 frame layout (firmware: companion_radio/MyMesh.cpp
// onChannelMessageRecv):
//   [0]: 0x11
//   [1]: snr*4 (signed int8) — divide by 4 for dB
//   [2..3]: 2B reserved
//   [4]: channel index (slot on the radio)
//   [5]: path_len (hop count for flood; 0xFF for direct)
//   [6]: txt_type
//   [7..10]: timestamp uint32 LE (UNIX seconds)
//   [11..]: text body (often prefixed "name: ")
export interface ChannelMsgV3 {
  snrDb: number;
  channelIdx: number;
  pathLen: number;
  txtType: number;
  timestampUnix: number;
  body: string;
  /** Body with the trailing "name: " sender prefix split out, when present. */
  senderName: string | null;
  cleanBody: string;
}

export function parseChannelMsgV3(frame: Buffer): ChannelMsgV3 | null {
  if (frame.length < 12) return null;
  const snrRaw = frame.readInt8(1);
  const channelIdx = frame[4];
  const pathLen = frame[5];
  const txtType = frame[6];
  const timestampUnix = frame.readUInt32LE(7);
  const body = frame.subarray(11).toString('utf8').replace(/\0+$/, '');
  const { senderName, cleanBody } = splitSenderPrefix(body);
  return {
    snrDb: snrRaw / 4,
    channelIdx,
    pathLen,
    txtType,
    timestampUnix,
    body,
    senderName,
    cleanBody,
  };
}

// Older RESP_CHANNEL_MSG_RECV (0x08) — no SNR/reserved prefix.
//   [0]: 0x08
//   [1]: channel index
//   [2]: path_len
//   [3]: txt_type
//   [4..7]: timestamp uint32 LE
//   [8..]: text body
export function parseChannelMsgV1(frame: Buffer): ChannelMsgV3 | null {
  if (frame.length < 8) return null;
  const channelIdx = frame[1];
  const pathLen = frame[2];
  const txtType = frame[3];
  const timestampUnix = frame.readUInt32LE(4);
  const body = frame.subarray(8).toString('utf8').replace(/\0+$/, '');
  const { senderName, cleanBody } = splitSenderPrefix(body);
  return {
    snrDb: 0,
    channelIdx,
    pathLen,
    txtType,
    timestampUnix,
    body,
    senderName,
    cleanBody,
  };
}

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

// RESP_CONTACT frame (firmware: companion_radio/MyMesh.cpp writeContactRespFrame).
// Used for both RESP_CONTACT (0x03) inside a CMD_GET_CONTACTS iteration and
// PUSH_NEW_ADVERT (0x8a) when a fresh advert arrives during a session.
//   [0]: code (0x03 RESP_CONTACT, 0x8a PUSH_NEW_ADVERT)
//   [1..32]: pub_key 32B
//   [33]: type (ADV_TYPE — 1 chat, 2 repeater, 3 room, 4 sensor)
//   [34]: flags
//   [35]: out_path_len
//   [36..99]: out_path 64B
//   [100..131]: name 32B null-padded
//   [132..135]: last_advert_timestamp uint32 LE
//   [136..139]: gps_lat int32 LE (deg × 1e6)
//   [140..143]: gps_lon int32 LE (deg × 1e6)
//   [144..147]: lastmod uint32 LE
export interface ContactRecord {
  publicKeyHex: string;
  type: number;
  flags: number;
  outPathLen: number;
  outPathHex: string;
  name: string;
  lastAdvertUnix: number;
  gpsLat: number;
  gpsLon: number;
  lastmod: number;
}

const CONTACT_FRAME_LEN = 1 + 32 + 1 + 1 + 1 + 64 + 32 + 4 + 4 + 4 + 4; // 148

export function parseContact(frame: Buffer): ContactRecord | null {
  if (frame.length < CONTACT_FRAME_LEN) return null;
  const publicKeyHex = frame.subarray(1, 33).toString('hex');
  const type = frame[33];
  const flags = frame[34];
  const outPathLen = frame[35];
  const outPathHex = frame.subarray(36, 36 + outPathLen).toString('hex');
  const nameRegion = frame.subarray(100, 132);
  const firstNull = nameRegion.indexOf(0);
  const nameBytes = firstNull === -1 ? nameRegion : nameRegion.subarray(0, firstNull);
  return {
    publicKeyHex,
    type,
    flags,
    outPathLen,
    outPathHex,
    name: nameBytes.toString('utf8'),
    lastAdvertUnix: frame.readUInt32LE(132),
    gpsLat: frame.readInt32LE(136) / 1_000_000,
    gpsLon: frame.readInt32LE(140) / 1_000_000,
    lastmod: frame.readUInt32LE(144),
  };
}

// RESP_CONTACTS_START [0x02][count u32 LE]
export function parseContactsStart(frame: Buffer): number | null {
  if (frame.length < 5) return null;
  return frame.readUInt32LE(1);
}

// RESP_END_OF_CONTACTS [0x04][most_recent_lastmod u32 LE]
export function parseEndOfContacts(frame: Buffer): number | null {
  if (frame.length < 5) return null;
  return frame.readUInt32LE(1);
}

// PUSH_CODE_CONTACT_DELETED [0x8f][32B pubkey] — firmware evicted a contact
// (overwrite-oldest). Returns the lowercase hex public key, or null if short.
export function parseContactDeleted(frame: Buffer): string | null {
  if (frame.length < 1 + 32) return null;
  return frame.subarray(1, 33).toString('hex');
}

// RESP_CONTACT_MSG_RECV_V3 frame (firmware: companion_radio/MyMesh.cpp):
//   [0]: 0x10
//   [1]: snr*4 (signed int8) — divide by 4 for dB
//   [2..3]: 2B reserved
//   [4..9]: 6B sender public-key prefix
//   [10]: path_len (0xFF = direct/no flood)
//   [11]: txt_type
//   [12..15]: timestamp uint32 LE (UNIX seconds)
//   [16..]: text body (no "name: " prefix — sender identified by pubkey prefix)
export interface ContactMsgV3 {
  snrDb: number;
  senderPubKeyPrefixHex: string;
  pathLen: number;
  txtType: number;
  timestampUnix: number;
  body: string;
}

export function parseContactMsgV3(frame: Buffer): ContactMsgV3 | null {
  if (frame.length < 16) return null;
  const snrRaw = frame.readInt8(1);
  const senderPubKeyPrefixHex = frame.subarray(4, 10).toString('hex');
  const pathLen = frame[10];
  const txtType = frame[11];
  const timestampUnix = frame.readUInt32LE(12);
  const body = frame.subarray(16).toString('utf8').replace(/\0+$/, '');
  return {
    snrDb: snrRaw / 4,
    senderPubKeyPrefixHex,
    pathLen,
    txtType,
    timestampUnix,
    body,
  };
}

// Older RESP_CONTACT_MSG_RECV (0x07) — pre-V3, no SNR prefix.
//   [0]: 0x07
//   [1..6]: 6B sender pub_key_prefix
//   [7]: path_len
//   [8]: txt_type
//   [9..12]: timestamp uint32 LE
//   [13..]: text body
export function parseContactMsgV1(frame: Buffer): ContactMsgV3 | null {
  if (frame.length < 13) return null;
  const senderPubKeyPrefixHex = frame.subarray(1, 7).toString('hex');
  const pathLen = frame[7];
  const txtType = frame[8];
  const timestampUnix = frame.readUInt32LE(9);
  const body = frame.subarray(13).toString('utf8').replace(/\0+$/, '');
  return { snrDb: 0, senderPubKeyPrefixHex, pathLen, txtType, timestampUnix, body };
}

// RESP_SENT (0x06) acknowledging a CMD_SEND_TXT_MSG / CMD_SEND_CHAN_TXT_MSG:
//   [0]: 0x06
//   [1]: flood_flag (1 = flood, 0 = direct)
//   [2..5]: expected_ack uint32 LE (0 = no ACK expected)
//   [6..9]: est_timeout milliseconds uint32 LE
export interface SentAck {
  flood: boolean;
  expectedAckHex: string;
  estTimeoutMs: number;
}

export function parseSentAck(frame: Buffer): SentAck | null {
  if (frame.length < 10) return null;
  return {
    flood: frame[1] === 1,
    expectedAckHex: frame.subarray(2, 6).toString('hex'),
    estTimeoutMs: frame.readUInt32LE(6),
  };
}

// PUSH_SEND_CONFIRMED (0x82) fires when an ACK matching a prior expected_ack
// arrives from the recipient.
//   [0]: 0x82
//   [1..4]: ack_hash uint32 LE
//   [5..8]: trip_time_millis uint32 LE
export interface SendConfirmed {
  ackHex: string;
  tripTimeMs: number;
}

export function parseSendConfirmed(frame: Buffer): SendConfirmed | null {
  if (frame.length < 9) return null;
  return {
    ackHex: frame.subarray(1, 5).toString('hex'),
    tripTimeMs: frame.readUInt32LE(5),
  };
}

// Sender names on channel messages are conventionally prefixed "name: " by the
// originating node. Strip them for cleaner rendering; keep the original body
// available too.
function splitSenderPrefix(body: string): { senderName: string | null; cleanBody: string } {
  const colon = body.indexOf(': ');
  if (colon <= 0 || colon > 32) return { senderName: null, cleanBody: body };
  const candidate = body.slice(0, colon);
  // Reject control chars but allow non-ASCII (sender names commonly include emoji).
  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return { senderName: null, cleanBody: body };
  }
  return { senderName: candidate, cleanBody: body.slice(colon + 2) };
}

// ---- Settings-parity decoders ------------------------------------------

// RESP_DEVICE_INFO. The official client treats most of the payload as
// firmware-version-specific metadata; we only need the few fields we surface
// in the UI. Bytes past `firmware_ver_code` evolve across firmware revisions,
// so optional readers fall back to 0 when the frame is too short.
export interface DeviceInfo {
  /** Firmware capability level: 1=v1.x, ..., 9 adds client_repeat,
   *  10 adds path_hash_mode in the device info reply. */
  firmwareVerCode: number;
  /** Firmware reports max_contacts as count/2 (legacy encoding). */
  maxContacts: number;
  maxChannels: number;
  /** Repeat mode echo when firmware ≥ 9; undefined otherwise. */
  clientRepeat?: boolean;
  /** Path hash mode echo (0|1|2 → 1|2|3 bytes per hop) when firmware ≥ 10. */
  pathHashMode?: number;
  /** Best-effort device model string scanned from the trailing printable bytes,
   *  mirroring parseNodeNameFromSelfInfo. May be empty when the firmware doesn't
   *  emit one. */
  deviceModel: string;
}
export function parseDeviceInfo(frame: Buffer): DeviceInfo | null {
  if (frame.length < 4) return null;
  const firmwareVerCode = frame[1];
  const maxContacts = frame[2] * 2;
  const maxChannels = frame[3];
  const clientRepeat = frame.length > 80 ? frame[80] !== 0 : undefined;
  const pathHashMode = frame.length > 81 ? frame[81] : undefined;
  let start = frame.length;
  while (start > 4) {
    const b = frame[start - 1];
    if (b >= 0x20 && b < 0x7f) start -= 1;
    else break;
  }
  const deviceModel = frame.subarray(start).toString('utf8').trim();
  return {
    firmwareVerCode,
    maxContacts,
    maxChannels,
    clientRepeat,
    pathHashMode,
    deviceModel,
  };
}

// RESP_SELF_INFO [0x05][adv_type u8][tx_power u8][max_tx_power u8]
//   [public_key 32B][...adv lat/lon + radio params, firmware-version-specific...]
//   [name, trailing printable ASCII]. We only surface the two fields the
//   identity card needs — the 32B pubkey at a fixed offset and the name via the
//   same trailing-printable scan parseNodeNameFromSelfInfo / parseDeviceInfo use,
//   which is firmware-version tolerant.
export interface SelfInfo {
  name: string;
  publicKeyHex: string;
}
export function parseSelfInfo(frame: Buffer): SelfInfo | null {
  if (frame.length < 36 || frame[0] !== 0x05) return null;
  const publicKeyHex = frame.subarray(4, 36).toString('hex');
  let start = frame.length;
  while (start > 36) {
    const b = frame[start - 1];
    if (b >= 0x20 && b < 0x7f) start -= 1;
    else break;
  }
  const name = frame.subarray(start).toString('utf8').trim();
  return { name, publicKeyHex };
}

// RESP_CUSTOM_VARS: newline-separated "key:value" pairs. The firmware may also
// use a NUL between entries on some older builds — we split on both to stay
// compatible.
export function parseCustomVars(frame: Buffer): Record<string, string> {
  if (frame.length < 2) return {};
  const text = frame.subarray(1).toString('utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/[\n\0]/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    out[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  return out;
}

// RESP_AUTOADD_CONFIG [0x19][flags u8]
export function parseAutoAddConfig(frame: Buffer): number | null {
  if (frame.length < 2) return null;
  return frame[1] & 0xff;
}
