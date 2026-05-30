import {
  contactMatchesAnyBlockRule,
  type DiscoveredContact,
} from '../../shared/contacts/discovered';
import type { BlockRule, ContactKind, PathHashSize } from '../../shared/types';
import type { ContactRecord } from '../protocol/decode';
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
  on_radio: number;
  favourite: number;
}

function advTypeToKind(type: number): ContactKind {
  switch (type) {
    case 2:
      return 'repeater';
    case 3:
      return 'room';
    case 4:
      return 'sensor';
    default:
      return 'chat';
  }
}

function rowToDiscovered(
  row: Row,
  hashSize: PathHashSize,
  blockRules: BlockRule[],
): DiscoveredContact {
  const hasFix = row.gps_lat !== 0 || row.gps_lon !== 0;
  const hasPath = row.out_path_len !== 0xff && row.out_path_len > 0;
  return {
    key: `c:${row.pubkey}`,
    publicKeyHex: row.pubkey,
    name: row.name || row.pubkey.slice(0, 12),
    kind: advTypeToKind(row.type),
    hops: row.out_path_len === 0xff ? undefined : Math.floor(row.out_path_len / hashSize),
    outPathHex: hasPath ? row.out_path_hex : undefined,
    outPathHashSize: hasPath ? hashSize : undefined,
    gpsLat: hasFix ? row.gps_lat : undefined,
    gpsLon: hasFix ? row.gps_lon : undefined,
    lastAdvertMs: row.last_advert_unix > 0 ? row.last_advert_unix * 1000 : undefined,
    firstHeardMs: row.first_heard_ms,
    onRadio: row.on_radio !== 0,
    favourite: row.favourite !== 0,
    blocked: contactMatchesAnyBlockRule(row.pubkey, row.name, blockRules),
  };
}

export const discoveredStore = {
  /** Upsert from a decoded advert/contact frame. Stamps first_heard_ms on the
   *  first sighting of a pubkey; preserves it (and the existing favourite flag)
   *  on later adverts. `onRadio` is set by the caller per context. */
  upsert(record: ContactRecord, opts: { onRadio: boolean; nowMs: number }): void {
    const db = openDb();
    db.prepare(
      `INSERT INTO discovered_contacts
         (pubkey, name, type, flags, out_path_len, out_path_hex, last_advert_unix,
          gps_lat, gps_lon, lastmod, first_heard_ms, on_radio, favourite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pubkey) DO UPDATE SET
         name=excluded.name, type=excluded.type, flags=excluded.flags,
         out_path_len=excluded.out_path_len, out_path_hex=excluded.out_path_hex,
         last_advert_unix=excluded.last_advert_unix, gps_lat=excluded.gps_lat,
         gps_lon=excluded.gps_lon, lastmod=excluded.lastmod,
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
      opts.onRadio ? 1 : 0,
      record.flags & 0x01 ? 1 : 0,
    );
  },

  list(hashSize: PathHashSize, blockRules: BlockRule[]): DiscoveredContact[] {
    const db = openDb();
    const rows = db
      .prepare(`SELECT * FROM discovered_contacts ORDER BY last_advert_unix DESC`)
      .all() as unknown as Row[];
    return rows.map((r) => rowToDiscovered(r, hashSize, blockRules));
  },

  get(pubkey: string): Row | null {
    const db = openDb();
    const row = db.prepare(`SELECT * FROM discovered_contacts WHERE pubkey = ?`).get(pubkey) as
      | Row
      | undefined;
    return row ?? null;
  },

  setOnRadio(pubkey: string, onRadio: boolean): void {
    const db = openDb();
    db.prepare(`UPDATE discovered_contacts SET on_radio = ? WHERE pubkey = ?`).run(
      onRadio ? 1 : 0,
      pubkey,
    );
  },

  /** Mark on_radio for exactly the given set (used after a full GET_CONTACTS
   *  sync): rows in the set → 1, everything else → 0. */
  reconcileOnRadio(onRadioPubkeys: string[]): void {
    const db = openDb();
    db.exec('UPDATE discovered_contacts SET on_radio = 0');
    const stmt = db.prepare('UPDATE discovered_contacts SET on_radio = 1 WHERE pubkey = ?');
    for (const pk of onRadioPubkeys) stmt.run(pk);
  },

  setFavourite(pubkey: string, favourite: boolean): void {
    const db = openDb();
    db.prepare(
      `UPDATE discovered_contacts
         SET favourite = ?, flags = (flags & ~1) | ? WHERE pubkey = ?`,
    ).run(favourite ? 1 : 0, favourite ? 1 : 0, pubkey);
  },

  remove(pubkey: string): void {
    const db = openDb();
    db.prepare(`DELETE FROM discovered_contacts WHERE pubkey = ?`).run(pubkey);
  },

  /** Drop discovered-only rows, keeping anything currently on the radio. */
  clearDiscoveredOnly(): void {
    const db = openDb();
    db.exec(`DELETE FROM discovered_contacts WHERE on_radio = 0`);
  },
};
