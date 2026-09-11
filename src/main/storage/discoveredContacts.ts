import type { Models } from '@andyshinn/meshcore-ts';
import {
  advTypeToKind,
  contactMatchesAnyBlockRule,
  type DiscoveredContact,
  hashSizeFromOutPathLen,
  hopsFromOutPathLen,
} from '../../shared/contacts/discovered';
import type { BlockRule } from '../../shared/types';
import { openDb } from './db';

interface Row {
  pubkey: string;
  name: string;
  type: number;
  flags: number;
  out_path_len: number;
  out_path_hex: string;
  last_advert_unix: number;
  gps_lat: number;
  gps_lon: number;
  lastmod: number;
  first_heard_ms: number;
  last_heard_ms: number;
  on_radio: number;
  favourite: number;
  /** -1 until measured; 0 is a real value (advert heard direct). */
  observed_hops: number;
  observed_path_hex: string;
  /** Radio RTC seconds, not our clock. 0 = never measured. */
  observed_at_unix: number;
}

function rowToDiscovered(row: Row, blockRules: BlockRule[]): DiscoveredContact {
  const hasFix = row.gps_lat !== 0 || row.gps_lon !== 0;
  // A path exists only when the packed out_path_len carries a non-zero hop
  // count. A direct contact (0 hops, e.g. 0x40 in 2-byte mode) and 0xFF (flood)
  // both have no path bytes to show. hashSize comes from the contact's OWN
  // out_path_len byte, never the radio's current path-hash mode.
  const hasPath = row.out_path_len !== 0xff && (row.out_path_len & 0x3f) > 0;
  return {
    key: `c:${row.pubkey}`,
    publicKeyHex: row.pubkey,
    name: row.name || row.pubkey.slice(0, 12),
    kind: advTypeToKind(row.type),
    hops: hopsFromOutPathLen(row.out_path_len),
    outPathHex: hasPath ? row.out_path_hex : undefined,
    outPathHashSize: hasPath ? hashSizeFromOutPathLen(row.out_path_len) : undefined,
    gpsLat: hasFix ? row.gps_lat : undefined,
    gpsLon: hasFix ? row.gps_lon : undefined,
    lastAdvertMs: row.last_advert_unix > 0 ? row.last_advert_unix * 1000 : undefined,
    lastHeardMs: row.last_heard_ms > 0 ? row.last_heard_ms : undefined,
    // >= 0, not truthiness: 0 hops means the radio heard the advert direct, and
    // `row.observed_hops || undefined` would silently report that as unmeasured.
    observedHops: row.observed_hops >= 0 ? row.observed_hops : undefined,
    observedPathHex: row.observed_path_hex || undefined,
    observedAtMs: row.observed_at_unix > 0 ? row.observed_at_unix * 1000 : undefined,
    firstHeardMs: row.first_heard_ms,
    onRadio: row.on_radio !== 0,
    favourite: row.favourite !== 0,
    blocked: contactMatchesAnyBlockRule(row.pubkey, row.name, blockRules),
  };
}

/** What applyRadioFlags last wrote for a pubkey, packed as on_radio | fav<<1.
 *  The lib re-sends its entire discovered pool on every contact frame, so
 *  without this the write-through would re-issue two UPDATEs per row per frame
 *  — quadratic in a sync. Any other write path invalidates its entry. */
const lastWrittenFlags = new Map<string, number>();

const packFlags = (onRadio: boolean, favourite: boolean) => (onRadio ? 1 : 0) | (favourite ? 2 : 0);

/** Forget cached flags so the next applyRadioFlags re-writes these rows.
 *  Called by every other mutating path. Omit `pubkey` to drop the whole cache. */
function invalidateFlagCache(pubkey?: string): void {
  if (pubkey === undefined) lastWrittenFlags.clear();
  else lastWrittenFlags.delete(pubkey);
}

/** When markHeard last wrote last_heard_ms for a pubkey, on our clock.
 *  `messageUpserted` fires once per inbound message, so on a busy link an
 *  unthrottled bump is one sqlite write per received packet into the same table
 *  the discovered-emit coalescer already exists to protect. A "last heard"
 *  column does not need second resolution. */
