import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { addColumnIfMissing, clampLimit, openDb, withTransaction } from '../../../src/main/storage/db';

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
