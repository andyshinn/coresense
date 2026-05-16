import type { Buffer } from 'node:buffer';

// PUSH_LOGIN_SUCCESS (firmware: companion_radio/MyMesh.cpp:669-685). Two
// shapes exist on the wire:
//   - Legacy: [0x85][0 is_admin][6B pubkey prefix]                       (8B)
//   - v6+:    [0x85][perms u8][6B prefix][tag u32 LE][acl_perms u8][fw_ver u8] (15B)
// The longer form is the one current firmware sends; we tolerate the short
// form so older repeaters still parse.
export interface LoginSuccess {
  permissions: number;
  pubKeyPrefixHex: string;
  serverTagHex: string | null;
  aclPermissions: number | null;
  firmwareVerLevel: number | null;
  isAdmin: boolean;
}

export function parseLoginSuccess(frame: Buffer): LoginSuccess | null {
  if (frame.length < 8) return null;
  const permissions = frame[1];
  const pubKeyPrefixHex = frame.subarray(2, 8).toString('hex');
  if (frame.length >= 15) {
    return {
      permissions,
      pubKeyPrefixHex,
      serverTagHex: frame.subarray(8, 12).toString('hex'),
      aclPermissions: frame[12],
      firmwareVerLevel: frame[13],
      // Firmware sets permissions == data[6] from the remote response; the
      // ACL_ADMIN bit lives in aclPermissions (data[7]). Treat either being
      // set as admin so legacy + new shapes both work.
      isAdmin: (permissions & 0x01) !== 0 || (frame[12] & 0x01) !== 0,
    };
  }
  return {
    permissions,
    pubKeyPrefixHex,
    serverTagHex: null,
    aclPermissions: null,
    firmwareVerLevel: null,
    isAdmin: permissions !== 0,
  };
}

// PUSH_LOGIN_FAIL: [0x86][0 reserved][6B pubkey prefix].
export interface LoginFail {
  pubKeyPrefixHex: string;
}

export function parseLoginFail(frame: Buffer): LoginFail | null {
  if (frame.length < 8) return null;
  return { pubKeyPrefixHex: frame.subarray(2, 8).toString('hex') };
}

// PUSH_RAW_DATA: [0x84][snr*4 i8][rssi i8][0xff reserved][raw bytes].
export interface RawData {
  snrDb: number;
  rssi: number;
  payloadHex: string;
}

export function parseRawData(frame: Buffer): RawData | null {
  if (frame.length < 4) return null;
  return {
    snrDb: frame.readInt8(1) / 4,
    rssi: frame.readInt8(2),
    payloadHex: frame.subarray(4).toString('hex'),
  };
}

// PUSH_BINARY_RESPONSE: [0x8c][0 reserved][tag u32 LE][response bytes...].
// The `tag` matches the u32 the firmware echoed in RESP_SENT for the
// originating CMD_SEND_ANON_REQ / CMD_SEND_BINARY_REQ — use it to route the
// response back to the awaiter.
export interface BinaryResponse {
  tagHex: string;
  payloadHex: string;
  payload: Buffer;
}

export function parseBinaryResponse(frame: Buffer): BinaryResponse | null {
  if (frame.length < 6) return null;
  const payload = frame.subarray(6);
  return {
    tagHex: frame.subarray(2, 6).toString('hex'),
    payloadHex: payload.toString('hex'),
    payload,
  };
}

// PUSH_TRACE_DATA frame layout, firmware MyMesh.cpp:812-825. The path-hash
// size is encoded in flags bits 0..1; per-hop SNR bytes follow the hashes,
// then a trailing "final SNR" byte for the last leg.
export interface TraceData {
  pubKeyPrefixHex: string;
  tagHex: string;
  authHex: string;
  flags: number;
  pathHashSize: number;
  hops: Array<{ hashHex: string; snrDb: number }>;
  finalSnrDb: number;
}

