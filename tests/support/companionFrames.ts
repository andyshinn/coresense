import { Buffer } from 'node:buffer';
import { Protocol } from '@andyshinn/meshcore-ts';

// Encoders for the inbound companion frames the integration tests feed through
// a Loopback transport. One encoder per frame, each documenting its byte layout
// once, with codes taken from the library's own Protocol tables rather than
// hex literals. Layouts follow firmware companion_radio/MyMesh.cpp.

const { RESP, PUSH, TXT_TYPE } = Protocol;

/** `out_path_len` = OUT_PATH_UNKNOWN: the radio knows no route to this node and
 *  floods. NOT "direct" — a direct (zero-hop) route is 0x00. No path bytes
 *  follow it. */
export const OUT_PATH_UNKNOWN = 0xff;

/** The pubkey `contactsSync` gives record `i`: its index byte repeated, so
 *  every record also has a distinct first byte. One byte, so `i` stops at 255:
 *  past that the hex goes odd-length and Buffer.from() silently truncates it
 *  into a colliding key. */
export function syncPubkey(i: number): string {
  if (!Number.isInteger(i) || i < 0 || i > 0xff) throw new RangeError(`syncPubkey: ${i} does not fit one byte`);
  return i.toString(16).padStart(2, '0').repeat(32);
}

export interface ContactRecordOptions {
  /** Frame code. RESP.CONTACT for a GET_CONTACTS walk (the radio stores this
   *  node), PUSH.NEW_ADVERT for an advert the radio heard but did not store. */
  code?: number;
  /** ADV_TYPE: 1 chat (default), 2 repeater, 3 room, 4 sensor. */
  type?: number;
  /** Packed out_path_len, `((hashSize - 1) << 6) | hops`. Defaults to
   *  OUT_PATH_UNKNOWN. */
  outPathLen?: number;
  /** The out_path bytes themselves, written from offset 36. */
  outPathHex?: string;
  /** Written only when given; otherwise left 0. */
  lastAdvertUnix?: number;
}

/** The 148-byte contact record that RESP_CONTACT and PUSH_NEW_ADVERT share;
 *  only the code byte differs.
 *    [0]        code
 *    [1..32]    public key
 *    [33]       ADV_TYPE
 *    [34]       flags
 *    [35]       out_path_len, packed: bits 7-6 hashSize-1, bits 5-0 hop count;
 *               0xFF = OUT_PATH_UNKNOWN (flood)
 *    [36..99]   out_path
 *    [100..131] advert name, NUL-padded
 *    [132..135] last_advert u32 LE
 *    [136..147] lat i32, lon i32, lastmod u32 (left zero) */
export function contactRecord(pubkeyHex: string, name: string, opts: ContactRecordOptions = {}): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = opts.code ?? RESP.CONTACT;
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  frame[33] = opts.type ?? Protocol.ADV_TYPE.CHAT;
  frame[35] = opts.outPathLen ?? OUT_PATH_UNKNOWN;
  if (opts.outPathHex) Buffer.from(opts.outPathHex, 'hex').copy(frame, 36);
  Buffer.from(name, 'utf8').copy(frame, 100);
  if (opts.lastAdvertUnix !== undefined) frame.writeUInt32LE(opts.lastAdvertUnix, 132);
  return frame;
}

/** RESP_CONTACT: a record from a GET_CONTACTS walk. The lib ingests it with
 *  source 'sync', which seeds its contact map (so hasRadioContact passes) and
 *  marks the contact on-radio in coresense's mirror. A walk is the radio
 *  listing what it stores, not a reception, so last_heard_ms stays 0. */
export function contactSyncFrame(pubkeyHex: string, name: string, opts: Omit<ContactRecordOptions, 'code'> = {}): Buffer {
  return contactRecord(pubkeyHex, name, { ...opts, code: RESP.CONTACT });
}

/** PUSH_NEW_ADVERT: a node whose advert we just heard and the radio did NOT
 *  store (firmware `BaseChatMesh::onAdvertRecv` refusal paths). */
export function newAdvertFrame(pubkeyHex: string, name: string, opts: Omit<ContactRecordOptions, 'code'> = {}): Buffer {
  return contactRecord(pubkeyHex, name, { ...opts, code: PUSH.NEW_ADVERT });
}

/** PUSH_ADVERT: [0x80][pubkey 32B]. The advertiser IS in the radio's contact
 *  store — including a node it auto-added microseconds ago, which is why the
 *  pubkey can be one we have never seen. */
export function pushAdvert(pubkeyHex: string): Buffer {
  return Buffer.concat([Buffer.from([PUSH.ADVERT]), Buffer.from(pubkeyHex, 'hex')]);
}

/** A bare [code][u32 LE] frame: RESP_CONTACTS_START (total) and
 *  RESP_END_OF_CONTACTS (most recent lastmod) both have this shape. */
