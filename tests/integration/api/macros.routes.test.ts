// tests/integration/api/macros.routes.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { resetMacrosCacheForTests } from '../../../src/main/macros/store';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('macros api', () => {
  beforeEach(() => resetMacrosCacheForTests());

  it('lists, creates, and deletes macros', async () => {
    expect((await (await app().request('/api/macros')).json()) as unknown[]).toEqual([]);

    const created = await app().request('/api/macros', json({ name: 'sig', template: 'rssi {{ rssi }}', scope: 'global' }));
    expect(created.status).toBeLessThan(400);
    const { macro } = (await created.json()) as { macro: { id: string } };
    expect(macro.id).toBeTruthy();

    const list = (await (await app().request('/api/macros')).json()) as Array<{ id: string }>;
    expect(list.map((m) => m.id)).toContain(macro.id);

    const del = await app().request(`/api/macros/${macro.id}`, { method: 'DELETE' });
    expect(del.status).toBeLessThan(400);
  });

  it('rejects an invalid template on create', async () => {
    const res = await app().request('/api/macros', json({ name: 'bad', template: '{% if %}', scope: 'global' }));
    expect(res.status).toBe(400);
  });

  it('serves the manifest', async () => {
    const body = (await (await app().request('/api/macros/manifest')).json()) as { filters: Array<{ name: string }> };
    expect(body.filters.map((f) => f.name)).toContain('distance');
  });

  it('validates a template', async () => {
    const ok = (await (await app().request('/api/macros/validate', json({ template: '{{ peer_name }}' }))).json()) as {
      ok: boolean;
    };
    expect(ok.ok).toBe(true);
    const bad = (await (await app().request('/api/macros/validate', json({ template: '{{ x | nope }}' }))).json()) as {
      ok: boolean;
    };
    expect(bad.ok).toBe(false);
  });

  it('renders a raw template in send mode', async () => {
    const res = await app().request('/api/macros/render', json({ template: 'hi {{ my_callsign }}', mode: 'send' }));
    const body = (await res.json()) as { ok: boolean; text?: string };
    expect(body.ok).toBe(true);
  });
});