export function parseTraceData(frame: Buffer): TraceData | null {
  if (frame.length < 12) return null;
  const pubKeyPrefixHex = frame.subarray(2, 8).toString('hex');
  const pathLen = frame[8];
  const flags = frame[9];
  const pathHashSize = 1 << (flags & 0x03);
  const tagHex = frame.subarray(10, 14).toString('hex');
  if (frame.length < 18) return null;
  const authHex = frame.subarray(14, 18).toString('hex');
  const hashesStart = 18;
  if (frame.length < hashesStart + pathLen) return null;
  const hopCount = pathHashSize > 0 ? Math.floor(pathLen / pathHashSize) : 0;
  const snrsStart = hashesStart + pathLen;
  if (frame.length < snrsStart + hopCount + 1) return null;
  const hops: Array<{ hashHex: string; snrDb: number }> = [];
  for (let i = 0; i < hopCount; i += 1) {
    const hash = frame.subarray(
      hashesStart + i * pathHashSize,
      hashesStart + (i + 1) * pathHashSize,
    );
    hops.push({ hashHex: hash.toString('hex'), snrDb: frame.readInt8(snrsStart + i) / 4 });
  }
  const finalSnrDb = frame.readInt8(snrsStart + hopCount) / 4;
  return { pubKeyPrefixHex, tagHex, authHex, flags, pathHashSize, hops, finalSnrDb };
}

// Full 59-byte RepeaterStats decode (firmware: companion_radio/MyMeshRepeater.cpp
// handleRequest REQ_TYPE_GET_STATUS reply, MyMesh.cpp:700-707 wraps it into a
// PUSH_STATUS_RESPONSE frame with [0x87][0][6B prefix][stats...]).
//
// Field layout matches the C struct memcpy order. Offsets are relative to the
// start of the stats blob (i.e. after the 8-byte PUSH_STATUS_RESPONSE header).
export interface RepeaterStats {
  battMv: number;
  txQueueLen: number;
  noiseFloor: number;
  lastRssi: number;
  nPacketsRecv: number;
  nPacketsSent: number;
  totalAirSecs: number;
  uptimeSecs: number;
  nSentFlood: number;
  nSentDirect: number;
  nRecvFlood: number;
  nRecvDirect: number;
  errEvents: number;
  lastSnrDb: number;
  nDirectDups: number;
  nFloodDups: number;
  totalRxAirSecs: number;
  nRecvErrors: number;
}

export function parseRepeaterStatsBlob(b: Buffer): RepeaterStats | null {
  if (b.length < 59) return null;
  return {
    battMv: b.readUInt16LE(0),
    txQueueLen: b.readUInt8(2),
    noiseFloor: b.readInt16LE(3),
    lastRssi: b.readInt16LE(5),
    nPacketsRecv: b.readUInt32LE(7),
    nPacketsSent: b.readUInt32LE(11),
    totalAirSecs: b.readUInt32LE(15),
    uptimeSecs: b.readUInt32LE(19),
    nSentFlood: b.readUInt32LE(23),
    nSentDirect: b.readUInt32LE(27),
    nRecvFlood: b.readUInt32LE(31),
    nRecvDirect: b.readUInt32LE(35),
    errEvents: b.readUInt16LE(39),
    lastSnrDb: b.readInt16LE(41) / 4,
    nDirectDups: b.readUInt32LE(43),
    nFloodDups: b.readUInt32LE(47),
    totalRxAirSecs: b.readUInt32LE(51),
    nRecvErrors: b.readUInt32LE(55),
  };
}

// ACL list response body (inside PUSH_BINARY_RESPONSE payload, after the 4B
// tag we already stripped in parseBinaryResponse). Repeating 7-byte entries:
//   [6B pubkey prefix][1B perms]
// Firmware: MyMeshRepeater.cpp:265-277.
export interface AclEntry {
  pubKeyPrefixHex: string;
  permissions: number;
  isAdmin: boolean;
  isGuest: boolean;
}

export function parseAclList(payload: Buffer): AclEntry[] {
  const out: AclEntry[] = [];
  for (let i = 0; i + 7 <= payload.length; i += 7) {
    const perms = payload[i + 6];
    out.push({
      pubKeyPrefixHex: payload.subarray(i, i + 6).toString('hex'),
      permissions: perms,
      isAdmin: (perms & 0x01) !== 0,
      isGuest: (perms & 0x02) !== 0,
    });
  }
  return out;
}

