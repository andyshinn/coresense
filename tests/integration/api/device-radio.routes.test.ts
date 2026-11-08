import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRadioLimits, maxTxPowerFromFrame, observeRadioLimits } from '../../../src/main/device/radioLimits';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { stateHolder } from '../../../src/main/state/holder';
import { transportManager } from '../../../src/main/transport/manager';
import type { ApiErrorBody } from '../../../src/shared/api/contract';
import {
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_RADIO_LIMITS,
  DEFAULT_RADIO_SETTINGS,
  DEFAULT_SYNC_PROGRESS,
  type DeviceIdentity,
  type RadioSettings,
  type RawPacket,
} from '../../../src/shared/types';
import { installSessionStub, json, testRoutes } from '../../support/api';
import { captureBus } from '../../support/bus';

type RadioParams = Parameters<SessionAdapter['setRadioParams']>[0];

const put = (path: string, body: unknown) => testRoutes().request(path, json('PUT', body));

/** What the radio last reported: deliberately unlike DEFAULT_RADIO_SETTINGS. */
const ON_RADIO: RadioSettings = {
  ...DEFAULT_RADIO_SETTINGS,
  frequencyHz: 869_525_000,
  bandwidthHz: 250_000,
  spreadingFactor: 11,
  codingRate: 5,
  txPowerDbm: 14,
};

const IDENTITY: DeviceIdentity = {
  ...DEFAULT_DEVICE_IDENTITY,
  name: 'Base',
  publicKeyHex: 'ab'.repeat(32),
  lat: 45.5,
  lon: -122.6,
};

function radioStub() {
  const setRadioParams = vi.fn((_p: RadioParams) => Promise.resolve(true));
  const setPathHashMode = vi.fn((_size: 1 | 2 | 3) => Promise.resolve());
  const setAdvertName = vi.fn((_name: string) => Promise.resolve(true));
  const setAdvertLatLon = vi.fn((_lat: number, _lon: number) => Promise.resolve(true));
  installSessionStub({ setRadioParams, setPathHashMode, setAdvertName, setAdvertLatLon });
  return { setRadioParams, setPathHashMode, setAdvertName, setAdvertLatLon };
}

function selfInfoPacket(maxTx: number): RawPacket {
  const bytes = [5, 1, 14, maxTx, ...new Array(60).fill(0)];
  return {
    timestamp: 0,
    transportType: 'ble',
    kind: 'companion',
    hex: '',
    bytes,
    payloadHex: '',
    payloadBytes: bytes.slice(1),
    code: 5,
  };
}

afterEach(() => {
  // The holder is a per-file singleton; don't leak limits between tests.
  stateHolder().setRadioLimits({ ...DEFAULT_RADIO_LIMITS });
});

describe('PUT /api/device/identity: write validation', () => {
  it.each([
    [{ name: '' }, 'Name must not be empty'],
    [{ name: '   ' }, 'Name must not be empty'],
    [{ name: 'bad\nname' }, 'Name must not contain control characters'],
    [{ name: '中'.repeat(11) }, 'Name must be at most 31 bytes (it is 33)'],
    [{ lat: 90.5 }, 'Latitude must be between -90 and 90'],
    [{ lon: -181 }, 'Longitude must be between -180 and 180'],
  ])('refuses %j with a 400 naming the problem, and writes nothing', async (body, message) => {
    stateHolder().setDeviceIdentity(IDENTITY);
    const radio = radioStub();
    transportManager.setState('connected');

    const res = await put('/api/device/identity', body);

    expect(res.status).toBe(400);
    const err = (await res.json()) as ApiErrorBody;
    expect(err.code).toBe('invalid_body');
    expect(err.issues?.map((i) => i.message)).toContain(message);
    expect(radio.setAdvertName).not.toHaveBeenCalled();
    expect(radio.setAdvertLatLon).not.toHaveBeenCalled();
  });

  it('sends the trimmed, NFC-normalised name', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    const radio = radioStub();
    transportManager.setState('connected');

    const res = await put('/api/device/identity', { name: '  Café ' });

    expect(res.status).toBe(200);
    expect(radio.setAdvertName).toHaveBeenCalledWith('Café');
  });

  it('accepts six decimal places: only My Node limits input to five', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    const radio = radioStub();
    transportManager.setState('connected');

    const res = await put('/api/device/identity', { lat: 45.123456, lon: -122.654321 });

    expect(res.status).toBe(200);
    expect(radio.setAdvertLatLon).toHaveBeenCalledWith(45.123456, -122.654321);
  });

  it('still accepts a null position', async () => {
    stateHolder().setDeviceIdentity(IDENTITY);
    radioStub();

    const res = await put('/api/device/identity', { lat: null, lon: null });

    expect(res.status).toBe(200);
  });
});

