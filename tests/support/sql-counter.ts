import { openDb } from '../../src/main/storage/db';

export interface SqlCounter {
  /** Number of write statements executed against discovered_contacts so far. */
  readonly count: number;
  /** Restore the original `prepare`/`exec`. Safe to call more than once. */
  restore(): void;
}

/** Count every write statement *executed* against `table`.
 *
 *  Counts executions rather than `prepare` calls, so hoisting a statement out
 *  of a loop can't make a quadratic write pattern look linear. Wraps the live
 *  DatabaseSync's `prepare` (decorating matching statements' `run`) and its
 *  `exec` — whole-table writes like reconcileOnRadio/clearDiscoveredOnly go
 *  through `db.exec`, so counting only prepared statements would report an
 *  exec-based quadratic pattern as zero. */
export function countWritesTo(table: string): SqlCounter {
  const pattern = new RegExp(String.raw`^\s*(insert|update|delete)\b[\s\S]*\b${table}\b`, 'i');
  const db = openDb();
  const originalPrepare = db.prepare.bind(db);
  const originalExec = db.exec.bind(db);
  let count = 0;

  (db as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
    const stmt = originalPrepare(sql);
    if (!pattern.test(sql)) return stmt;
    const run = stmt.run.bind(stmt);
    return new Proxy(stmt, {
      get(target, prop, receiver) {
        if (prop === 'run') {
          return (...args: unknown[]) => {
            count += 1;
            return run(...(args as Parameters<typeof run>));
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };

  (db as { exec: (sql: string) => unknown }).exec = (sql: string) => {
    if (pattern.test(sql)) count += 1;
    return originalExec(sql);
  };

  return {
    get count() {
      return count;
    },
    restore() {
      (db as { prepare: unknown }).prepare = originalPrepare;
      (db as { exec: unknown }).exec = originalExec;
    },
  };
}

/** Count write statements executed against the discovered-contacts mirror. */
export function countDiscoveredWrites(): SqlCounter {
  return countWritesTo('discovered_contacts');
}
