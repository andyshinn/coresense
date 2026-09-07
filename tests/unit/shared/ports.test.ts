import { describe, expect, it } from 'vitest';
import { DEFAULT_HTTP_PORT_DEV, DEFAULT_HTTP_PORT_PROD } from '../../../src/main/http-port';
import { checkProxyPort, planBridgeBinding } from '../../../src/shared/ports';
import { BRIDGE_DEFAULT_TCP_PORT, BRIDGE_DEFAULT_TCP_PORT_DEV } from '../../../src/shared/types';

describe('checkProxyPort', () => {
  it('accepts a normal port', () => {
    expect(checkProxyPort(7656, DEFAULT_HTTP_PORT_PROD)).toBeNull();
    expect(checkProxyPort(5800, DEFAULT_HTTP_PORT_PROD)).toBeNull();
    expect(checkProxyPort(1, DEFAULT_HTTP_PORT_PROD)).toBeNull();
    expect(checkProxyPort(65535, DEFAULT_HTTP_PORT_PROD)).toBeNull();
  });

  it('never fires on the shipped defaults', () => {
    expect(checkProxyPort(BRIDGE_DEFAULT_TCP_PORT, DEFAULT_HTTP_PORT_PROD)).toBeNull();
    expect(checkProxyPort(BRIDGE_DEFAULT_TCP_PORT_DEV, DEFAULT_HTTP_PORT_DEV)).toBeNull();
  });

  it('rejects the app’s own HTTP port', () => {
    const msg = checkProxyPort(DEFAULT_HTTP_PORT_PROD, DEFAULT_HTTP_PORT_PROD);
    expect(msg).toContain('7654');
    expect(msg).toMatch(/api server/i);
    expect(checkProxyPort(DEFAULT_HTTP_PORT_DEV, DEFAULT_HTTP_PORT_DEV)).not.toBeNull();
  });

  it('leaves the other instance’s port alone', () => {
    // A prod install configured onto the dev port only collides if both run at
    // once, which raises a real EADDRINUSE. Not ours to forbid.
    expect(checkProxyPort(DEFAULT_HTTP_PORT_DEV, DEFAULT_HTTP_PORT_PROD)).toBeNull();
    expect(checkProxyPort(DEFAULT_HTTP_PORT_PROD, DEFAULT_HTTP_PORT_DEV)).toBeNull();
  });

  it.each([0, -1, 65536, 1.5, Number.NaN])('rejects the out-of-range port %p', (port) => {
    expect(checkProxyPort(port, DEFAULT_HTTP_PORT_PROD)).toMatch(/between 1 and 65535/);
  });
});

describe('planBridgeBinding', () => {
  it('binds the listener in the normal case', () => {
    expect(planBridgeBinding({ enabled: true, port: BRIDGE_DEFAULT_TCP_PORT }, DEFAULT_HTTP_PORT_PROD)).toEqual({
      enableTcp: true,
      conflict: null,
    });
  });

  it('does not brick boot when the proxy port is the HTTP port', () => {
    // The regression this exists for: the bridge binds before the HTTP server,
    // and nothing walks to a free port any more. If the listener were allowed
    // to take 7654 the API server could not start, bootstrap would quit before
    // a window existed, and the setting could only be undone by hand-editing
    // app-settings.json. Drop the listener, keep the app.
    const plan = planBridgeBinding({ enabled: true, port: DEFAULT_HTTP_PORT_PROD }, DEFAULT_HTTP_PORT_PROD);
    expect(plan.enableTcp).toBe(false);
    expect(plan.conflict).toContain('7654');
  });

  it('does the same for a dev instance', () => {
    const plan = planBridgeBinding({ enabled: true, port: DEFAULT_HTTP_PORT_DEV }, DEFAULT_HTTP_PORT_DEV);
    expect(plan.enableTcp).toBe(false);
    expect(plan.conflict).toContain('7754');
  });

  it('reports a conflict for a nonsense stored port too', () => {
    const plan = planBridgeBinding({ enabled: true, port: 0 }, DEFAULT_HTTP_PORT_PROD);
    expect(plan.enableTcp).toBe(false);
    expect(plan.conflict).not.toBeNull();
  });

  it('is silent when the proxy is simply off', () => {
    // Disabled is not a conflict — nothing to explain in the UI.
    expect(planBridgeBinding({ enabled: false, port: DEFAULT_HTTP_PORT_PROD }, DEFAULT_HTTP_PORT_PROD)).toEqual({
      enableTcp: false,
      conflict: null,
    });
  });
});
