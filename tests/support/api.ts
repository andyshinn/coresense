import { createRoutes } from '../../src/main/api/routes';
import type { BridgeHandle } from '../../src/main/bridge';
import { setProtocolSession } from '../../src/main/protocol';
import type { SessionAdapter } from '../../src/main/protocol/sessionAdapter';
import type { BridgeStatus } from '../../src/shared/types';
import { deferTeardown } from './teardown';

/** A bridge that is not running: no TCP listener, no clients, no radio. */
export function stubBridgeStatus(): BridgeStatus {
  return {
    tcpPort: null,
    bindAddress: '127.0.0.1',
    lanAddress: null,
    tcpClients: 0,
    mdnsServiceName: null,
    radioConnected: false,
    portConflict: null,
  };
}

/** A BridgeHandle double for startServer: reports stubBridgeStatus() and never
 *  changes. */
export function stubBridge(): BridgeHandle {
  return {
    tcpPort: null,
    getStatus: stubBridgeStatus,
    setMdnsServiceName: () => {},
    on: () => {},
    off: () => {},
    close: async () => {},
  };
}

type RoutesDeps = Parameters<typeof createRoutes>[0];

/** The /api Hono app on its own, with stub server deps. Drive it with
 *  `testRoutes().request(path, init)`. */
export function testRoutes(overrides: Partial<RoutesDeps> = {}) {
  return createRoutes({ port: () => 8080, wsClients: () => 0, bridgeStatus: stubBridgeStatus, ...overrides });
}

/** RequestInit for a JSON-bodied request: `app.request(path, json('PUT', body))`. */
export function json(method: 'POST' | 'PUT' | 'DELETE', body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/** Install a SessionAdapter double as protocolSession(). The stub is typed
 *  against SessionAdapter, so a renamed or re-typed adapter method fails to
 *  compile here instead of at runtime; this is the one place it is cast to
 *  the full adapter. The integration project's global afterEach drops it. */
export function installSessionStub(stub: Partial<SessionAdapter>): SessionAdapter {
  const adapter = stub as SessionAdapter;
  setProtocolSession(adapter);
  deferTeardown(() => setProtocolSession(null));
  return adapter;
}
