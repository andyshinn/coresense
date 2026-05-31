import { describe, expect, it } from 'vitest';
import { userDataDir } from '../../src/main/runtime/userData';
import { openDb } from '../../src/main/storage/db';

describe('integration harness', () => {
  it('points storage at a temp dir and opens a DB', () => {
    expect(userDataDir()).toMatch(/coresense-it-/);
    const db = openDb();
    const row = db.prepare('SELECT 1 AS n').get() as { n: number };
    expect(row.n).toBe(1);
  });
});
