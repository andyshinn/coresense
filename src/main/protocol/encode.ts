import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { CMD, type STATS_TYPE, TXT_TYPE } from './codes';

// CMD_GET_CHANNEL: enumerate per-slot.
//   [0x1f][idx]
// We don't yet know if the firmware accepts a bare opcode for "all channels",
// so we iterate by index 0..N-1. Empty slots come back as RESP_ERR (or a
// RESP_CHANNEL_INFO with an all-zero key, which drain.ts already filters).
export function buildGetChannel(idx: number): Buffer {
  return Buffer.from([CMD.GET_CHANNEL, idx & 0xff]);
}

// CMD_SEND_CHAN_TXT_MSG payload (per src/main/bridge/drain.ts):
//   [0x03][flags 1B][chan_idx 1B][ts 4B LE][text UTF-8...]
export function buildSendChannelText(opts: {
  channelIdx: number;
  text: string;
  timestampUnix?: number;
  flags?: number;
}): Buffer {
  const text = Buffer.from(opts.text, 'utf8');
  const ts = opts.timestampUnix ?? Math.floor(Date.now() / 1000);
  const out = Buffer.alloc(7 + text.length);
  out[0] = CMD.SEND_CHAN_TXT_MSG;
  out[1] = opts.flags ?? 0;
  out[2] = opts.channelIdx & 0xff;
  out.writeUInt32LE(ts >>> 0, 3);
  text.copy(out, 7);
  return out;
}

// CMD_GET_NEXT_MSG drains the device's inbox queue by one. Replied to with
// RESP_CONTACT_MSG_RECV(_V3) / RESP_CHANNEL_MSG_RECV(_V3) / RESP_NO_MORE_MESSAGES.
export function buildGetNextMsg(): Buffer {
  return Buffer.from([CMD.GET_NEXT_MSG]);
}

// CMD_SEND_TXT_MSG payload (firmware: companion_radio/MyMesh.cpp):
//   [0x02][txt_type 1B][attempt 1B][ts 4B LE][dest pubkey prefix 6B][text UTF-8...]
// The firmware looks the recipient up by the first 6 bytes of their public key
// (contacts the device has learned from adverts). Pass the full pubkey hex; we
// take the first 6 bytes ourselves so callers don't have to slice.
export function buildSendDmText(opts: {
  destPublicKeyHex: string;
  text: string;
  txtType?: number;
  attempt?: number;
  timestampUnix?: number;
}): Buffer {
  const pubkey = Buffer.from(opts.destPublicKeyHex, 'hex');
  if (pubkey.length < 6) {
    throw new Error(`dest public key must be ≥6 bytes, got ${pubkey.length}`);
  }
  const text = Buffer.from(opts.text, 'utf8');
  const ts = opts.timestampUnix ?? Math.floor(Date.now() / 1000);
  const out = Buffer.alloc(13 + text.length);
  out[0] = CMD.SEND_TXT_MSG;
  out[1] = opts.txtType ?? TXT_TYPE.PLAIN;
  out[2] = opts.attempt ?? 0;
  out.writeUInt32LE(ts >>> 0, 3);
  pubkey.copy(out, 7, 0, 6);
  text.copy(out, 13);
  return out;
}

// CMD_SEND_STATUS_REQ (firmware: companion_radio/MyMesh.cpp):
//   [0x1b][32B recipient pub_key]
// Radio replies with RESP_SENT (tag + est_timeout). The actual status payload
// arrives later as PUSH_STATUS_RESPONSE.
export function buildSendStatusReq(destPublicKeyHex: string): Buffer {
  const pubkey = Buffer.from(destPublicKeyHex, 'hex');
  if (pubkey.length < 32) {
    throw new Error(`status req needs full 32B public key, got ${pubkey.length}`);
  }
  const out = Buffer.alloc(1 + 32);
  out[0] = CMD.SEND_STATUS_REQ;
  pubkey.copy(out, 1, 0, 32);
  return out;
}

// CMD_SEND_TELEMETRY_REQ (firmware: companion_radio/MyMesh.cpp).
//   [0x27][3B reserved/filter][32B recipient pub_key]
// The 3 reserved bytes after the opcode are placeholder filter flags in the
// firmware path that takes len >= 4 + PUB_KEY_SIZE; we zero them.
export function buildSendTelemetryReq(destPublicKeyHex: string): Buffer {
  const pubkey = Buffer.from(destPublicKeyHex, 'hex');
  if (pubkey.length < 32) {
    throw new Error(`telemetry req needs full 32B public key, got ${pubkey.length}`);
  }
  const out = Buffer.alloc(4 + 32);
  out[0] = CMD.SEND_TELEMETRY_REQ;
  // bytes 1..3 stay zero
  pubkey.copy(out, 4, 0, 32);
  return out;
}

