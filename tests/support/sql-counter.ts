import { openDb } from '../../src/main/storage/db';

export interface SqlCounter {
  /** Number of write statements executed against discovered_contacts so far. */
  readonly count: number;
  /** Restore the original `prepare`. Safe to call more than once. */
  restore(): void;
}

/** Count every write statement *executed* against `table`.
 *
 *  Counts executions rather than `prepare` calls, so hoisting a statement out
 *  of a loop can't make a quadratic write pattern look linear. Wraps the live
 *  DatabaseSync's `prepare` and decorates matching statements' `run`. */
export function countWritesTo(table: string): SqlCounter {
  const pattern = new RegExp(String.raw`^\s*(insert|update|delete)\b[\s\S]*\b${table}\b`, 'i');
  const db = openDb();
  const original = db.prepare.bind(db);
  let count = 0;

  (db as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
    const stmt = original(sql);
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

  return {
    get count() {
      return count;
    },
    restore() {
      (db as { prepare: unknown }).prepare = original;
    },
  };
}

/** Count write statements executed against the discovered-contacts mirror. */
export function countDiscoveredWrites(): SqlCounter {
  return countWritesTo('discovered_contacts');
}
