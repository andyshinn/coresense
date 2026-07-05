import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { transportManager } from '../../../src/main/transport/manager';
import type { StateSnapshot } from '../../../src/shared/types';
import { FakeTransport } from '../../support/fake-transport';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

function fakeResponse(status: number, bytes = new Uint8Array([1, 2, 3, 4])) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/x-protobuf' },
    arrayBuffer: async () => bytes.buffer.slice(0),
  } as unknown as Response;
}

async function setKey(a: ReturnType<typeof app>) {
  await a.request('/api/map/api-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'pm-secret' }),
  });
}

// GET /api/state/snapshot reads protocolSession().getDevicePresence()/
// getSyncProgress(), which throw unless a transport is installed. Install a
// loopback double so the 401 test's snapshot check can build the payload.
beforeEach(() => transportManager.setTransport(new FakeTransport()));
afterEach(() => {
  transportManager.clearTransport();
  vi.unstubAllGlobals();
});

describe('online tile proxy', () => {
  it('returns 404 no_api_key when no key is set', async () => {
    const res = await app().request('/api/map/online-tile-proxy/basemap/6/10/20');
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'no_api_key' });
  });

  it('rejects non-numeric tile coordinates before touching the cache/upstream', async () => {
    const a = app();
    await setKey(a);
    const fetchMock = vi.fn(async () => fakeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    // Only plain digits are accepted; anything else (a traversal payload, a
    // path separator, a sign) is rejected before it can reach the cache key /
    // on-disk path or the upstream URL.
    const res = await a.request('/api/map/online-tile-proxy/basemap/6/10/abc');
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: 'bad_tile_coords' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches a fetched tile so the second request does not hit upstream', async () => {
    const a = app();
    await setKey(a);
    const fetchMock = vi.fn(async () => fakeResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const first = await a.request('/api/map/online-tile-proxy/basemap/7/11/22');
    expect(first.status).toBe(200);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));

    const second = await a.request('/api/map/online-tile-proxy/basemap/7/11/22');
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1); // served from cache
  });

  it('maps upstream 401 to a rejected key + 401, then clears on success', async () => {
    const a = app();
    await setKey(a);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(401)),
    );
    const rejected = await a.request('/api/map/online-tile-proxy/basemap/8/1/1');
    expect(rejected.status).toBe(401);
    let snap = (await (await a.request('/api/state/snapshot')).json()) as StateSnapshot;
    expect(snap.mapTileStatus.keyRejected).toBe(true);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(200)),
    );
    const ok = await a.request('/api/map/online-tile-proxy/basemap/8/2/2');
    expect(ok.status).toBe(200);
    snap = (await (await a.request('/api/state/snapshot')).json()) as StateSnapshot;
    expect(snap.mapTileStatus.keyRejected).toBe(false);
  });
});