// CMD_SEND_SELF_ADVERT (firmware: companion_radio/MyMesh.cpp):
//   [0x07] alone → zero-hop advert
//   [0x07][1] → flood advert (peers many hops away learn us)
// Sending zero-hop is polite (low airtime), but flood is what makes peers in
// other parts of the mesh able to DM-reply. Default to flood on user-initiated
// adverts; the auto-on-connect advert is also flood so first-time peers see us.
export function buildSendSelfAdvert(flood = true): Buffer {
  return Buffer.from([CMD.SEND_SELF_ADVERT, flood ? 1 : 0]);
}

// CMD_GET_CONTACTS triggers the device's contact-iterator. Replies:
//   RESP_CONTACTS_START [code][count u32 LE]
//   RESP_CONTACT × N (per writeContactRespFrame)
//   RESP_END_OF_CONTACTS [code][most_recent_lastmod u32 LE]
// Optional `since` parameter filters to contacts modified after that lastmod
// (used for incremental sync; omit for a full enumeration).
export function buildGetContacts(since?: number): Buffer {
  if (since === undefined) return Buffer.from([CMD.GET_CONTACTS]);
  const out = Buffer.alloc(5);
  out[0] = CMD.GET_CONTACTS;
  out.writeUInt32LE(since >>> 0, 1);
  return out;
}

// CMD_SET_CHANNEL writes a channel slot. Mirror of RESP_CHANNEL_INFO:
//   [0x20][idx][name 32B null-padded][secret 16B]
// Firmware replies RESP_OK on success, RESP_ERR on rejection. The firmware
// stores whatever bytes we give it — no special-case for empty name / zero
// key — so "delete" is implemented by writing zeros and letting our enumerator
// filter it back out via the all-zero-key empty check in parseChannelInfo.
export function buildSetChannel(idx: number, name: string, secretHex: string): Buffer {
  const out = Buffer.alloc(2 + 32 + 16);
  out[0] = CMD.SET_CHANNEL;
  out[1] = idx & 0xff;
  const nameBuf = Buffer.from(name, 'utf8');
  nameBuf.copy(out, 2, 0, Math.min(nameBuf.length, 32));
  const secret = Buffer.from(secretHex, 'hex');
  if (secret.length !== 16) {
    throw new Error(`channel secret must be 16 bytes, got ${secret.length}`);
  }
  secret.copy(out, 2 + 32);
  return out;
}

// Hashtag and well-known channels derive their shared key as SHA-256(name)[:16].
// Matches meshcore_py and the official mobile app behavior.
export function deriveChannelSecret(name: string): string {
  return createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 32);
}

// CMD_SEND_LOGIN: [0x1a][32B dest pubkey][ASCII password...] (firmware:
// MyMesh.cpp:1500-1521). Firmware appends a null terminator beyond `len`, so we
// pass the password as-is — no need to send a trailing 0.
export function buildSendLogin(destPublicKeyHex: string, password: string): Buffer {
  const pubkey = Buffer.from(destPublicKeyHex, 'hex');
  if (pubkey.length < 32) {
    throw new Error(`login needs full 32B public key, got ${pubkey.length}`);
  }
  const pw = Buffer.from(password, 'utf8');
  const out = Buffer.alloc(1 + 32 + pw.length);
  out[0] = CMD.SEND_LOGIN;
  pubkey.copy(out, 1, 0, 32);
  pw.copy(out, 1 + 32);
  return out;
}

// CMD_LOGOUT: [0x1d][32B dest pubkey]. Firmware MyMesh.cpp:1656-1659.
export function buildLogout(destPublicKeyHex: string): Buffer {
  const pubkey = Buffer.from(destPublicKeyHex, 'hex');
  if (pubkey.length < 32) {
    throw new Error(`logout needs full 32B public key, got ${pubkey.length}`);
  }
  const out = Buffer.alloc(1 + 32);
  out[0] = CMD.LOGOUT;
  pubkey.copy(out, 1, 0, 32);
  return out;
}

