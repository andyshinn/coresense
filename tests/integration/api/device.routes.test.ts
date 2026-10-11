import { describe, expect, it, vi } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { transportManager } from '../../../src/main/transport/manager';
import type { ApiErrorBody, OkResponse } from '../../../src/shared/api/contract';
import {
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_GPS_CONFIG,
  DEFAULT_TELEMETRY_POLICY,
  type DeviceIdentity,
  type GpsConfig,
  type TelemetryPolicy,
} from '../../../src/shared/types';
import { installSessionStub, json, testRoutes } from '../../support/api';
import { captureBus } from '../../support/bus';

const IDENTITY: DeviceIdentity = {
  ...DEFAULT_DEVICE_IDENTITY,
  name: 'Base',
  publicKeyHex: 'ab'.repeat(32),
  lat: 45.5,
  lon: -122.6,
  sharePositionInAdvert: false,
};

/** What the radio reports from RESP_SELF_INFO, unlike the holder's copy. */
const RADIO_POLICY: TelemetryPolicy = { base: 2, loc: 2, env: 2, multiAcks: 0 };

const put = (path: string, body: unknown) => testRoutes().request(path, json('PUT', body));
const post = (path: string) => testRoutes().request(path, { method: 'POST' });

describe('PUT /api/device/identity', () => {
  it('stores the merged identity and broadcasts it while disconnected, without touching the radio', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    const setAdvertName = vi.fn(() => Promise.resolve(true));
    installSessionStub({ setAdvertName });
    const broadcast = captureBus('deviceIdentity');

    const res = await put('/api/device/identity', { name: 'Staged' });

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(stateHolder().getDeviceIdentity()).toEqual({ ...IDENTITY, name: 'Staged' });
    expect(broadcast.last()).toEqual({ ...IDENTITY, name: 'Staged' });
    expect(setAdvertName).not.toHaveBeenCalled();
  });

  it('pushes a changed name to the radio when connected and leaves local state to its reply', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    const setAdvertName = vi.fn(() => Promise.resolve(true));
    installSessionStub({ setAdvertName });
    transportManager.setState('connected');
    const broadcast = captureBus('deviceIdentity');

    const res = await put('/api/device/identity', { name: 'Renamed' });

    expect(res.status).toBe(200);
    expect(setAdvertName).toHaveBeenCalledWith('Renamed');
    expect(stateHolder().getDeviceIdentity().name).toBe('Base');
    expect(broadcast.calls).toHaveLength(0);
  });

  it('sends lat/lon together, filling the unchanged half from the current identity', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    const setAdvertLatLon = vi.fn(() => Promise.resolve(true));
    installSessionStub({ setAdvertLatLon });
    transportManager.setState('connected');

    const res = await put('/api/device/identity', { lat: 10 });

    expect(res.status).toBe(200);
    expect(setAdvertLatLon).toHaveBeenCalledWith(10, IDENTITY.lon);
  });

  it('sends share-position through SET_OTHER_PARAMS without the manual-add byte', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    // The holder's copy is stale: the frame must carry the RADIO's policy.
    stateHolder().setTelemetryPolicy(DEFAULT_TELEMETRY_POLICY);
    const setOtherParams = vi.fn((..._args: unknown[]) => Promise.resolve(true));
    installSessionStub({ setOtherParams, readTelemetryPolicy: () => Promise.resolve(RADIO_POLICY) });
    transportManager.setState('connected');

    const res = await put('/api/device/identity', { sharePositionInAdvert: true });

    expect(res.status).toBe(200);
    // A third argument would rewrite the radio's auto-add master switch.
    expect(setOtherParams.mock.calls).toEqual([[RADIO_POLICY, true]]);
  });

  it('does not write fields that did not change', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    const setAdvertName = vi.fn(() => Promise.resolve(true));
    const setAdvertLatLon = vi.fn(() => Promise.resolve(true));
    const setOtherParams = vi.fn(() => Promise.resolve(true));
    installSessionStub({ setAdvertName, setAdvertLatLon, setOtherParams });
    transportManager.setState('connected');

    const res = await put('/api/device/identity', IDENTITY);

    expect(res.status).toBe(200);
    expect(setAdvertName).not.toHaveBeenCalled();
    expect(setAdvertLatLon).not.toHaveBeenCalled();
    expect(setOtherParams).not.toHaveBeenCalled();
  });

  it('answers 503 naming the command when the radio rejects it', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    installSessionStub({ setAdvertName: () => Promise.resolve(false) });
    transportManager.setState('connected');

    const res = await put('/api/device/identity', { name: 'Renamed' });

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'SET_ADVERT_NAME rejected by radio' });
  });

  // The device-settings service turns a throw into a rejection, so a dropped
  // link is a 503 like any other radio failure, not a 500 `internal`.
  it('answers 503 with the message when a setter throws', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    installSessionStub({ setAdvertName: () => Promise.reject(new Error('link lost')) });
    transportManager.setState('connected');

    const res = await put('/api/device/identity', { name: 'Renamed' });

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'link lost' });
  });

  it('stops at the first failure and sends nothing after it', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    const setAdvertLatLon = vi.fn(() => Promise.resolve(true));
    installSessionStub({ setAdvertName: () => Promise.resolve(false), setAdvertLatLon });
    transportManager.setState('connected');

    const res = await put('/api/device/identity', { name: 'Renamed', lat: 1, lon: 2 });

    expect(res.status).toBe(503);
    expect(setAdvertLatLon).not.toHaveBeenCalled();
  });
});