const lastHeardWrites = new Map<string, number>();

/** Skip a repeat bump for the same pubkey inside this window. */
const HEARD_THROTTLE_MS = 30_000;

/** Reset this module's caches. Exported for tests, which reuse the module
 *  across fresh temp databases — any module state keyed by pubkey has to be
 *  dropped here or it leaks across files (see tests/support/sqlite-temp.ts). */
export function resetDiscoveredFlagCache(): void {
  lastWrittenFlags.clear();
  lastHeardWrites.clear();
}

export const discoveredStore = {
  /** Write the lib's authoritative on_radio/favourite through for many rows in
   *  one transaction, skipping rows whose flags already match what we last
   *  wrote. Turns a per-frame full-pool rewrite into one write per real
   *  change. */
  applyRadioFlags(rows: ReadonlyArray<{ publicKeyHex: string; onRadio: boolean; favourite: boolean }>): void {
    const changed = rows.filter((r) => lastWrittenFlags.get(r.publicKeyHex) !== packFlags(r.onRadio, r.favourite));
    if (changed.length === 0) return;

    const db = openDb();
    const stmt = db.prepare(
      `UPDATE discovered_contacts
         SET on_radio = ?, favourite = ?, flags = (flags & ~1) | ?
       WHERE pubkey = ?`,
    );
    db.exec('BEGIN');
    try {
      for (const r of changed) {
        const fav = r.favourite ? 1 : 0;
        stmt.run(r.onRadio ? 1 : 0, fav, fav, r.publicKeyHex);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    // Only record after a successful commit, so a rolled-back batch re-writes.
    for (const r of changed) lastWrittenFlags.set(r.publicKeyHex, packFlags(r.onRadio, r.favourite));
  },

  /** Upsert from a decoded advert/contact frame. Stamps first_heard_ms on the
   *  first sighting of a pubkey; preserves it (and the existing favourite flag)
   *  on later adverts. `onRadio` is set by the caller per context.
   *
   *  `heardLive` distinguishes a real PUSH_NEW_ADVERT (we actually heard the
   *  node) from a GET_CONTACTS resync (the device just listing what it stores).
   *  last_heard_ms is our-clock and only advances on a live advert, so it never
   *  moves on a resync — committing a contact to the radio can't bump it.
   *  Non-advert receptions (messages, acks, path learns, admin replies) go
   *  through markHeard instead; this stays the advert-only door.
   *
   *  The observed_* columns are ABSENT from both the INSERT list and the
   *  ON CONFLICT DO UPDATE SET list, and must stay that way. On an INSERT
   *  SQLite fills them from their DEFAULTs; on a conflict they are simply not
   *  mentioned, so every measurement survives every later advert and every
   *  GET_CONTACTS resync. Adding them to the conflict list would wipe the whole
   *  pool's inbound hop counts on each contact walk — the one thing that makes
   *  this feature look broken while every test still passes. */
  upsert(record: Models.ContactRecord, opts: { onRadio: boolean; nowMs: number; heardLive: boolean }): void {
    const db = openDb();
    const heardMs = opts.heardLive ? opts.nowMs : 0;
    db.prepare(
      `INSERT INTO discovered_contacts
         (pubkey, name, type, flags, out_path_len, out_path_hex, last_advert_unix,
          gps_lat, gps_lon, lastmod, first_heard_ms, last_heard_ms, on_radio, favourite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pubkey) DO UPDATE SET
         name=excluded.name, type=excluded.type,
         -- Refresh advert flags but keep bit 0 (favourite) consistent with the
         -- preserved favourite column, so a re-advert can't drop a favourite.
         flags=(excluded.flags & ~1) | discovered_contacts.favourite,
         out_path_len=excluded.out_path_len, out_path_hex=excluded.out_path_hex,
         last_advert_unix=excluded.last_advert_unix, gps_lat=excluded.gps_lat,
         gps_lon=excluded.gps_lon, lastmod=excluded.lastmod,
         -- Only a live advert (excluded.last_heard_ms = now) advances this; a
         -- resync passes 0, so MAX keeps the prior value untouched.
         last_heard_ms=MAX(discovered_contacts.last_heard_ms, excluded.last_heard_ms),
         on_radio=excluded.on_radio`,
    ).run(
      record.publicKeyHex,
      record.name,
      record.type,
      record.flags,
      record.outPathLen,
      record.outPathHex,
      record.lastAdvertUnix,
      record.gpsLat,
      record.gpsLon,
      record.lastmod,
      opts.nowMs,
      heardMs,
      opts.onRadio ? 1 : 0,
      record.flags & 0x01 ? 1 : 0,
    );
    invalidateFlagCache(record.publicKeyHex);
  },

  list(blockRules: BlockRule[]): DiscoveredContact[] {
    const db = openDb();
    const rows = db.prepare(`SELECT * FROM discovered_contacts ORDER BY last_advert_unix DESC`).all() as unknown as Row[];
    return rows.map((r) => rowToDiscovered(r, blockRules));
  },

  get(pubkey: string): Row | null {
    const db = openDb();
    const row = db.prepare(`SELECT * FROM discovered_contacts WHERE pubkey = ?`).get(pubkey) as Row | undefined;
    return row ?? null;
  },

  /** Advance last_heard_ms for a pubkey we just received something from — a DM,
   *  an ack, a path learn, a repeater status/telemetry push, a CLI reply. The
   *  advert path keeps using `upsert`; this is the door for everything else
   *  (#45 item 9), which is why the column now means "last reception" rather
   *  than "last advert".
   *
   *  UPDATE-only on purpose: a reception from a pubkey with no discovered row
   *  must NOT synthesise a half-empty one — we have no name, type, flags or
   *  advert for it, and a row like that would show up in the Contact Manager as
   *  a nameless ghost.
   *
   *  `last_heard_ms < ?` mirrors the MAX() in upsert's conflict clause so an
   *  out-of-order or replayed bump can never move the clock backwards.
   *
   *  Deliberately does NOT invalidateFlagCache: `lastWrittenFlags` tracks only
   *  on_radio|favourite, neither of which this touches, so invalidating would
   *  force applyRadioFlags to re-write the whole pool on the next `discovered`
   *  frame — the exact per-frame rewrite that cache exists to prevent.
   *
   *  Returns true only when a row actually moved, so callers can skip the
   *  broadcast when nothing changed. */
  markHeard(pubkey: string, nowMs: number): boolean {
    const last = lastHeardWrites.get(pubkey);
    if (last !== undefined && nowMs - last < HEARD_THROTTLE_MS) return false;

    const db = openDb();
    const res = db
      .prepare(`UPDATE discovered_contacts SET last_heard_ms = ? WHERE pubkey = ? AND last_heard_ms < ?`)
      .run(nowMs, pubkey, nowMs);
    const changed = Number(res.changes) > 0;
    // Only remember successful writes. A pubkey with no row (or a clock that
    // didn't advance) shouldn't arm a 30s throttle against the first real bump
    // it could have taken.
    if (changed) lastHeardWrites.set(pubkey, nowMs);
    return changed;
  },

  /** Mirror a path the user set (or reset) by hand into the discovered row.
   *  The lib's setContactPath/resetContactPath write the radio and then their
   *  OWN in-memory contact map — they emit neither `contactObserved` nor
   *  `discovered`, so nothing writes through to this table and the Contact
   *  Manager's hop cell keeps the pre-edit byte until the next full
   *  GET_CONTACTS. Since resolveContact prefers the discovered row's `hops`
   *  over the on-radio contact's, the rail goes stale with it.
   *
   *  `outPathLen` is the PACKED firmware byte — `((hashSize - 1) << 6) |
   *  hopCount`, or 0xFF for "no path, flood" — not a byte count, so that
   *  hopsFromOutPathLen/hashSizeFromOutPathLen keep reading it correctly.
   *  UPDATE-only, for the same reason markHeard is. */
  setOutPath(pubkey: string, outPathLen: number, outPathHex: string): void {
    const db = openDb();
    db.prepare(`UPDATE discovered_contacts SET out_path_len = ?, out_path_hex = ? WHERE pubkey = ?`).run(
      outPathLen,
      outPathHex,
      pubkey,
    );
  },

  /** Record the radio's cached INBOUND advert path for a contact — the reply to
   *  CMD_GET_ADVERT_PATH (#45 item 7).
   *
   *  Writes only the observed_* columns. It must never touch out_path_len:
   *  that is the learned OUTBOUND route, a different direction and a different
   *  question, and collapsing the two is the bug this whole item exists to fix.
   *
   *  UPDATE-only for the same reason markHeard is — a measurement for a pubkey
   *  we have no advert for must not synthesise a nameless row — and returns true
   *  only when a row actually moved, so callers can skip the broadcast.
   *
   *  `hops: 0` is a legitimate measurement (heard direct) and is stored as 0;
   *  -1 stays reserved for "never measured".
   *
   *  Deliberately does NOT invalidateFlagCache: `lastWrittenFlags` tracks only
   *  on_radio|favourite, neither of which this touches, so invalidating would
   *  force a full-pool rewrite on the next `discovered` frame. */
  setObservedPath(pubkey: string, p: { hops: number; pathHex: string; recvUnix: number }): boolean {
    const db = openDb();
    const res = db
      .prepare(
        `UPDATE discovered_contacts
            SET observed_hops = ?, observed_path_hex = ?, observed_at_unix = ?
          WHERE pubkey = ?`,
      )
      .run(p.hops, p.pathHex, p.recvUnix, pubkey);
    return Number(res.changes) > 0;
  },

  setOnRadio(pubkey: string, onRadio: boolean): void {
    const db = openDb();
    db.prepare(`UPDATE discovered_contacts SET on_radio = ? WHERE pubkey = ?`).run(onRadio ? 1 : 0, pubkey);
    invalidateFlagCache(pubkey);
  },

  /** Mark on_radio for exactly the given set: rows in the set → 1, everything
   *  else → 0. Called from the `contactsSynced` hook in adapterEvents, which
   *  fires only on a genuine RESP_END_OF_CONTACTS — the set must be the radio's
   *  COMPLETE contents, or this clears flags for contacts that merely weren't
   *  reached. It is the only thing that ever clears on_radio for a row the lib
   *  no longer reports, so without it the mirror drifts upward forever (#30).
   *
   *  Clears the whole flag cache by design: the blanket UPDATE invalidates what
   *  applyRadioFlags last wrote for every row, so the next `discovered` frame
   *  re-writes the lib's pool once. That is once per sync, not per frame. */
  reconcileOnRadio(onRadioPubkeys: string[]): void {
    const db = openDb();
    db.exec('UPDATE discovered_contacts SET on_radio = 0');
    const stmt = db.prepare('UPDATE discovered_contacts SET on_radio = 1 WHERE pubkey = ?');
    for (const pk of onRadioPubkeys) stmt.run(pk);
    invalidateFlagCache();
  },

  setFavourite(pubkey: string, favourite: boolean): void {
    const db = openDb();
    db.prepare(
      `UPDATE discovered_contacts
         SET favourite = ?, flags = (flags & ~1) | ? WHERE pubkey = ?`,
    ).run(favourite ? 1 : 0, favourite ? 1 : 0, pubkey);
    invalidateFlagCache(pubkey);
  },

  remove(pubkey: string): void {
    const db = openDb();
    db.prepare(`DELETE FROM discovered_contacts WHERE pubkey = ?`).run(pubkey);
    invalidateFlagCache(pubkey);
  },

  /** Drop discovered-only rows, keeping anything currently on the radio. */
  clearDiscoveredOnly(): void {
    const db = openDb();
    db.exec(`DELETE FROM discovered_contacts WHERE on_radio = 0`);
    invalidateFlagCache();
  },
};
