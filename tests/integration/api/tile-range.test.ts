import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';

// Serve a temp file as the basemap, and let a test make stat() over-report its
// size — the shape of a file truncated between the stat and the read.
const fake = vi.hoisted(() => ({ path: '', statSize: null as number | null }));

vi.mock('../../../src/main/map/tile-paths', () => ({
  tilePath: () => fake.path,
  tilePathIfExists: () => fake.path,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const stat = (async (path: string) => {
    const real = await actual.stat(path);
    if (fake.statSize != null) real.size = fake.statSize;
    return real;
  }) as typeof actual.stat;
  return { ...actual, default: { ...actual, stat }, stat };
});

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

const range = (value: string) => ({ headers: { range: value } });

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coresense-tiles-'));
  fake.path = join(dir, 'basemap.pmtiles');
  fake.statSize = null;
  writeFileSync(fake.path, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('GET /api/tiles/:source byte ranges', () => {
  it('serves the requested slice', async () => {
    const res = await app().request('/api/tiles/basemap', range('bytes=2-4'));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 2-4/10');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([2, 3, 4]);
  });

  // Regression: a read past EOF used to come back zero-padded to the requested
  // length, so the body carried bytes the file doesn't have.
  it('labels a short read with what was actually read, not zero padding', async () => {
    fake.statSize = 20;
    const res = await app().request('/api/tiles/basemap', range('bytes=6-15'));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-length')).toBe('4');
    expect(res.headers.get('content-range')).toBe('bytes 6-9/20');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([6, 7, 8, 9]);
  });

  it('answers 416 when the file now ends before the range starts', async () => {
    fake.statSize = 20;
    const res = await app().request('/api/tiles/basemap', range('bytes=12-15'));
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */20');
  });
});
