import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getApiKey } from '../../../src/main/api/middleware/auth';
import { createRoutes } from '../../../src/main/api/routes';
import { startServer } from '../../../src/main/server';
import { transportManager } from '../../../src/main/transport/manager';
import type { ITransport } from '../../../src/main/transport/types';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

describe('route error contract', () => {
  // Regression: with no onError registered, a throw escaped as Hono's plain-text
  // "Internal Server Error", which the renderer could only show as raw text.
  it('answers an unexpected throw with JSON { error, code: internal }', async () => {
    // No transport installed, so protocolSession() throws while building the snapshot.
    const res = await app().request('/api/state/snapshot');
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('internal');
    expect(body.error.length).toBeGreaterThan(0);
  });

  // Regression: transport scan/connect/disconnect answered a radio failure with
  // 500, where every other radio failure is a 503.
  it('answers a failed transport scan with 503', async () => {
    transportManager.setTransport({ scan: () => Promise.reject(new Error('bluetooth is off')) } as unknown as ITransport);
    const res = await app().request('/api/transport/scan', { method: 'POST' });
    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toEqual({ error: 'bluetooth is off' });
  });
});

describe('server: unknown /api paths', () => {
  let handle: Awaited<ReturnType<typeof startServer>> | null = null;
  let rendererDir: string | null = null;

  afterEach(async () => {
    await handle?.close();
    handle = null;
    if (rendererDir) rmSync(rendererDir, { recursive: true, force: true });
    rendererDir = null;
  });

  async function boot() {
    rendererDir = mkdtempSync(join(tmpdir(), 'coresense-renderer-'));
    writeFileSync(join(rendererDir, 'index.html'), '<!doctype html><title>spa</title>');
    const bridge = { getStatus: () => ({ running: false, clients: 0 }), on: () => {}, off: () => {} };
    handle = await startServer(rendererDir, bridge as never, { port: 0, bindAddress: '127.0.0.1' });
    return `http://127.0.0.1:${handle.port}`;
  }

  // Regression: the SPA fallback used to answer an unknown API path with
  // index.html and a 200.
  it('answers an unknown /api path with a JSON 404, not the SPA shell', async () => {
    const base = await boot();
    const res = await fetch(`${base}/api/no-such-endpoint`, { headers: { Authorization: `Bearer ${getApiKey()}` } });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string; code: string }).toEqual({ error: 'not found', code: 'not_found' });
  });

  it('still serves the SPA shell for an unknown client-side route', async () => {
    const base = await boot();
    const res = await fetch(`${base}/settings/radio`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>spa</title>');
  });
});
