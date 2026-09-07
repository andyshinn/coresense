import { describe, expect, it } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { stateHolder } from '../../../src/main/state/holder';
import { type AppSettings, DEFAULT_APP_SETTINGS } from '../../../src/shared/types';

const HTTP_PORT = 7654;

function app() {
  return createRoutes({
    port: () => HTTP_PORT,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

function put(settings: AppSettings) {
  return app().request('/api/settings/app', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

const withProxyPort = (port: number): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  proxy: { ...DEFAULT_APP_SETTINGS.proxy, port },
});

describe('PUT /api/settings/app — TCP proxy port', () => {
  it('saves a normal port', async () => {
    const res = await put(withProxyPort(5800));
    expect(res.status).toBe(200);
    expect(stateHolder().getAppSettings().proxy.port).toBe(5800);
  });

  it('refuses the app’s own HTTP port, and does not persist it', async () => {
    // Without this the bridge would bind 7654 on the next boot, the API server
    // would then fail to bind, and the app would quit before showing a window —
    // with no UI left to undo the setting. The endpoint is reachable directly,
    // so the check cannot live only in the settings panel.
    stateHolder().setAppSettings(withProxyPort(5800));

    const res = await put(withProxyPort(HTTP_PORT));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('7654');
    expect(stateHolder().getAppSettings().proxy.port).toBe(5800);
  });

  it.each([0, -1, 70000, 1.5])('refuses the out-of-range port %p', async (port) => {
    stateHolder().setAppSettings(withProxyPort(5800));

    const res = await put(withProxyPort(port));

    expect(res.status).toBe(400);
    expect(stateHolder().getAppSettings().proxy.port).toBe(5800);
  });

  it('still accepts a body with no proxy block', async () => {
    const { proxy: _proxy, ...rest } = DEFAULT_APP_SETTINGS;
    const res = await app().request('/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rest),
    });
    expect(res.status).toBe(200);
  });
});