describe('PUT /api/device/telemetry-policy', () => {
  const POLICY: TelemetryPolicy = { base: 2, loc: 0, env: 1, multiAcks: 2 };

  it('stores and broadcasts the policy while disconnected, without touching the radio', async () => {
    stateHolder().setTelemetryPolicy(DEFAULT_TELEMETRY_POLICY);
    const setOtherParams = vi.fn(() => Promise.resolve(true));
    installSessionStub({ setOtherParams });
    const broadcast = captureBus('telemetryPolicy');

    const res = await put('/api/device/telemetry-policy', POLICY);

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(stateHolder().getTelemetryPolicy()).toEqual(POLICY);
    expect(broadcast.values).toEqual([POLICY]);
    expect(setOtherParams).not.toHaveBeenCalled();
  });

  it('pushes the policy with the current share-position flag and no manual-add byte when connected', async () => {
    stateHolder().setDeviceIdentity({ ...IDENTITY, sharePositionInAdvert: true });
    const setOtherParams = vi.fn((..._args: unknown[]) => Promise.resolve(true));
    installSessionStub({ setOtherParams, readTelemetryPolicy: () => Promise.resolve(RADIO_POLICY) });
    transportManager.setState('connected');

    const res = await put('/api/device/telemetry-policy', POLICY);

    expect(res.status).toBe(200);
    expect(setOtherParams.mock.calls).toEqual([[POLICY, true]]);
    expect(stateHolder().getTelemetryPolicy()).toEqual(POLICY);
  });

  it('merges a partial body onto the radio-held policy, not the local copy', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    stateHolder().setTelemetryPolicy(DEFAULT_TELEMETRY_POLICY);
    const setOtherParams = vi.fn((..._args: unknown[]) => Promise.resolve(true));
    installSessionStub({ setOtherParams, readTelemetryPolicy: () => Promise.resolve(RADIO_POLICY) });
    transportManager.setState('connected');

    const res = await put('/api/device/telemetry-policy', { env: 0 });

    expect(res.status).toBe(200);
    expect(setOtherParams.mock.calls).toEqual([[{ ...RADIO_POLICY, env: 0 }, false]]);
    expect(stateHolder().getTelemetryPolicy()).toEqual({ ...RADIO_POLICY, env: 0 });
  });

  it('answers 503 when the radio rejects it, leaving the radio-held policy in place', async () => {
    stateHolder().setTelemetryPolicy(DEFAULT_TELEMETRY_POLICY);
    installSessionStub({
      setOtherParams: () => Promise.resolve(false),
      readTelemetryPolicy: () => Promise.resolve(RADIO_POLICY),
    });
    transportManager.setState('connected');

    const res = await put('/api/device/telemetry-policy', POLICY);

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'SET_OTHER_PARAMS rejected by radio' });
    // The UI must not show a policy the radio refused.
    expect(stateHolder().getTelemetryPolicy()).toEqual(RADIO_POLICY);
  });

  it('answers 503 with the message when the setter throws', async () => {
    installSessionStub({
      setOtherParams: () => Promise.reject(new Error('write failed')),
      readTelemetryPolicy: () => Promise.resolve(RADIO_POLICY),
    });
    transportManager.setState('connected');

    const res = await put('/api/device/telemetry-policy', POLICY);

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'write failed' });
  });
});