// CMD_SEND_ANON_REQ: [0x39][32B dest pubkey][N data bytes]. Firmware requires
// `len > 1 + PUB_KEY_SIZE` (so data must be ≥1 byte). The data sub-type is
// either a password (sub-type byte starts with ASCII), or one of the ANON_REQ
// query types (0x01..0x03). Firmware: MyMesh.cpp:1522-1542.
export function buildSendAnonReq(destPublicKeyHex: string, data: Buffer): Buffer {
  const pubkey = Buffer.from(destPublicKeyHex, 'hex');
  if (pubkey.length < 32) {
    throw new Error(`anon_req needs full 32B public key, got ${pubkey.length}`);
  }
  if (data.length === 0) throw new Error('anon_req data must be ≥1 byte');
  const out = Buffer.alloc(1 + 32 + data.length);
  out[0] = CMD.SEND_ANON_REQ;
  pubkey.copy(out, 1, 0, 32);
  data.copy(out, 1 + 32);
  return out;
}

// Convenience: send an anonymous *password login* to a remote repeater we have
// not yet been admitted to. Body is just the ASCII password (sub-type byte
// happens to be the first password char or 0). Firmware reads data[0] and
// branches on `>= 0x20` (ASCII) for handleLoginReq.
export function buildAnonLogin(destPublicKeyHex: string, password: string): Buffer {
  const body = Buffer.from(password, 'utf8');
  if (body.length === 0) throw new Error('password must not be empty');
  return buildSendAnonReq(destPublicKeyHex, body);
}

// CMD_ADD_UPDATE_CONTACT: serialise a complete contact record back to the radio
// so it overwrites the existing entry. The firmware *replaces* every field
// rather than merging, so callers must echo the current type/flags/name etc.
// when only changing one field. Layout mirrors RESP_CONTACT (see decode.ts
// parseContact) with the leading 0x09 cmd byte. The 12-byte GPS + last-advert
// tail is all-present or all-absent (issue #427 in zjs81/meshcore-open).
export interface UpdateContactInput {
  publicKeyHex: string;
  advType: number;
  flags: number;
  /** Hex string of the out_path bytes (length <= 64). Empty = flood. */
  outPathHex: string;
  /** UTF-8 name; truncated to 31 bytes (leaving room for the null terminator). */
  name: string;
  /** Wall-clock unix seconds for the firmware's `timestamp` slot. Falls back
   *  to `Math.floor(Date.now()/1000)` when unset. */
  timestampUnix?: number;
  /** Optional GPS + last-advert tail. Either ALL provided or ALL omitted. */
  gpsLat?: number;
  gpsLon?: number;
  lastAdvertUnix?: number;
}

export function buildAddUpdateContact(input: UpdateContactInput): Buffer {
  const pubkey = Buffer.from(input.publicKeyHex, 'hex');
  if (pubkey.length < 32) {
    throw new Error(`update contact needs full 32B public key, got ${pubkey.length}`);
  }
  const path = Buffer.from(input.outPathHex, 'hex');
  if (path.length > 64) {
    throw new Error(`out_path is ${path.length}B, max 64`);
  }
  const name = Buffer.from(input.name, 'utf8').subarray(0, 31);

  const hasTail =
    input.gpsLat !== undefined && input.gpsLon !== undefined && input.lastAdvertUnix !== undefined;
  const total = hasTail ? 148 : 136;
  const out = Buffer.alloc(total);
  out[0] = CMD.ADD_UPDATE_CONTACT;
  pubkey.copy(out, 1, 0, 32);
  out[33] = input.advType & 0xff;
  out[34] = input.flags & 0xff;
  out[35] = path.length & 0xff;
  path.copy(out, 36); // remainder of the 64B region stays zero-padded
  name.copy(out, 100);
  const ts = input.timestampUnix ?? Math.floor(Date.now() / 1000);
  out.writeUInt32LE(ts >>> 0, 132);
  if (hasTail) {
    out.writeInt32LE(Math.round((input.gpsLat ?? 0) * 1_000_000), 136);
    out.writeInt32LE(Math.round((input.gpsLon ?? 0) * 1_000_000), 140);
    out.writeUInt32LE((input.lastAdvertUnix ?? 0) >>> 0, 144);
  }
  return out;
}

// CMD_RESET_PATH: [0x0d][32B pubkey]. Drops the contact's out_path → flood.
export function buildResetPath(destPublicKeyHex: string): Buffer {
  const pubkey = Buffer.from(destPublicKeyHex, 'hex');
  if (pubkey.length < 32) {
    throw new Error(`reset path needs full 32B public key, got ${pubkey.length}`);
  }
  const out = Buffer.alloc(1 + 32);
  out[0] = CMD.RESET_PATH;
  pubkey.copy(out, 1, 0, 32);
  return out;
}