describe('PUT /api/device/radio', () => {
  it('merges the patch onto the radio values the holder has, not a client copy', async () => {
    stateHolder().setRadioSettings(ON_RADIO);
    stateHolder().setRadioLimits({ minTxPowerDbm: -9, maxTxPowerDbm: 22 });
    const radio = radioStub();
    transportManager.setState('connected');

    const res = await put('/api/device/radio', { txPowerDbm: 20 });

    expect(res.status).toBe(200);
    expect(radio.setRadioParams).toHaveBeenCalledWith({
      frequencyHz: ON_RADIO.frequencyHz,
      bandwidthHz: ON_RADIO.bandwidthHz,
      spreadingFactor: ON_RADIO.spreadingFactor,
      codingRate: ON_RADIO.codingRate,
      txPowerDbm: 20,
      repeatMode: ON_RADIO.repeatMode,
    });
    expect(radio.setPathHashMode).not.toHaveBeenCalled();
  });

  it('refuses a TX power above the radio maximum with a 400, sending nothing', async () => {
    stateHolder().setRadioSettings(ON_RADIO);
    stateHolder().setRadioLimits({ minTxPowerDbm: -9, maxTxPowerDbm: 20 });
    const radio = radioStub();
    transportManager.setState('connected');

    const res = await put('/api/device/radio', { txPowerDbm: 21 });

    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).issues).toEqual([
      { path: 'txPowerDbm', message: 'TX power must be at most 20 dBm on this radio' },
    ]);
    expect(radio.setRadioParams).not.toHaveBeenCalled();
  });

  it('refuses a TX power below the firmware minimum', async () => {
    stateHolder().setRadioSettings(ON_RADIO);
    stateHolder().setRadioLimits({ minTxPowerDbm: -9, maxTxPowerDbm: 20 });
    radioStub();
    transportManager.setState('connected');

    const res = await put('/api/device/radio', { txPowerDbm: -10 });

    expect(res.status).toBe(400);
  });

  it('refuses a TX write before the radio has reported its maximum', async () => {
    stateHolder().setRadioSettings(ON_RADIO);
    const radio = radioStub();
    transportManager.setState('connected');

    const res = await put('/api/device/radio', { txPowerDbm: 10 });

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'TX power limit not known yet' });
    expect(radio.setRadioParams).not.toHaveBeenCalled();
  });

  it('needs a radio', async () => {
    radioStub();

    const res = await put('/api/device/radio', { txPowerDbm: 10 });

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'no radio attached' });
  });

  it('refuses a patch with no radio fields in it', async () => {
    radioStub();
    transportManager.setState('connected');

    expect((await put('/api/device/radio', {})).status).toBe(400);
    // pathHashMode has its own route; it is not part of this patch.
    expect((await put('/api/device/radio', { pathHashMode: 2 })).status).toBe(400);
  });
});

describe('PUT /api/settings/radio: TX power', () => {
  it('refuses a TX power above the connected radio maximum', async () => {
    stateHolder().setRadioSettings(ON_RADIO);
    stateHolder().setRadioLimits({ minTxPowerDbm: -9, maxTxPowerDbm: 20 });
    const radio = radioStub();
    transportManager.setState('connected');

    const res = await put('/api/settings/radio', { ...ON_RADIO, txPowerDbm: 22 });

    expect(res.status).toBe(400);
    expect(radio.setRadioParams).not.toHaveBeenCalled();
  });

  it('checks only the firmware minimum for an app-side save with the maximum unknown', async () => {
    stateHolder().setRadioSettings(ON_RADIO);
    radioStub();

    expect((await put('/api/settings/radio', { ...ON_RADIO, txPowerDbm: 22 })).status).toBe(200);
    expect((await put('/api/settings/radio', { ...ON_RADIO, txPowerDbm: -10 })).status).toBe(400);
  });
});

describe('radio limits from RESP_SELF_INFO', () => {
  it('reads byte 3 of a SELF_INFO frame and nothing else', () => {
    expect(maxTxPowerFromFrame([5, 1, 14, 22, 0])).toBe(22);
    expect(maxTxPowerFromFrame([13, 1, 14, 22])).toBeNull();
    expect(maxTxPowerFromFrame([5, 1, 14])).toBeNull();
  });

  it('records and broadcasts the maximum once, then clears it on disconnect', () => {
    const broadcast = captureBus('radioLimits');

    observeRadioLimits(selfInfoPacket(20));
    observeRadioLimits(selfInfoPacket(20));

    expect(stateHolder().getRadioLimits()).toEqual({ minTxPowerDbm: -9, maxTxPowerDbm: 20 });
    expect(broadcast.values).toEqual([{ minTxPowerDbm: -9, maxTxPowerDbm: 20 }]);

    clearRadioLimits();
    clearRadioLimits();

    expect(stateHolder().getRadioLimits()).toEqual(DEFAULT_RADIO_LIMITS);
    expect(broadcast.values).toHaveLength(2);
  });

  it('serves the limits in the snapshot', async () => {
    stateHolder().setRadioLimits({ minTxPowerDbm: -9, maxTxPowerDbm: 30 });
    installSessionStub({ getDevicePresence: () => [], getSyncProgress: () => DEFAULT_SYNC_PROGRESS });

    const res = await testRoutes().request('/api/state/snapshot');

    expect(((await res.json()) as { radioLimits: unknown }).radioLimits).toEqual({
      minTxPowerDbm: -9,
      maxTxPowerDbm: 30,
    });
  });
});