describe('PUT /api/device/gps', () => {
  const GPS: GpsConfig = { enabled: true, intervalSec: 900 };

  it('stores and broadcasts the config while disconnected, without touching the radio', async () => {
    stateHolder().setGpsConfig(DEFAULT_GPS_CONFIG);
    const setGpsConfig = vi.fn(() => Promise.resolve(true));
    installSessionStub({ setGpsConfig });
    const broadcast = captureBus('gpsConfig');

    const res = await put('/api/device/gps', GPS);

    expect(res.status).toBe(200);
    expect(stateHolder().getGpsConfig()).toEqual(GPS);
    expect(broadcast.values).toEqual([GPS]);
    expect(setGpsConfig).not.toHaveBeenCalled();
  });

  it('pushes the config when connected', async () => {
    const setGpsConfig = vi.fn((_cfg: GpsConfig) => Promise.resolve(true));
    installSessionStub({ setGpsConfig });
    transportManager.setState('connected');

    const res = await put('/api/device/gps', GPS);

    expect(res.status).toBe(200);
    expect(setGpsConfig).toHaveBeenCalledWith(GPS);
  });

  it('leaves local state to the radio reply when connected', async () => {
    stateHolder().setGpsConfig(DEFAULT_GPS_CONFIG);
    installSessionStub({ setGpsConfig: () => Promise.resolve(true) });
    transportManager.setState('connected');
    const broadcast = captureBus('gpsConfig');

    await put('/api/device/gps', GPS);

    expect(stateHolder().getGpsConfig()).toEqual(DEFAULT_GPS_CONFIG);
    expect(broadcast.values).toEqual([]);
  });

  it('answers 503 and keeps the previous config when the radio rejects it', async () => {
    stateHolder().setGpsConfig(DEFAULT_GPS_CONFIG);
    installSessionStub({ setGpsConfig: () => Promise.resolve(false) });
    transportManager.setState('connected');
    const broadcast = captureBus('gpsConfig');

    const res = await put('/api/device/gps', GPS);

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({
      error: 'Radio refused the GPS change. It may have no GPS module, or none was detected at boot.',
    });
    expect(stateHolder().getGpsConfig()).toEqual(DEFAULT_GPS_CONFIG);
    expect(broadcast.values).toEqual([]);
  });

  it('answers 503 with the message when the setter throws', async () => {
    installSessionStub({ setGpsConfig: () => Promise.reject(new Error('timeout')) });
    transportManager.setState('connected');

    const res = await put('/api/device/gps', GPS);

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'timeout' });
  });
});

describe('POST /api/device/refresh', () => {
  function recordingRefresh(customVars: () => Promise<void> = () => Promise.resolve()) {
    const order: string[] = [];
    const record = (name: string) => () => {
      order.push(name);
      return Promise.resolve();
    };
    installSessionStub({
      requestDeviceInfo: record('requestDeviceInfo'),
      requestBattAndStorage: record('requestBattAndStorage'),
      requestAutoAddConfig: record('requestAutoAddConfig'),
      requestCustomVars: (key?: string) => {
        order.push(`requestCustomVars:${key}`);
        return customVars();
      },
    });
    return order;
  }

  it('answers 503 and queries nothing while no radio is attached', async () => {
    const order = recordingRefresh();

    const res = await post('/api/device/refresh');

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'no radio attached' });
    expect(order).toEqual([]);
  });

  it('issues every device query when connected', async () => {
    const order = recordingRefresh();
    transportManager.setState('connected');

    const res = await post('/api/device/refresh');

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(order).toEqual([
      'requestDeviceInfo',
      'requestBattAndStorage',
      'requestAutoAddConfig',
      // One request: firmware ignores the key and returns every setting.
      'requestCustomVars:',
    ]);
  });

  it('does not fail the refresh when the custom-vars read rejects', async () => {
    recordingRefresh(() => Promise.reject(new Error('unsupported')));
    transportManager.setState('connected');

    const res = await post('/api/device/refresh');

    expect(res.status).toBe(200);
  });

  // Regression: the route had no catch, so a query that rejected (the link
  // dropping mid-refresh, a request timeout) escaped to onApiError as a 500
  // `internal`, where every other radio failure in the API is a 503.
  it('answers 503 when a device query rejects', async () => {
    installSessionStub({ requestDeviceInfo: () => Promise.reject(new Error('link lost')) });
    transportManager.setState('connected');

    const res = await post('/api/device/refresh');

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'link lost' });
  });
});

describe('POST /api/device/reboot', () => {
  it('reboots the radio', async () => {
    const reboot = vi.fn(() => Promise.resolve({ ok: true }));
    installSessionStub({ reboot });

    const res = await post('/api/device/reboot');

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(reboot).toHaveBeenCalledOnce();
  });

  it('answers 503 with the radio error when the reboot is refused', async () => {
    installSessionStub({ reboot: () => Promise.resolve({ ok: false, error: 'not connected' }) });

    const res = await post('/api/device/reboot');

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'not connected' });
  });
});

describe('PUT /api/radio/path-hash-mode', () => {
  it('sets the radio-wide path-hash size', async () => {
    const setPathHashMode = vi.fn((_size: 1 | 2 | 3) => Promise.resolve());
    installSessionStub({ setPathHashMode });

    const res = await put('/api/radio/path-hash-mode', { size: 3 });

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(setPathHashMode).toHaveBeenCalledWith(3);
  });

  it('answers 503 with the message when the radio rejects it', async () => {
    installSessionStub({ setPathHashMode: () => Promise.reject(new Error('RESP_ERR')) });

    const res = await put('/api/radio/path-hash-mode', { size: 1 });

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'RESP_ERR' });
  });
});