// CMD_REMOVE_CONTACT: [0x0f][32B pubkey]. Deletes the contact from the radio's
// on-device store. Replies RESP_OK / RESP_ERR.
export function buildRemoveContact(destPublicKeyHex: string): Buffer {
  const pubkey = Buffer.from(destPublicKeyHex, 'hex');
  if (pubkey.length < 32) {
    throw new Error(`remove contact needs full 32B public key, got ${pubkey.length}`);
  }
  const out = Buffer.alloc(1 + 32);
  out[0] = CMD.REMOVE_CONTACT;
  pubkey.copy(out, 1, 0, 32);
  return out;
}

// CMD_SET_PATH_HASH_MODE: [0x3d][0x00][mode u8]. The 0x00 is a required
// discriminator byte — firmware MyMesh.cpp:1431 gates the handler on
// `cmd_frame[1] == 0 && len >= 3`. mode is 0/1/2 (1/2/3 bytes per hop hash).
// Persists across reboots on the radio side. (Firmware sends
// `_prefs.path_hash_mode + 1` bytes per hop — see MyMesh.cpp:487.)
export function buildSetPathHashMode(mode: number): Buffer {
  const m = mode & 0x03;
  return Buffer.from([CMD.SET_PATH_HASH_MODE, 0x00, m]);
}

/** Convert our per-hop byte size (1|2|3) to the firmware's mode byte (0|1|2). */
export function pathHashSizeToMode(size: 1 | 2 | 3): 0 | 1 | 2 {
  return (size - 1) as 0 | 1 | 2;
}
/** Inverse of pathHashSizeToMode. */
export function pathHashModeToSize(mode: number): 1 | 2 | 3 {
  const m = Math.max(0, Math.min(2, mode));
  return (m + 1) as 1 | 2 | 3;
}

// CMD_SEND_TRACE_PATH: [0x24][tag u32 LE][auth u32 LE][flags u8][path bytes...]
// Firmware checks `len > 10`, so we always emit ≥1 path byte. flags bits 0..1
// encode the per-hop hash size (path length must be multiple of 1<<size).
// Firmware: MyMesh.cpp:1721-1746.
export function buildSendTracePath(opts: {
  tag: number;
  authCode: number;
  flags?: number;
  path: Buffer;
}): Buffer {
  if (opts.path.length === 0) throw new Error('trace path must contain ≥1 byte');
  const flags = (opts.flags ?? 0) & 0xff;
  const out = Buffer.alloc(10 + opts.path.length);
  out[0] = CMD.SEND_TRACE_PATH;
  out.writeUInt32LE(opts.tag >>> 0, 1);
  out.writeUInt32LE(opts.authCode >>> 0, 5);
  out[9] = flags;
  opts.path.copy(out, 10);
  return out;
}

// CMD_GET_STATS: [0x38][subtype]. Subtype is one of STATS_TYPE.{CORE,RADIO,
// PACKETS}. Firmware: MyMesh.cpp:1822-1872.
export function buildGetStats(subtype: (typeof STATS_TYPE)[keyof typeof STATS_TYPE]): Buffer {
  return Buffer.from([CMD.GET_STATS, subtype & 0xff]);
}

// ---- Settings-parity encoders ------------------------------------------
// All payloads sourced from /Users/andy/GitHub/zjs81/meshcore-open
// (lib/connector/meshcore_protocol.dart).

// CMD_SET_ADVERT_NAME: [0x08][utf8 name]. Firmware truncates beyond 31B; we
// truncate client-side too so the wire format matches the official client.
export function buildSetAdvertName(name: string): Buffer {
  const nameBuf = Buffer.from(name, 'utf8').subarray(0, 31);
  const out = Buffer.alloc(1 + nameBuf.length);
  out[0] = CMD.SET_ADVERT_NAME;
  nameBuf.copy(out, 1);
  return out;
}

// CMD_SET_RADIO_PARAMS. firmware ver ≥ 9 accepts a trailing client_repeat byte;
// older firmware rejects the longer frame, so the caller must know the version.
export function buildSetRadioParams(opts: {
  frequencyHz: number;
  bandwidthHz: number;
  spreadingFactor: number;
  codingRate: number;
  /** Repeat (firmware ver ≥ 9). When undefined, the byte is omitted. */
  clientRepeat?: boolean;
}): Buffer {
  const includeRepeat = opts.clientRepeat !== undefined;
  const out = Buffer.alloc(1 + 4 + 4 + 1 + 1 + (includeRepeat ? 1 : 0));
  out[0] = CMD.SET_RADIO_PARAMS;
  out.writeUInt32LE(opts.frequencyHz >>> 0, 1);
  out.writeUInt32LE(opts.bandwidthHz >>> 0, 5);
  out[9] = opts.spreadingFactor & 0xff;
  out[10] = opts.codingRate & 0xff;
  if (includeRepeat) out[11] = opts.clientRepeat ? 1 : 0;
  return out;
}

