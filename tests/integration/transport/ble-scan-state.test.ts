import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportState } from '../../../src/shared/types';

// Minimal noble stub. `startScanning`/`stopScanning` take a node-style callback
// the transport awaits, so both must invoke it or the awaits never settle.
// vi.hoisted because vi.mock's factory is lifted above the module body.
const nobleMock = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
  startScanning: vi.fn((_uuids?: string[], _dup?: boolean, cb?: (err?: Error | null) => void) => cb?.(null)),
  stopScanning: vi.fn((cb?: () => void) => cb?.()),
  state: 'poweredOn',
}));

vi.mock('@stoprocent/noble', () => ({ default: nobleMock }));

import { bus } from '../../../src/main/events/bus';
import { BleTransport } from '../../../src/main/transport/ble';

type StateEvent = { state: TransportState; deviceId?: string };

function recordTransportState(): StateEvent[] {
  const seen: StateEvent[] = [];
  bus.on('transportState', (state: TransportState, deviceId?: string) => seen.push({ state, deviceId }));
  return seen;
}

/** Plant a connected peripheral without going through the GATT dance. `connect()`
 *  needs a real noble peripheral with services and characteristics; every
 *  assertion here is about what the transport does while `peripheral` is set. */
function withPeripheral(t: BleTransport, id: string): void {
  (t as unknown as { peripheral: { id: string } | null }).peripheral = { id };
}

describe('BleTransport scan vs. a live link', () => {
  beforeEach(() => {
    nobleMock.startScanning.mockClear();
    nobleMock.stopScanning.mockClear();
    nobleMock.removeListener.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a scan while a radio is connected instead of latching "scanning"', async () => {
    const t = new BleTransport();
    withPeripheral(t, 'radio-1');
    const seen = recordTransportState();

    // Regression: scan() emitted transportState('scanning') unconditionally and
    // with no deviceId, and stopScan() restored 'idle' only when NO peripheral
    // was held — so a scan started while connected left transportManager
    // latched at 'scanning' for the life of the link (connect() holds the only
    // other emit of 'connected'). Contact refresh and advert-path measurement
    // then report 'offline', the auto-add write silently no-ops, and four
    // settings routes take their "no radio attached" branch and return ok
    // without writing to the wire. The BLE panel gates its ScanButton on the
    // state, but the command palette's "Scan for radios" did not.
    await expect(t.scan()).rejects.toThrow(/Already connected to radio-1/);

    expect(seen).toEqual([]);
    expect(nobleMock.startScanning).not.toHaveBeenCalled();
  });

  it('leaves the discovered map alone when it refuses', async () => {
    const t = new BleTransport();
    const discovered = (t as unknown as { discovered: Map<string, unknown> }).discovered;
    discovered.set('radio-1', { id: 'radio-1', name: 'MeshCore-1', rssi: -50 });
    withPeripheral(t, 'radio-1');

    // scan() clears `discovered` before it starts, and findPeripheral's fast
    // path reads that map to skip a scan window on reconnect.
    await expect(t.scan()).rejects.toThrow();
    expect(discovered.has('radio-1')).toBe(true);
  });

  it('restores the connected state when a link comes up mid-scan window', async () => {
    const t = new BleTransport();
    await t.scan();
    const seen = recordTransportState();
    // The belt-and-braces case scan()'s refusal cannot cover: the scan started
    // legitimately with no link, and one came up before the 10s window closed.
    withPeripheral(t, 'radio-1');

    await t.stopScan();

    // 'connected' with the radio's id, never 'idle' and never leaving the
    // app's last-heard state as the scan's 'scanning'.
    expect(seen).toEqual([{ state: 'connected', deviceId: 'radio-1' }]);
  });

  it('still reports idle when a scan is stopped with no link', async () => {
    const t = new BleTransport();
    await t.scan();
    const seen = recordTransportState();

    await t.stopScan();

    expect(seen).toEqual([{ state: 'idle', deviceId: undefined }]);
  });

  it('announces nothing when a stop lands with a link up and no scan running', async () => {
    const t = new BleTransport();
    withPeripheral(t, 'radio-1');
    const seen = recordTransportState();

    // connect() opens with stopScan(). Re-announcing the OLD peripheral as
    // 'connected' one line before connect() announces 'connecting' would be
    // noise, and server.ts applies every emit, so it must not happen.
    await t.stopScan();

    expect(seen).toEqual([]);
  });

  it('stops scanning when a connect finds no peripheral in the scan window', async () => {
    vi.useFakeTimers();
    const t = new BleTransport();

    const attempt = t.connect('missing-radio');
    const expectation = expect(attempt).rejects.toThrow(/not found within scan window/);
    await vi.advanceTimersByTimeAsync(0);
    expect(nobleMock.startScanning).toHaveBeenCalledTimes(1);
    const stopsBeforeTimeout = nobleMock.stopScanning.mock.calls.length;

    // Regression: the scan-window timeout dropped the 'discover' listener and
    // rejected, but never called noble.stopScanning(), and nothing on
    // connect()'s failure path calls stopScan() either. noble kept scanning for
    // the rest of the process — the constructor's own listener refilling
    // `discovered` and re-arming the 200ms emit timer, so emit.scanResults
    // broadcast to every WS client forever — while the UI reported 'idle'.
    // Reconnecting to a radio that is switched off is the everyday way in.
    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;

    expect(nobleMock.stopScanning.mock.calls.length).toBeGreaterThan(stopsBeforeTimeout);
  });
});
