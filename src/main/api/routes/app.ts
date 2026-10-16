import type { Hono } from 'hono';
import type { UpdateCheckResponse } from '../../../shared/api/contract';
import type { BridgeStatus, Capabilities, ServerStatus } from '../../../shared/types';
import { APP_VERSION, GIT_SHA } from '../../build-info';
import { currentPath, folderPath } from '../../logging/fileSink';
import { appLifecycle } from '../../runtime/appLifecycle';
import { transportManager } from '../../transport/manager';
import { updatesController } from '../../updates/controller';
import { markQuitConfirmed } from '../../window/quit';
import { getConfigPath } from '../middleware/auth';

export interface RoutesDeps {
  port: () => number;
  wsClients: () => number;
  bridgeStatus: () => BridgeStatus;
}

/** The capabilities handshake, also embedded in the state snapshot. */
export function buildCapabilities({ port }: RoutesDeps): Capabilities {
  return {
    isElectron: true,
    version: APP_VERSION,
    gitSha: GIT_SHA,
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    platform: process.platform,
    httpPort: port(),
    configPath: getConfigPath(),
    logsFolder: folderPath(),
    logsCurrentFile: currentPath(),
  };
}

export function registerAppRoutes(api: Hono, deps: RoutesDeps): void {
  const { port, wsClients, bridgeStatus } = deps;
  api.get('/api/capabilities', (c) => c.json(buildCapabilities(deps)));

  api.get('/api/status', (c) => {
    const t = transportManager.getState();
    const payload: ServerStatus = {
      port: port(),
      wsClients: wsClients(),
      transport: t.state,
      deviceId: t.deviceId,
      bridge: bridgeStatus(),
    };
    return c.json(payload);
  });

  // POST /api/app/quit — the renderer's reply to a `requestQuit` broadcast:
  // unsaved Settings changes were saved/discarded (or there were none), so
  // re-issue the quit, this time passing the before-quit guard.
  api.post('/api/app/quit', (c) => {
    markQuitConfirmed();
    // Defer so this HTTP response flushes before the app tears down.
    setTimeout(() => appLifecycle().quit(), 0);
    return c.json({ ok: true });
  });

  // POST /api/app/relaunch — used by Proxy settings after the user changes
  // port/bind/enabled/mdns. The bridge listeners are bound at startup, so the
  // simplest correct way to apply them is to restart the whole app.
  //
  // quit(), never exit(): app.exit() skips before-quit/will-quit, so the
  // shutdown pipeline (settings and holder flushes, closeDb) would never run —
  // and this lands right after a coalesced settings write. With the quit
  // already confirmed, before-quit goes straight to that shutdown and then
  // exits, which is when Electron performs the relaunch.
  api.post('/api/app/relaunch', (c) => {
    markQuitConfirmed();
    setTimeout(() => {
      appLifecycle().relaunch();
      appLifecycle().quit();
    }, 0);
    return c.json({ ok: true });
  });

  api.post('/api/updates/check', async (c) => {
    const updateState = await updatesController().check();
    return c.json({ ok: true, updateState } satisfies UpdateCheckResponse);
  });

  api.post('/api/updates/install', (c) => {
    updatesController().installAndRestart();
    return c.json({ ok: true });
  });
}
