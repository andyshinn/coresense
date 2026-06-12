import { Buffer } from 'node:buffer';
import { advTypeToKind, hopsFromOutPathLen } from '../../../shared/contacts/discovered';
import type { Contact } from '../../../shared/types';
import { emit } from '../../events/bus';
import { child } from '../../log';
import { stateHolder } from '../../state/holder';
import { discoveredStore } from '../../storage/discoveredContacts';
import { ADV_TYPE, CMD } from '../codes';
import type { FeatureContext } from '../feature';

const log = child('protocol');

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

// ---- Ingest / app-logic ------------------------------------------------

let resyncTimer: NodeJS.Timeout | null = null;

/** Push the full discovered pool to the renderer. */
export function emitDiscovered(): void {
  const holder = stateHolder();
  emit.discovered(
    discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()),
  );
}

/** Whether the firmware would auto-store an advert of this ADV_TYPE, given the
 *  current auto-add config. Used to decide whether to re-sync after a
 *  not-on-radio advert. */
export function shouldAutoAdd(advType: number): boolean {
  const cfg = stateHolder().getAutoAddConfig();
  if (cfg.mode === 'all') return true;
  switch (advType) {
    case ADV_TYPE.REPEATER:
      return cfg.repeater;
    case ADV_TYPE.ROOM:
      return cfg.room;
    case ADV_TYPE.SENSOR:
      return cfg.sensor;
    default:
      return cfg.chat;
  }
}

/** Debounced full re-sync (CMD_GET_CONTACTS) after an auto-addable advert. */
export function scheduleContactsResync(ctx: FeatureContext): void {
  if (resyncTimer) return;
  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    void ctx.writeFrame(encodeGetContacts()).catch((err) => {
      log.warn(`contacts re-sync failed: ${(err as Error).message}`);
    });
  }, 1500);
}

/** Upsert a contact from a RESP_CONTACT / PUSH_NEW_ADVERT frame. When the
 *  contact matches an existing placeholder (`c:<6-byte-prefix>`), the
 *  placeholder is removed; messages already keyed to the placeholder stay
 *  there (cheap to leave — future cleanup can migrate them). */
export function upsertOnRadioContact(record: ContactRecord): void {
  const holder = stateHolder();
  const fullKey = `c:${record.publicKeyHex}`;
  const prefix6 = record.publicKeyHex.slice(0, 12);
  const existing = holder.getContacts().find((c) => c.key === fullKey);
  // The radio re-pushes the full contact record on every advert; preserve
  // local-only fields the firmware doesn't know about.
  const hashSize = holder.getRadioSettings().pathHashMode;
  const advertOutPathHex = record.outPathLen === 0xff ? '' : record.outPathHex;
  // Don't let a stray advert that reports "no path" wipe a path the user
  // just set manually — the firmware can occasionally re-emit a contact
  // entry with path_len=0 right after we write CMD_ADD_UPDATE_CONTACT (the
  // advert was generated mid-flight). Only allow overwrites when the advert
  // carries a non-empty path, OR when the existing entry wasn't manually
  // set. Auto-learned paths (pathManual=false) still defer to firmware.
  const newOutPathHex =
    advertOutPathHex.length === 0 && existing?.pathManual === true
      ? (existing.outPathHex ?? '')
      : advertOutPathHex;
  const pathChanged = (existing?.outPathHex ?? '') !== newOutPathHex;

  const contact: Contact = {
    key: fullKey,
    publicKeyHex: record.publicKeyHex,
    name: record.name || record.publicKeyHex.slice(0, 12),
    kind: advTypeToKind(record.type),
    lastSeenMs: record.lastAdvertUnix > 0 ? record.lastAdvertUnix * 1000 : existing?.lastSeenMs,
    hops: hopsFromOutPathLen(record.outPathLen),
    pinned: existing?.pinned,
    muted: existing?.muted,
    favourite: (record.flags & 0x01) !== 0,
    outPathHex: newOutPathHex || undefined,
    outPathHashSize: newOutPathHex ? hashSize : existing?.outPathHashSize,
    preferDirect: existing?.preferDirect,
    // If the radio's view of the path drifted away from a path the user set
    // by hand, drop the manual flag — the firmware is the source of truth.
    pathManual: pathChanged ? false : existing?.pathManual,
    pathLearnedAt: pathChanged && newOutPathHex ? Date.now() : existing?.pathLearnedAt,
    // Adverts carry the radio's last GPS fix. 0/0 is the firmware default for
    // radios without a GPS module — treat as "no fix" and fall back to the
    // last known position instead of nuking it.
    gpsLat: record.gpsLat !== 0 || record.gpsLon !== 0 ? record.gpsLat : existing?.gpsLat,
    gpsLon: record.gpsLat !== 0 || record.gpsLon !== 0 ? record.gpsLon : existing?.gpsLon,
  };
  holder.upsertContact(contact);

  // Reconcile a synth placeholder we created for a prior incoming DM whose
  // sender we hadn't seen an advert for yet.
  const placeholderKey = `c:${prefix6}`;
  if (placeholderKey !== fullKey && holder.getContacts().some((c) => c.key === placeholderKey)) {
    holder.removeContact(placeholderKey);
    log.debug(`reconciled placeholder ${placeholderKey} → ${fullKey}`);
  }

  emit.contacts(holder.getContacts());
}

/** Upsert a contact heard from RESP_CONTACT (sync, on-radio) or
 *  PUSH_NEW_ADVERT (live advert — on-radio only if already in the store).
 *  Always records into the discovered pool with an app-tracked first-heard. */
export function ingestContact(
  ctx: FeatureContext,
  record: ContactRecord,
  source: 'sync' | 'advert',
): void {
  const holder = stateHolder();
  const fullKey = `c:${record.publicKeyHex}`;
  const alreadyOnRadio = holder.getContacts().some((c) => c.key === fullKey);
  const onRadio = source === 'sync' ? true : alreadyOnRadio;

  // First-ever sighting: no row in the discovered pool yet (checked before
  // the upsert below). Only a live advert is a "discovery" — a GET_CONTACTS
  // sync is just the device listing what it already stores.
  const isNewDiscovery = source === 'advert' && discoveredStore.get(record.publicKeyHex) === null;

  discoveredStore.upsert(record, {
    onRadio,
    nowMs: Date.now(),
    heardLive: source === 'advert',
  });

  if (onRadio) {
    upsertOnRadioContact(record);
  }
  emitDiscovered();

  if (isNewDiscovery) {
    emit.contactDiscovered({
      key: fullKey,
      name: record.name || record.publicKeyHex.slice(0, 12),
      kind: advTypeToKind(record.type),
    });
  }

  if (source === 'advert' && !onRadio && shouldAutoAdd(record.type)) {
    scheduleContactsResync(ctx);
  }
}
