import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootTestServer } from '../../support/server';

// The renderer bundle served over HTTP (packaged builds load the window from
// here, and so do external browser clients).
describe('static renderer serving', () => {
  let parent: string | null = null;

  afterEach(() => {
    if (parent) rmSync(parent, { recursive: true, force: true });
    parent = null;
  });

  async function boot() {
    parent = mkdtempSync(join(tmpdir(), 'coresense-static-'));
    const rendererDir = join(parent, 'renderer');
    mkdirSync(join(rendererDir, 'assets'), { recursive: true });
    writeFileSync(join(rendererDir, 'index.html'), '<!doctype html><title>spa</title>');
    writeFileSync(join(rendererDir, 'assets', 'app.js'), 'console.log(1);');
    writeFileSync(join(rendererDir, 'assets', 'app.css'), 'body{}');
    // A sibling of the renderer root that must never be reachable.
    writeFileSync(join(parent, 'secret.txt'), 'top secret');
    const handle = await bootTestServer(rendererDir);
    return `http://127.0.0.1:${handle.port}`;
  }

  it('serves the shell at /', async () => {
    const res = await fetch(`${await boot()}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<title>spa</title>');
  });

  it('serves assets with their MIME type', async () => {
    const base = await boot();
    const js = await fetch(`${base}/assets/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    expect(await js.text()).toBe('console.log(1);');
    const css = await fetch(`${base}/assets/app.css`);
    expect(css.headers.get('content-type')).toContain('text/css');
  });

  it('answers a missing asset with a 404, not the shell', async () => {
    const res = await fetch(`${await boot()}/assets/missing.js`);
    expect(res.status).toBe(404);
  });

  it('serves the shell for an extensionless client-side route', async () => {
    const res = await fetch(`${await boot()}/channels/general`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>spa</title>');
  });

  it('never serves a file outside the renderer root', async () => {
    const base = await boot();
    for (const path of ['/%2e%2e/secret.txt', '/assets/%2e%2e/%2e%2e/secret.txt', '/..%2fsecret.txt']) {
      const res = await fetch(`${base}${path}`);
      expect(await res.text()).not.toContain('top secret');
    }
  });
});