export function u32Frame(code: number, value: number): Buffer {
  const frame = Buffer.alloc(5);
  frame[0] = code;
  frame.writeUInt32LE(value, 1);
  return frame;
}

/** A complete GET_CONTACTS iteration of `n` records: CONTACTS_START, then
 *  record i = `syncPubkey(i)` named `Node i` with last_advert 1_750_000_000 + i,
 *  then END_OF_CONTACTS. */
export function contactsSync(n: number): Buffer[] {
  const records = Array.from({ length: n }, (_, i) =>
    contactSyncFrame(syncPubkey(i), `Node ${i}`, { lastAdvertUnix: 1_750_000_000 + i }),
  );
  return [u32Frame(RESP.CONTACTS_START, n), ...records, u32Frame(RESP.END_OF_CONTACTS, n)];
}

export interface MsgV3Options {
  /** SNR ×4 as a signed byte (byte 1). */
  snrQ?: number;
  /** Bytes 2-3. Firmware hardcodes both to 0 (`reserved1`/`reserved2`); they
   *  are NOT rssi. Set non-zero only to prove a decoder ignores them. */
  reserved?: number;
  /** TXT_TYPE: PLAIN (default), CLI_DATA for a repeater CLI reply. */
  txtType?: number;
}

/** RESP_CHANNEL_MSG_RECV_V3: [0x11][snr*4 i8][rsv][rsv][channel idx]
 *  [path_len][txt_type][ts u32 LE][body]. path_len is OUT_PATH_UNKNOWN (no
 *  mesh path observed). */
export function channelMsgV3(idx: number, ts: number, body: string, opts: MsgV3Options = {}): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(11 + text.length);
  frame[0] = RESP.CHANNEL_MSG_RECV_V3;
  frame.writeInt8(opts.snrQ ?? 48, 1); // 48 → 12 dB
  frame.writeInt8(opts.reserved ?? 0, 2);
  frame.writeInt8(opts.reserved ?? 0, 3);
  frame[4] = idx;
  frame[5] = OUT_PATH_UNKNOWN;
  frame[6] = opts.txtType ?? TXT_TYPE.PLAIN;
  frame.writeUInt32LE(ts, 7);
  text.copy(frame, 11);
  return frame;
}

/** RESP_CHANNEL_MSG_RECV (V1): no signal header at all —
 *  [0x08][channel idx][path_len][txt_type][ts u32 LE][body]. */
export function channelMsgV1(idx: number, ts: number, body: string): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(8 + text.length);
  frame[0] = RESP.CHANNEL_MSG_RECV;
  frame[1] = idx;
  frame[2] = OUT_PATH_UNKNOWN;
  frame[3] = TXT_TYPE.PLAIN;
  frame.writeUInt32LE(ts, 4);
  text.copy(frame, 8);
  return frame;
}

/** RESP_CONTACT_MSG_RECV_V3: [0x10][snr*4 i8][rsv][rsv][6B sender pubkey
 *  prefix][path_len][txt_type][ts u32 LE][body]. A DM, or with
 *  `txtType: CLI_DATA` a repeater's CLI reply. */
export function contactMsgV3(prefixHex: string, ts: number, body: string, opts: MsgV3Options = {}): Buffer {
  const text = Buffer.from(body, 'utf8');
  const frame = Buffer.alloc(16 + text.length);
  frame[0] = RESP.CONTACT_MSG_RECV_V3;
  frame.writeInt8(opts.snrQ ?? 40, 1); // 40 → 10 dB
  frame.writeInt8(opts.reserved ?? 0, 2);
  frame.writeInt8(opts.reserved ?? 0, 3);
  Buffer.from(prefixHex, 'hex').copy(frame, 4);
  frame[10] = OUT_PATH_UNKNOWN;
  frame[11] = opts.txtType ?? TXT_TYPE.PLAIN;
  frame.writeUInt32LE(ts, 12);
  text.copy(frame, 16);
  return frame;
}

/** RESP_ADVERT_PATH: [0x16][recv_timestamp u32 LE][path_len u8][path].
 *  path_len is the packed byte (bits 5-0 hop count, bits 7-6 hashSize-1),
 *  except OUT_PATH_UNKNOWN, which is not a length at all: "this ring entry has
 *  no path", with no path bytes after it. Taken raw so a test can put that
 *  sentinel on the wire. */
export function advertPathReply(recvUnix: number, pathLenByte: number, pathHex = ''): Buffer {
  const path = Buffer.from(pathHex, 'hex');
  const frame = Buffer.alloc(6 + path.length);
  frame[0] = RESP.ADVERT_PATH;
  frame.writeUInt32LE(recvUnix, 1);
  frame[5] = pathLenByte;
  path.copy(frame, 6);
  return frame;
}

/** RESP_SENT: [0x06][flood][expected_ack / tag u32][est_timeout u32 LE]. */
export function respSent(tagHex: string): Buffer {
  const frame = Buffer.alloc(10);
  frame[0] = RESP.SENT;
  frame[1] = 1;
  Buffer.from(tagHex, 'hex').copy(frame, 2);
  frame.writeUInt32LE(5000, 6);
  return frame;
}

