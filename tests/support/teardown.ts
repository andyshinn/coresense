// Deliberately imports nothing from src/. The integration setup file imports
// this module, and anything a setup file imports is loaded before a test
// file's vi.mock() calls register — so a src import here would silently defeat
// a test's mock of that module (tile-range.test.ts mocks map/tile-paths, which
// the server and route modules pull in).

type Teardown = () => void | Promise<void>;

const pending: Teardown[] = [];

/** Run `fn` in the integration project's global afterEach, after the test's
 *  own afterEach hooks. Teardowns run last-registered first.
 *
 *  So a test file's own afterEach runs while every helper-owned session and
 *  server is still live: a reset there can be overwritten by a late emit from
 *  a session that has not been stopped yet. Reset module state in beforeEach
 *  instead, or stop the session first (stop() is idempotent). */
export function deferTeardown(fn: Teardown): void {
  pending.push(fn);
}

/** Run and forget every deferred teardown. Called by tests/integration/setup.ts.
 *  Every teardown runs even if an earlier one throws, and none is left over for
 *  the next test; the failures are rethrown once all of them have run. */
export async function runDeferredTeardowns(): Promise<void> {
  const errors: unknown[] = [];
  for (let fn = pending.pop(); fn; fn = pending.pop()) {
    try {
      await fn();
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, `${errors.length} deferred teardowns failed`);
}
