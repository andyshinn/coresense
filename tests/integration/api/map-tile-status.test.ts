import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

// GET /api/state/snapshot reads protocolSession().getDevicePresence()/
// getSyncProgress(), which throw unless a transport is installed (in the real
// app, installStartupTransport() runs before the server ever starts). Install
// a loopback double so the route can build the payload.
beforeEach(() => transportManager.setTransport(new FakeTransport()));
afterEach(() => transportManager.clearTransport());

describe('mapTileStatus', () => {
  it('is present in the state snapshot', async () => {
    const res = await app().request('/api/state/snapshot');
    const snap = (await res.json()) as StateSnapshot;
    expect(snap.mapTileStatus).toEqual({ keyConfigured: expect.any(Boolean), keyRejected: false });
  });

  it('flips keyConfigured true after saving a key and false after clearing', async () => {
    const a = app();
    await a.request('/api/map/api-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'pm-secret' }),
    });
    let snap = (await (await a.request('/api/state/snapshot')).json()) as StateSnapshot;
    expect(snap.mapTileStatus.keyConfigured).toBe(true);

    await a.request('/api/map/api-key', { method: 'DELETE' });
    snap = (await (await a.request('/api/state/snapshot')).json()) as StateSnapshot;
    expect(snap.mapTileStatus.keyConfigured).toBe(false);
  });
});