// Neighbours response body (inside PUSH_BINARY_RESPONSE payload, after the
// tag). Firmware: MyMeshRepeater.cpp:279-374. Layout:
//   [total u16 LE][returned u16 LE]
//   then per-entry: [prefix (prefixLen bytes)][heard_secs_ago u32 LE][snr i8]
// The prefix length is whatever we asked for in the request; we re-use it
// here so the caller doesn't have to thread it through.
export interface Neighbour {
  pubKeyPrefixHex: string;
  heardSecsAgo: number;
  snrDb: number;
}

export interface NeighboursPage {
  total: number;
  neighbours: Neighbour[];
}

export function parseNeighbours(payload: Buffer, prefixLen: number): NeighboursPage | null {
  if (payload.length < 4) return null;
  const total = payload.readUInt16LE(0);
  const returned = payload.readUInt16LE(2);
  const entrySize = prefixLen + 4 + 1;
  const neighbours: Neighbour[] = [];
  let off = 4;
  for (let i = 0; i < returned; i += 1) {
    if (off + entrySize > payload.length) break;
    neighbours.push({
      pubKeyPrefixHex: payload.subarray(off, off + prefixLen).toString('hex'),
      heardSecsAgo: payload.readUInt32LE(off + prefixLen),
      snrDb: payload.readInt8(off + prefixLen + 4) / 4,
    });
    off += entrySize;
  }
  return { total, neighbours };
}

// Owner info response body: ASCII text — firmware version, node name, owner
// info — separated by newlines, optionally null-terminated. Firmware:
// MyMeshRepeater.cpp:375-377.
export interface OwnerInfo {
  firmwareVersion: string;
  nodeName: string;
  ownerInfo: string;
}

export function parseOwnerInfo(payload: Buffer): OwnerInfo {
  const nullIdx = payload.indexOf(0);
  const text = (nullIdx === -1 ? payload : payload.subarray(0, nullIdx)).toString('utf8');
  const lines = text.split(/\r?\n/);
  return {
    firmwareVersion: lines[0] ?? '',
    nodeName: lines[1] ?? '',
    ownerInfo: lines.slice(2).join('\n'),
  };
}

// RESP_CODE_STATS reply to CMD_GET_STATS. Second byte is the subtype echo;
// remaining bytes depend on subtype. Firmware: MyMesh.cpp:1822-1872.
export type LocalStats =
  | {
      kind: 'core';
      battMv: number;
      uptimeSecs: number;
      errFlags: number;
      queueLen: number;
    }
  | {
      kind: 'radio';
      noiseFloor: number;
      lastRssi: number;
      lastSnrDb: number;
      txAirSecs: number;
      rxAirSecs: number;
    }
  | {
      kind: 'packets';
      recv: number;
      sent: number;
      nSentFlood: number;
      nSentDirect: number;
      nRecvFlood: number;
      nRecvDirect: number;
      nRecvErrors: number;
    };

export function parseLocalStats(frame: Buffer): LocalStats | null {
  if (frame.length < 2) return null;
  const subtype = frame[1];
  const b = frame.subarray(2);
  if (subtype === 0x00 && b.length >= 9) {
    return {
      kind: 'core',
      battMv: b.readUInt16LE(0),
      uptimeSecs: b.readUInt32LE(2),
      errFlags: b.readUInt16LE(6),
      queueLen: b.readUInt8(8),
    };
  }
  if (subtype === 0x01 && b.length >= 12) {
    return {
      kind: 'radio',
      noiseFloor: b.readInt16LE(0),
      lastRssi: b.readInt8(2),
      lastSnrDb: b.readInt8(3) / 4,
      txAirSecs: b.readUInt32LE(4),
      rxAirSecs: b.readUInt32LE(8),
    };
  }
  if (subtype === 0x02 && b.length >= 28) {
    return {
      kind: 'packets',
      recv: b.readUInt32LE(0),
      sent: b.readUInt32LE(4),
      nSentFlood: b.readUInt32LE(8),
      nSentDirect: b.readUInt32LE(12),
      nRecvFlood: b.readUInt32LE(16),
      nRecvDirect: b.readUInt32LE(20),
      nRecvErrors: b.readUInt32LE(24),
    };
  }
  return null;
}
