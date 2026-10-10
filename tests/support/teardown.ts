// Deliberately imports nothing from src/. The integration setup file imports
// this module, and anything a setup file imports is loaded before a test
// file's vi.mock() calls register — so a src import here would silently defeat
// a test's mock of that module (tile-range.test.ts mocks map/tile-paths, which
// the server and route modules pull in).

type Teardown = () => void | Promise<void>;

const pending: Teardown[] = [];

/** Run `fn` in the integration project's global afterEach, after the test's
 *  own afterEach hooks. Teardowns run last-registered first. */
export function deferTeardown(fn: Teardown): void {
  pending.push(fn);
}

/** Run and forget every deferred teardown. Called by tests/integration/setup.ts. */
export async function runDeferredTeardowns(): Promise<void> {
  for (let fn = pending.pop(); fn; fn = pending.pop()) await fn();
}
