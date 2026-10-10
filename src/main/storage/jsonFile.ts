import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { errorMessage } from '../../shared/errors';

/** A JSON object root: not an array, not null, not a primitive. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Read and parse a JSON file whose root must pass `guard`. A missing file is
 *  the normal first-run case and returns undefined silently; anything else that
 *  stops us using the file (unreadable, invalid JSON, a root of the wrong
 *  shape) is passed to `onInvalid` and also returns undefined, so the caller
 *  falls back to its defaults. Guards check the ROOT shape only — they turn a
 *  corrupt file into defaults rather than validating every field. */
export function readJsonFile<T>(
  path: string,
  guard: (v: unknown) => v is T,
  onInvalid: (reason: string) => void,
): T | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') onInvalid(errorMessage(err));
    return undefined;
  }
  if (guard(parsed)) return parsed;
  onInvalid('unexpected JSON shape');
  return undefined;
}

export interface JsonWriter {
  /** Queue an atomic write (write `<path>.tmp`, then rename over `path`).
   *  Fire-and-forget: failures go to the writer's `onError`. */
  write(path: string, value: unknown): void;
  /** Settles once every write queued so far has finished. */
  flush(): Promise<void>;
}

/** Serialized atomic JSON writes. Writes to the same path are chained, so
 *  concurrent saves (two quick UI changes, a flurry of window resize/move
 *  events) can't interleave write+rename and corrupt the on-disk JSON — the
 *  last call wins. Callers stay synchronous-looking; the write is
 *  fire-and-forget. */
export function createJsonWriter(onError: (path: string, err: unknown) => void): JsonWriter {
  const chains = new Map<string, Promise<void>>();
  return {
    write(path, value) {
      const tmp = `${path}.tmp`;
      // Snapshot the value synchronously so callers can mutate their copy after
      // this returns without affecting the on-disk payload.
      const body = JSON.stringify(value, null, 2);
      const next = (chains.get(path) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          try {
            await writeFile(tmp, body, 'utf8');
            await rename(tmp, path);
          } catch (err) {
            onError(path, err);
          }
        });
      chains.set(path, next);
    },
    async flush() {
      await Promise.all(chains.values());
    },
  };
}
