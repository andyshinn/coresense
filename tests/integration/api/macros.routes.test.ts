// tests/integration/api/macros.routes.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { resetMacrosCacheForTests } from '../../../src/main/macros/store';
import { json, testRoutes } from '../../support/api';

describe('macros api', () => {
  beforeEach(() => resetMacrosCacheForTests());

  it('lists, creates, and deletes macros', async () => {
    expect((await (await testRoutes().request('/api/macros')).json()) as unknown[]).toEqual([]);

    const created = await testRoutes().request(
      '/api/macros',
      json('POST', { name: 'sig', template: 'rssi {{ rssi }}', scope: 'global' }),
    );
    expect(created.status).toBeLessThan(400);
    const { macro } = (await created.json()) as { macro: { id: string } };
    expect(macro.id).toBeTruthy();

    const list = (await (await testRoutes().request('/api/macros')).json()) as Array<{ id: string }>;
    expect(list.map((m) => m.id)).toContain(macro.id);

    const del = await testRoutes().request(`/api/macros/${macro.id}`, { method: 'DELETE' });
    expect(del.status).toBeLessThan(400);
  });

  // The 400 comes from onApiError (no local catch), and the macro editor reads
  // `errors` off the body, so pin both.
  it('rejects an invalid template on create', async () => {
    const res = await testRoutes().request(
      '/api/macros',
      json('POST', { name: 'bad', template: '{% if %}', scope: 'global' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; errors: unknown[] };
    expect(body.error).toBe('invalid template');
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('rejects an invalid template on update and keeps the stored one', async () => {
    const created = await testRoutes().request(
      '/api/macros',
      json('POST', { name: 'sig', template: 'hi', scope: 'global' }),
    );
    const { macro } = (await created.json()) as { macro: { id: string } };

    const res = await testRoutes().request(`/api/macros/${macro.id}`, json('PUT', { template: '{% if %}' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; errors: unknown[] };
    expect(body.error).toBe('invalid template');
    expect(body.errors.length).toBeGreaterThan(0);

    const list = (await (await testRoutes().request('/api/macros')).json()) as Array<{ id: string; template: string }>;
    expect(list.find((m) => m.id === macro.id)?.template).toBe('hi');
  });

  it('serves the manifest', async () => {
    const body = (await (await testRoutes().request('/api/macros/manifest')).json()) as {
      filters: Array<{ name: string }>;
    };
    expect(body.filters.map((f) => f.name)).toContain('distance');
  });

  it('validates a template', async () => {
    const ok = (await (
      await testRoutes().request('/api/macros/validate', json('POST', { template: '{{ peer_name }}' }))
    ).json()) as {
      ok: boolean;
    };
    expect(ok.ok).toBe(true);
    const bad = (await (
      await testRoutes().request('/api/macros/validate', json('POST', { template: '{{ x | nope }}' }))
    ).json()) as {
      ok: boolean;
    };
    expect(bad.ok).toBe(false);
  });

  it('renders a raw template in send mode', async () => {
    const res = await testRoutes().request(
      '/api/macros/render',
      json('POST', { template: 'hi {{ my_callsign }}', mode: 'send' }),
    );
    const body = (await res.json()) as { ok: boolean; text?: string };
    expect(body.ok).toBe(true);
  });

  it('returns 404 when macroId does not exist', async () => {
    const res = await testRoutes().request('/api/macros/render', json('POST', { macroId: 'does-not-exist', mode: 'send' }));
    expect(res.status).toBe(404);
  });
});
