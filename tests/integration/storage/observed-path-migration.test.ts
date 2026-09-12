import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { userDataDir } from '../../../src/main/runtime/userData';
import { closeDb, openDb } from '../../../src/main/storage/db';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';

// There is no migration framework here: the schema is one idempotent
// `CREATE TABLE IF NOT EXISTS` block plus hand-written guarded ADD COLUMNs. The
// DDL alone covers only fresh installs — for a database that already has the
// table, `IF NOT EXISTS` does nothing at all, so without the guarded ALTERs
// every existing install would open cleanly and then read `undefined` for the
// new columns on every SELECT *. This test is that existing install.

/** The discovered_contacts shape as it stood before #45 item 7. */
const LEGACY_DDL = `
  CREATE TABLE discovered_contacts (
    pubkey          TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    type            INTEGER NOT NULL,
    flags           INTEGER NOT NULL,
    out_path_len    INTEGER NOT NULL,
    out_path_hex    TEXT NOT NULL,
    last_advert_unix INTEGER NOT NULL,
    gps_lat         REAL NOT NULL,
    gps_lon         REAL NOT NULL,
    lastmod         INTEGER NOT NULL,
    first_heard_ms  INTEGER NOT NULL,
    last_heard_ms   INTEGER NOT NULL DEFAULT 0,
    on_radio        INTEGER NOT NULL DEFAULT 0,
    favourite       INTEGER NOT NULL DEFAULT 0
  );`;

const PK = 'aa'.repeat(32);

/** Write a pre-#45-item-7 database into the temp userData dir. */
function seedLegacyDb(): void {
  closeDb();
  const db = new DatabaseSync(join(userDataDir(), 'messages.db'));
  db.exec(LEGACY_DDL);
  db.prepare(
    `INSERT INTO discovered_contacts
       (pubkey, name, type, flags, out_path_len, out_path_hex, last_advert_unix,
        gps_lat, gps_lon, lastmod, first_heard_ms, last_heard_ms, on_radio, favourite)
     VALUES (?, 'Legacy', 1, 0, 255, '', 1700000000, 0, 0, 1, 1750000000000, 0, 1, 0)`,
  ).run(PK);
  db.close();
}

const columns = () =>
  (openDb().prepare('SELECT * FROM discovered_contacts LIMIT 1').all() as unknown as Record<string, unknown>[]).flatMap(
    (r) => Object.keys(r),
  );

describe('discovered_contacts observed_* migration', () => {
  it('adds the columns to a database created before they existed', () => {
    seedLegacyDb();

    const cols = columns();

    expect(cols).toContain('observed_hops');
    expect(cols).toContain('observed_path_hex');
    expect(cols).toContain('observed_at_unix');
  });

  it('back-fills existing rows with the never-measured sentinel, not 0', () => {
    seedLegacyDb();

    const row = discoveredStore.get(PK);

    // 0 would be a claim that we heard this node direct.
    expect(row?.observed_hops).toBe(-1);
    expect(row?.observed_path_hex).toBe('');
    expect(row?.observed_at_unix).toBe(0);
    expect(discoveredStore.list([]).find((d) => d.publicKeyHex === PK)?.observedHops).toBeUndefined();
  });

  it('keeps the row (and the rest of its data) intact', () => {
    seedLegacyDb();

    const row = discoveredStore.get(PK);

    expect(row?.name).toBe('Legacy');
    expect(row?.on_radio).toBe(1);
    expect(row?.first_heard_ms).toBe(1_750_000_000_000);
  });

  it('is a no-op on a database that already has them', () => {
    seedLegacyDb();
    openDb();
    discoveredStore.setObservedPath(PK, { hops: 2, pathHex: 'aabb', recvUnix: 1_760_000_000 });

    // Re-opening runs the guarded ALTERs again; ADD COLUMN throwing "duplicate
    // column name" is the success signal, and nothing may be reset by it.
    closeDb();
    openDb();

    expect(discoveredStore.get(PK)?.observed_hops).toBe(2);
  });
});
