import { Buffer } from 'node:buffer';
import { CMD, type STATS_TYPE, TXT_TYPE } from './codes';

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

// CMD_REBOOT: literal "reboot" payload after the opcode. Anything else and the
// firmware ignores the write (safety against accidental opcode collisions).
export function buildReboot(): Buffer {
  const tag = Buffer.from('reboot', 'utf8');
  const out = Buffer.alloc(1 + tag.length);
  out[0] = CMD.REBOOT;
  tag.copy(out, 1);
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
