import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { clampTelemetryRetention, telemetryRetentionOf, withTelemetryRetention } from '@/lib/telemetryRetention';
import { TELEMETRY_RETENTION_DEFAULT } from '../../../../src/shared/telemetry/types';
import { type AppSettings, DEFAULT_APP_SETTINGS } from '../../../../src/shared/types';

const client = { baseUrl: 'http://x', apiKey: 'k' };
const KEY = `c:${'ab'.repeat(32)}`;

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function call(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls[0];
  return { url: String(url), method: (init as RequestInit).method ?? 'GET', body: (init as RequestInit).body };
}

describe('telemetry api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requestTelemetry POSTs to the encoded node key and returns the saved request', async () => {
    const saved = { id: 'r1', outcome: 'timeout' };
    const f = stubFetch(saved);
    await expect(api.requestTelemetry(client, KEY)).resolves.toEqual(saved);
    expect(call(f)).toMatchObject({ url: `http://x/api/telemetry/c%3A${'ab'.repeat(32)}/request`, method: 'POST' });
  });

  it('requestTelemetry surfaces 409 radio_busy as an ApiError', async () => {
    stubFetch({ error: 'radio busy', code: 'radio_busy' }, 409);
    await expect(api.requestTelemetry(client, KEY)).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'radio_busy',
      message: 'radio busy',
    });
    await expect(api.requestTelemetry(client, KEY)).rejects.toBeInstanceOf(ApiError);
  });

  it('listTelemetry GETs the node list', async () => {
    const f = stubFetch([]);
    await api.listTelemetry(client, 'ab'.repeat(32));
    expect(call(f)).toEqual({ url: `http://x/api/telemetry/${'ab'.repeat(32)}`, method: 'GET', body: undefined });
  });

  it('getTelemetryRequest / deleteTelemetryRequest use the literal request route', async () => {
    let f = stubFetch({ id: 'a/b', previous: [] });
    await api.getTelemetryRequest(client, 'a/b');
    expect(call(f)).toMatchObject({ url: 'http://x/api/telemetry/request/a%2Fb', method: 'GET' });
    f = stubFetch({ ok: true });
    await api.deleteTelemetryRequest(client, 'r1');
    expect(call(f)).toMatchObject({ url: 'http://x/api/telemetry/request/r1', method: 'DELETE' });
  });

  it('clearTelemetry DELETEs the node', async () => {
    const f = stubFetch({ ok: true });
    await api.clearTelemetry(client, KEY);
    expect(call(f)).toMatchObject({ url: `http://x/api/telemetry/c%3A${'ab'.repeat(32)}`, method: 'DELETE' });
  });

  it('putContactTelemetryPerms PUTs the three flags', async () => {
    const f = stubFetch({ ok: true });
    await api.putContactTelemetryPerms(client, KEY, { base: true, loc: false, env: true });
    const c = call(f);
    expect(c).toMatchObject({ url: `http://x/api/contacts/c%3A${'ab'.repeat(32)}/telemetry-perms`, method: 'PUT' });
    expect(JSON.parse(c.body as string)).toEqual({ base: true, loc: false, env: true });
  });

  it('sensor settings: GET returns the map, PUT sends one key', async () => {
    let f = stubFetch({ gps: '1' });
    await expect(api.getSensorSettings(client)).resolves.toEqual({ gps: '1' });
    expect(call(f)).toMatchObject({ url: 'http://x/api/device/custom-vars', method: 'GET' });
    f = stubFetch({ ok: true });
    await api.putSensorSetting(client, 'gps_interval', '300');
    const c = call(f);
    expect(c).toMatchObject({ url: 'http://x/api/device/custom-vars', method: 'PUT' });
    expect(JSON.parse(c.body as string)).toEqual({ key: 'gps_interval', value: '300' });
  });

  it('putTelemetryRetention PUTs the whole AppSettings with the clamped value', async () => {
    const f = stubFetch({ ok: true });
    await api.putTelemetryRetention(client, DEFAULT_APP_SETTINGS, 9999);
    const c = call(f);
    expect(c).toMatchObject({ url: 'http://x/api/settings/app', method: 'PUT' });
    const sent = JSON.parse(c.body as string);
    expect(sent.telemetry).toEqual({ retentionPerNode: 500 });
    expect(sent.timeFormat).toBe(DEFAULT_APP_SETTINGS.timeFormat);
  });
});

describe('telemetry retention helpers', () => {
  it('clamps into 1–500 and falls back to the default for garbage', () => {
    expect(clampTelemetryRetention(0)).toBe(1);
    expect(clampTelemetryRetention(501)).toBe(500);
    expect(clampTelemetryRetention(12.9)).toBe(12);
    expect(clampTelemetryRetention('20')).toBe(TELEMETRY_RETENTION_DEFAULT);
    expect(clampTelemetryRetention(Number.NaN)).toBe(TELEMETRY_RETENTION_DEFAULT);
  });

  it('reads the setting, and the default from settings that predate the field', () => {
    const { telemetry: _telemetry, ...older } = DEFAULT_APP_SETTINGS;
    expect(telemetryRetentionOf(older as AppSettings)).toBe(TELEMETRY_RETENTION_DEFAULT);
    expect(telemetryRetentionOf({ ...DEFAULT_APP_SETTINGS, telemetry: { retentionPerNode: 7 } })).toBe(7);
  });

  it('keeps the current retention for a non-number (a cleared input) rather than shrinking to the default', () => {
    const current = { ...DEFAULT_APP_SETTINGS, telemetry: { retentionPerNode: 300 } };
    expect(withTelemetryRetention(current, Number.NaN).telemetry.retentionPerNode).toBe(300);
    expect(withTelemetryRetention(current, 20).telemetry.retentionPerNode).toBe(20);
  });
});