/** RESP_STATS, CORE subtype: [0x18][0][battMv u16][uptime u32][errFlags u16]
 *  [queueLen u8], all LE. */
export function localStatsCore(stats: { battMv: number; uptimeSecs: number; queueLen: number }): Buffer {
  const frame = Buffer.alloc(11);
  frame[0] = RESP.STATS;
  frame[1] = Protocol.STATS_TYPE.CORE;
  frame.writeUInt16LE(stats.battMv, 2);
  frame.writeUInt32LE(stats.uptimeSecs, 4);
  frame.writeUInt16LE(0, 8);
  frame.writeUInt8(stats.queueLen, 10);
  return frame;
}

/** PUSH_LOGIN_SUCCESS, short form: [0x85][perms][6B prefix]. */
export function loginSuccess(prefixHex: string, perms = 1): Buffer {
  const frame = Buffer.alloc(8);
  frame[0] = PUSH.LOGIN_SUCCESS;
  frame[1] = perms;
  Buffer.from(prefixHex, 'hex').copy(frame, 2);
  return frame;
}

/** PUSH_LOGIN_SUCCESS, v6+ form: [0x85][is_admin][6B prefix][tag u32]
 *  [acl_perms][fw_ver]. Byte 1 is a plain boolean; byte 12 is the ACL byte
 *  whose low 2 bits are a role. */
export function loginSuccessV6(prefixHex: string, aclPerms: number, isAdmin = 0): Buffer {
  const frame = Buffer.alloc(14);
  frame[0] = PUSH.LOGIN_SUCCESS;
  frame[1] = isAdmin;
  Buffer.from(prefixHex, 'hex').copy(frame, 2);
  Buffer.from('0badcafe', 'hex').copy(frame, 8);
  frame[12] = aclPerms;
  frame[13] = 2; // firmware ver level
  return frame;
}

/** PUSH_BINARY_RESPONSE: [0x8c][0][tag u32][payload]. */
export function binaryResponse(tagHex: string, body: Buffer | string): Buffer {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  return Buffer.concat([Buffer.from([PUSH.BINARY_RESPONSE, 0x00]), Buffer.from(tagHex, 'hex'), payload]);
}

/** The firmware's `struct RepeaterStats`, memcpy'd onto the wire — 56 bytes on
 *  v1.12.0+, 52 on older builds (no n_recv_errors). Built member-by-member to
 *  match docs/firmware/MyMeshRepeater.cpp, so a future layout drift fails the
 *  decoded-value assertions instead of passing silently. */
export function repeaterStats(): Buffer {
  const s = Buffer.alloc(56);
  s.writeUInt16LE(4020, 0); // batt_milli_volts → 4.02 V
  s.writeUInt16LE(3, 2); // curr_tx_queue_len
  s.writeInt16LE(-108, 4); // noise_floor
  s.writeInt16LE(-92, 6); // last_rssi
  s.writeUInt32LE(18432, 8); // n_packets_recv
  s.writeUInt32LE(9211, 12); // n_packets_sent
  s.writeUInt32LE(4321, 16); // total_air_time_secs
  s.writeUInt32LE(432_000, 20); // total_up_time_secs → 5d 0h 0m
  s.writeUInt32LE(120, 24); // n_sent_flood
  s.writeUInt32LE(45, 28); // n_sent_direct
  s.writeUInt32LE(900, 32); // n_recv_flood
  s.writeUInt32LE(310, 36); // n_recv_direct
  s.writeUInt16LE(2, 40); // err_events
  s.writeInt16LE(28, 42); // last_snr ×4 → 7 dB
  s.writeUInt16LE(310, 44); // n_direct_dups
  s.writeUInt16LE(1400, 46); // n_flood_dups
  s.writeUInt32LE(88_000, 48); // total_rx_air_time_secs
  s.writeUInt32LE(17, 52); // n_recv_errors
  return s;
}

/** PUSH_STATUS_RESPONSE: [0x87][0][6B prefix][RepeaterStats]. */
export function statusResponse(prefixHex: string, stats: Buffer = repeaterStats()): Buffer {
  return Buffer.concat([Buffer.from([PUSH.STATUS_RESPONSE, 0x00]), Buffer.from(prefixHex, 'hex'), stats]);
}

/** PUSH_TELEMETRY_RESPONSE: [0x8b][0][6B prefix][CayenneLPP]. The default LPP
 *  is one reading: channel 0 voltage, 4.20 V. */
export function telemetryResponse(prefixHex: string, lpp: Buffer = Buffer.from([0x00, 0x74, 0x01, 0xa4])): Buffer {
  return Buffer.concat([Buffer.from([PUSH.TELEMETRY_RESPONSE, 0x00]), Buffer.from(prefixHex, 'hex'), lpp]);
}
