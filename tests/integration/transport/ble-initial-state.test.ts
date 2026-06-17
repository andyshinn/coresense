import { describe, expect, it, vi } from 'vitest';

// BleTransport's constructor only touches noble via `noble.on('discover', …)`.
// Stub the native module so the transport can be constructed in the node test
// env without a real BLE adapter present.
vi.mock('@stoprocent/noble', () => ({
  default: {
    on: vi.fn(),
    removeListener: vi.fn(),
    startScanning: vi.fn(),
    stopScanning: vi.fn(),
    state: 'poweredOn',
  },
}));

import { BleTransport } from '../../../src/main/transport/ble';

describe('BleTransport lib-transport initial state', () => {
  it('reports a disconnected state before any BLE link exists', () => {
    const t = new BleTransport();
    // Regression: createBleTransport seeds getState() to 'connected'. coresense
    // builds this transport once at app launch, long before any link, so a
    // 'connected' default is a lie — it made MeshCoreSession.start() fire a
    // doomed handshake against a dead link and then SUPPRESS the handshake on
    // the first real connect (the !wasConnected→connected transition never
    // happens), so the first BLE session never synced. The transport must
    // report 'idle' until connect() actually brings a link up.
    expect(t.libTransport.getState()).toBe('idle');
  });
});
