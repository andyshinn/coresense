import { Buffer } from 'node:buffer';
import { CMD } from '../codes';

// ---- Wire types --------------------------------------------------------

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

// CMD_ADD_UPDATE_CONTACT serialises a complete contact record (see
// encodeAddUpdateContact). The firmware *replaces* every field rather than
// merging, so callers must echo the current type/flags/name etc. when only
// changing one field.
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

// ---- Encoders ----------------------------------------------------------

// CMD_GET_CONTACTS: enumerate the radio's contact store. Replies are
//   RESP_CONTACTS_START [code][count u32 LE]
//   RESP_CONTACT × N (per writeContactRespFrame)
//   RESP_END_OF_CONTACTS [code][most_recent_lastmod u32 LE]
// Optional `since` parameter filters to contacts modified after that lastmod
// (used for incremental sync; omit for a full enumeration).
export function encodeGetContacts(since?: number): Buffer {
  if (since === undefined) return Buffer.from([CMD.GET_CONTACTS]);
  const out = Buffer.alloc(5);
  out[0] = CMD.GET_CONTACTS;
  out.writeUInt32LE(since >>> 0, 1);
  return out;
}

// CMD_ADD_UPDATE_CONTACT: serialise a complete contact record back to the radio
// so it overwrites the existing entry. Layout mirrors RESP_CONTACT (see
// decodeContact) with the leading cmd byte. The 12-byte GPS + last-advert tail
// is all-present or all-absent (issue #427 in zjs81/meshcore-open).
export function encodeAddUpdateContact(input: UpdateContactInput): Buffer {
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
export function encodeResetPath(destPublicKeyHex: string): Buffer {
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
export function encodeRemoveContact(destPublicKeyHex: string): Buffer {
  const pubkey = Buffer.from(destPublicKeyHex, 'hex');
  if (pubkey.length < 32) {
    throw new Error(`remove contact needs full 32B public key, got ${pubkey.length}`);
  }
  const out = Buffer.alloc(1 + 32);
  out[0] = CMD.REMOVE_CONTACT;
  pubkey.copy(out, 1, 0, 32);
  return out;
}

// ---- Decoders ----------------------------------------------------------

const CONTACT_FRAME_LEN = 1 + 32 + 1 + 1 + 1 + 64 + 32 + 4 + 4 + 4 + 4; // 148

export function decodeContact(frame: Buffer): ContactRecord | null {
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
export function decodeContactsStart(frame: Buffer): number | null {
  if (frame.length < 5) return null;
  return frame.readUInt32LE(1);
}

// RESP_END_OF_CONTACTS [0x04][most_recent_lastmod u32 LE]
export function decodeEndOfContacts(frame: Buffer): number | null {
  if (frame.length < 5) return null;
  return frame.readUInt32LE(1);
}

// PUSH_CODE_CONTACT_DELETED [0x8f][32B pubkey] — firmware evicted a contact
// (overwrite-oldest). Returns the lowercase hex public key, or null if short.
export function decodeContactDeleted(frame: Buffer): string | null {
  if (frame.length < 1 + 32) return null;
  return frame.subarray(1, 33).toString('hex');
}
