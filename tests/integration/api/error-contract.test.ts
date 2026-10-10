import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { onApiError } from '../../../src/main/api/errors';
import { getApiKey } from '../../../src/main/api/middleware/auth';
import { transportManager } from '../../../src/main/transport/manager';
import type { ITransport } from '../../../src/main/transport/types';
import { testRoutes } from '../../support/api';
import { bootTestServer, type TestServer } from '../../support/server';

describe('route error contract', () => {
  // Regression: with no onError registered, a throw escaped as Hono's plain-text
  // "Internal Server Error", which the renderer could only show as raw text.
  it('answers an unexpected throw with JSON { error, code: internal }', async () => {
    const throwing = new Hono();
    throwing.onError(onApiError);
    throwing.get('/boom', () => {
      throw new Error('kaboom');
    });
    const res = await throwing.request('/boom');
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect((await res.json()) as { error: string; code: string }).toEqual({ error: 'kaboom', code: 'internal' });
  });

  // createRoutes must register onApiError itself: routes that dropped their
  // local catches (e.g. macros) rely on it for their 4xx answers.
  it('registers onApiError on the routes app', async () => {
    const routes = testRoutes();
    routes.get('/api/test-boom', () => {
      throw new Error('kaboom');
    });
    const res = await routes.request('/api/test-boom');
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string; code: string }).toEqual({ error: 'kaboom', code: 'internal' });
  });

  // Regression: transport scan/connect/disconnect answered a radio failure with
  // 500, where every other radio failure is a 503.
  it('answers a failed transport scan with 503', async () => {
    transportManager.setTransport({ scan: () => Promise.reject(new Error('bluetooth is off')) } as unknown as ITransport);
    const res = await testRoutes().request('/api/transport/scan', { method: 'POST' });
    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toEqual({ error: 'bluetooth is off' });
  });
});

describe('server: unknown /api paths', () => {
  let handle: TestServer | null = null;
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
    handle = await bootTestServer(rendererDir);
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
