import { describe, expect, it } from 'vitest';
import type { TileCacheInfo } from '../../../src/shared/types';
import { testRoutes } from '../../support/api';

describe('tile cache routes', () => {
  it('reports cache size', async () => {
    const res = await testRoutes().request('/api/map/tile-cache');
    expect(res.status).toBe(200);
    const info = (await res.json()) as TileCacheInfo;
    expect(info).toEqual({ bytes: expect.any(Number), count: expect.any(Number) });
  });

  it('clears the cache and returns zeroed info', async () => {
    const res = await testRoutes().request('/api/map/tile-cache', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()) as TileCacheInfo).toEqual({ bytes: 0, count: 0 });
  });

  it('acknowledges an open-folder request', async () => {
    const res = await testRoutes().request('/api/map/tile-cache/open', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
  });
});
