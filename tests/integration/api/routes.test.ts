import { describe, expect, it } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { appLifecycle } from '../../../src/main/runtime/appLifecycle';
import { stateHolder } from '../../../src/main/state/holder';
import type { SpyLifecycle } from '../../support/seams';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe('api routes', () => {
  it('serves capabilities (public, no auth on the raw app)', async () => {
    const res = await app().request('/api/capabilities');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { httpPort: number };
    expect(body.httpPort).toBe(8080);
  });

  it('returns seeded channels', async () => {
    stateHolder().setChannels([{ key: 'ch:General', name: 'General', kind: 'public' }]);
    const res = await app().request('/api/channels');
    const body = (await res.json()) as Array<{ key: string }>;
    expect(body.map((c) => c.key)).toContain('ch:General');
  });

  it('invokes appLifecycle.quit on /api/app/quit (no real quit)', async () => {
    const res = await app().request('/api/app/quit', { method: 'POST' });
    expect(res.status).toBeLessThan(500);
    await flush();
    expect((appLifecycle() as SpyLifecycle).calls).toContain('quit');
  });

  it('round-trips the map api-key through secretStore', async () => {
    const set = await app().request('/api/map/api-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'pm-secret-key' }),
    });
    expect(set.status).toBeLessThan(400);
    const get = await app().request('/api/map/api-key');
    const body = (await get.json()) as { hasKey: boolean };
    expect(body.hasKey).toBe(true);
  });
});