// CMD_SET_RADIO_TX_POWER: [0x0c][dBm u8]. Firmware clamps to the per-board max.
export function buildSetRadioTxPower(dBm: number): Buffer {
  return Buffer.from([CMD.SET_RADIO_TX_POWER, dBm & 0xff]);
}

// CMD_SET_ADVERT_LATLON: lat/lon as signed micro-degrees.
export function buildSetAdvertLatLon(lat: number, lon: number): Buffer {
  const out = Buffer.alloc(1 + 4 + 4);
  out[0] = CMD.SET_ADVERT_LATLON;
  out.writeInt32LE(Math.round(lat * 1_000_000) | 0, 1);
  out.writeInt32LE(Math.round(lon * 1_000_000) | 0, 5);
  return out;
}

// CMD_REBOOT: literal "reboot" payload after the opcode. Anything else and the
// firmware ignores the write (safety against accidental opcode collisions).
export function buildReboot(): Buffer {
  const tag = Buffer.from('reboot', 'utf8');
  const out = Buffer.alloc(1 + tag.length);
  out[0] = CMD.REBOOT;
  tag.copy(out, 1);
  return out;
}

// CMD_SET_OTHER_PARAMS: telemetry policy + advert-location-policy + multi-acks.
// Layout: [0x26][reserved 0][telemetry_flags u8][advert_loc_policy u8][multi_acks u8].
export interface OtherParamsInput {
  telemetryBase: 0 | 1 | 2;
  telemetryLoc: 0 | 1 | 2;
  telemetryEnv: 0 | 1 | 2;
  /** 1 = share GPS in self-adverts, 0 = withhold. */
  advertLocationPolicy: 0 | 1;
  /** Number of duplicate ACKs to emit per inbound DM (0..2 typical). */
  multiAcks: number;
}
export function buildSetOtherParams(input: OtherParamsInput): Buffer {
  const out = Buffer.alloc(5);
  out[0] = CMD.SET_OTHER_PARAMS;
  out[1] = 0; // reserved
  out[2] =
    ((input.telemetryEnv & 0x03) << 4) |
    ((input.telemetryLoc & 0x03) << 2) |
    (input.telemetryBase & 0x03);
  out[3] = input.advertLocationPolicy & 0x01;
  out[4] = input.multiAcks & 0xff;
  return out;
}

// CMD_GET_CUSTOM_VAR: variable-length key. Empty key returns the full set.
export function buildGetCustomVar(key = ''): Buffer {
  const k = Buffer.from(key, 'utf8');
  const out = Buffer.alloc(1 + k.length);
  out[0] = CMD.GET_CUSTOM_VAR;
  k.copy(out, 1);
  return out;
}

// CMD_SET_CUSTOM_VAR: "key:value" UTF-8. Used for GPS enable / interval and
// other firmware tunables the user-facing UI may surface in the future.
export function buildSetCustomVar(key: string, value: string | number | boolean): Buffer {
  const v = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  const body = Buffer.from(`${key}:${v}`, 'utf8');
  const out = Buffer.alloc(1 + body.length);
  out[0] = CMD.SET_CUSTOM_VAR;
  body.copy(out, 1);
  return out;
}

// Mesh-level admin request encoder. The connected radio wraps this for us via
// CMD_SEND_BINARY_REQ (0x32) — `[0x32][32B pubkey][req_type byte + req_data]`.
// The reply comes back as PUSH_BINARY_RESPONSE tagged with the same u32 the
// firmware echoes in RESP_SENT. Used for REQ_TYPE_GET_ACCESS_LIST,
// REQ_TYPE_GET_NEIGHBOURS, REQ_TYPE_GET_OWNER_INFO — anything other than
// STATUS/TELEMETRY which have dedicated CMD opcodes already.
export function buildSendBinaryReq(destPublicKeyHex: string, reqData: Buffer): Buffer {
  const pubkey = Buffer.from(destPublicKeyHex, 'hex');
  if (pubkey.length < 32) {
    throw new Error(`binary_req needs full 32B public key, got ${pubkey.length}`);
  }
  if (reqData.length === 0) throw new Error('binary_req data must be ≥1 byte');
  const out = Buffer.alloc(1 + 32 + reqData.length);
  out[0] = CMD.SEND_BINARY_REQ;
  pubkey.copy(out, 1, 0, 32);
  reqData.copy(out, 1 + 32);
  return out;
}
