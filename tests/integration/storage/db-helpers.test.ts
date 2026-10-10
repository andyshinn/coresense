import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { userDataDir } from '../../../src/main/runtime/userData';
import { addColumnIfMissing, clampLimit, closeDb, openDb, withTransaction } from '../../../src/main/storage/db';

describe('addColumnIfMissing', () => {
  it('treats "duplicate column name" as already migrated', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (a INTEGER)');
    addColumnIfMissing(db, 'ALTER TABLE t ADD COLUMN b INTEGER NOT NULL DEFAULT 0');
    expect(() => addColumnIfMissing(db, 'ALTER TABLE t ADD COLUMN b INTEGER NOT NULL DEFAULT 0')).not.toThrow();
    db.close();
  });

  // Regression: the catch used to swallow EVERY error, so a busy/read-only
  // database or a DDL typo looked identical to "column already exists".
  it('rethrows any other failure instead of reading it as migrated', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => addColumnIfMissing(db, 'ALTER TABLE missing ADD COLUMN b INTEGER')).toThrow(/no such table/);
    db.close();
  });
});

describe('openDb schema', () => {
  it('does not keep the never-queried messages_by_state index', () => {
    const row = openDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
      .get('messages_by_state');
    expect(row).toBeUndefined();
  });

  // Regression: openDb() used to cache the connection BEFORE running the
  // schema, so a failed migration left a half-migrated handle that every later
  // call returned without retrying (and reads then saw `undefined` columns).
  it('does not cache a connection whose schema setup failed, and retries on the next call', () => {
    closeDb();
    const path = join(userDataDir(), 'messages.db');
    const seed = new DatabaseSync(path);
    // An old-shape discovered_contacts (no observed_* columns) plus a VIEW
    // squatting on `packets`: CREATE TABLE IF NOT EXISTS skips it, then
    // indexing it throws, so the guarded ADD COLUMNs never get to run.
    seed.exec(`
      CREATE TABLE discovered_contacts (
        pubkey TEXT PRIMARY KEY, name TEXT NOT NULL, type INTEGER NOT NULL, flags INTEGER NOT NULL,
        out_path_len INTEGER NOT NULL, out_path_hex TEXT NOT NULL, last_advert_unix INTEGER NOT NULL,
        gps_lat REAL NOT NULL, gps_lon REAL NOT NULL, lastmod INTEGER NOT NULL,
        first_heard_ms INTEGER NOT NULL, last_heard_ms INTEGER NOT NULL DEFAULT 0,
        on_radio INTEGER NOT NULL DEFAULT 0, favourite INTEGER NOT NULL DEFAULT 0
      );
      CREATE VIEW packets AS SELECT 0 AS ts;
    `);

    expect(() => openDb()).toThrow(/views may not be indexed/);
    // A cached handle would come back here without throwing.
    expect(() => openDb()).toThrow(/views may not be indexed/);

    seed.exec('DROP VIEW packets');
    seed.close();

    const cols = (openDb().prepare('PRAGMA table_info(discovered_contacts)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['observed_hops', 'observed_path_hex', 'observed_at_unix']));
  });
});

describe('withTransaction', () => {
  it('commits and returns the callback result', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (a INTEGER)');
    const out = withTransaction(db, () => {
      db.prepare('INSERT INTO t (a) VALUES (1)').run();
      return 'done';
    });
    expect(out).toBe('done');
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 1 });
    db.close();
  });

  it('rolls back and rethrows when the callback throws', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (a INTEGER)');
    expect(() =>
      withTransaction(db, () => {
        db.prepare('INSERT INTO t (a) VALUES (1)').run();
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 0 });
    db.close();
  });

  it('rethrows the original error even when ROLLBACK itself fails', () => {
    const db = new DatabaseSync(':memory:');
    expect(() =>
      withTransaction(db, () => {
        // Ends the transaction early, so the helper's own ROLLBACK throws
        // "no transaction is active" — which must not replace this error.
        db.exec('ROLLBACK');
        throw new Error('original');
      }),
    ).toThrow('original');
    db.close();
  });
});

describe('clampLimit', () => {
  it('floors and caps a usable value', () => {
    expect(clampLimit(50, 100, 500)).toBe(50);
    expect(clampLimit(7.9, 100, 500)).toBe(7);
    expect(clampLimit(10_000, 100, 500)).toBe(500);
    expect(clampLimit(10_000, 100)).toBe(10_000);
  });

  // SQLite reads a negative LIMIT as "no limit".
  it('never lets a non-positive or non-numeric value through', () => {
    for (const bad of [-1, 0, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '20', null, undefined]) {
      expect(clampLimit(bad, 100, 500)).toBe(100);
    }
  });
});
