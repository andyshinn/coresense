import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { setUpdatesController, type UpdateController } from '../../../src/main/updates/controller';
import type { UpdateState } from '../../../src/shared/types';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

const sample: UpdateState = {
  status: 'available',
  mode: 'notify',
  channel: 'development',
  currentVersion: '0.0.10',
  latestVersion: '0.1.0-beta.1',
  releaseUrl: 'https://gh/rel',
};

afterEach(() => setUpdatesController(null));

describe('updates routes', () => {
  it('POST /api/updates/check returns the controller state', async () => {
    const check = vi.fn(async () => sample);
    setUpdatesController({ check, installAndRestart: vi.fn(), getState: () => sample } as unknown as UpdateController);
    const res = await app().request('/api/updates/check', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; updateState: UpdateState };
    expect(body.ok).toBe(true);
    expect(body.updateState.latestVersion).toBe('0.1.0-beta.1');
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('POST /api/updates/install invokes installAndRestart', async () => {
    const installAndRestart = vi.fn();
    setUpdatesController({
      check: vi.fn(async () => sample),
      installAndRestart,
      getState: () => sample,
    } as unknown as UpdateController);
    const res = await app().request('/api/updates/install', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(installAndRestart).toHaveBeenCalledTimes(1);
  });
});
