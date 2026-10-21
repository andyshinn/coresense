import { afterEach, describe, expect, it, vi } from 'vitest';
import { countsAsUserCommand } from '../../../src/main/api/middleware/userCommandGate';
import { nodeCacheSnapshot, noteTransportState } from '../../../src/main/node/nodeCache';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { commit } from '../../../src/main/state/commit';
import { stateHolder } from '../../../src/main/state/holder';
import { telemetryStore } from '../../../src/main/storage/telemetry';
import { tryAcquireMeshLock } from '../../../src/main/telemetry/meshLock';
import { clearSelfLiveRead, SELF_LIVE_MAX_AGE_MS } from '../../../src/main/telemetry/service';
import { transportManager } from '../../../src/main/transport/manager';
import type { AdvertLinkResponse, ApiErrorBody, DeviceClockResponse } from '../../../src/shared/api/contract';
import { bytesToHex, hexToBytes } from '../../../src/shared/telemetry/lpp';
import type { SavedRequestDto, SelfLiveReadDto } from '../../../src/shared/telemetry/types';
import { DEFAULT_DEVICE_INFO, type DeviceStats, type LocalStats } from '../../../src/shared/types';
import { installSessionStub, json, testRoutes } from '../../support/api';

const OWNER = 'cd'.repeat(32);
const OTHER = 'ef'.repeat(32);
/** ch1 voltage 4.13 V, ch1 temperature 24.1 °C: what a self read returns. */
const SELF_LPP = '017401a1016700f1';

const post = (path: string) => testRoutes().request(path, { method: 'POST' });
const get = (path: string) => testRoutes().request(path);

type StatsSubtype = Parameters<SessionAdapter['repeaterGetLocalStats']>[0];

const CORE: LocalStats = { kind: 'core', battMv: 4100, uptimeSecs: 3600, errFlags: 0, queueLen: 0 };
const RADIO: LocalStats = { kind: 'radio', noiseFloor: -112, lastRssi: -80, lastSnrDb: 7.25, txAirSecs: 12, rxAirSecs: 40 };
const PACKETS: LocalStats = {
  kind: 'packets',
  recv: 100,
  sent: 20,
  nSentFlood: 15,
  nSentDirect: 5,
  nRecvFlood: 80,
  nRecvDirect: 20,
  nRecvErrors: 1,
};
const BY_SUBTYPE: Record<StatsSubtype, LocalStats> = { CORE, RADIO, PACKETS };

function connectAs(owner = OWNER) {
  transportManager.setState('connected', 'ble-1');
  noteTransportState('connected', 'ble-1');
  commit.owner({ name: 'Base', publicKeyHex: owner, publicKeyShort: owner.slice(0, 12) });
}

function session(over: Partial<SessionAdapter> = {}) {
  return installSessionStub({
    requestSelfTelemetry: vi.fn(async () => hexToBytes(SELF_LPP) as Uint8Array),
    repeaterGetLocalStats: vi.fn(async (s: StatsSubtype) => BY_SUBTYPE[s]),
    exportContact: vi.fn(async () => 'AB12'),
    getDeviceTime: vi.fn(async () => 1_760_000_000),
    ...over,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/telemetry/self/live', () => {
  it('returns the decoded reading without saving it, and keeps it in the node cache', async () => {
    session();
    connectAs();

    const res = await post('/api/telemetry/self/live');

    expect(res.status).toBe(200);
    const read = (await res.json()) as SelfLiveReadDto;
    expect(read.rawHex).toBe(SELF_LPP);
    expect(read.readings.map((r) => [r.ch, r.typeId])).toEqual([
      [1, 116],
      [1, 103],
    ]);
    expect(telemetryStore.list(OWNER)).toEqual([]);
    expect(nodeCacheSnapshot().entries[OWNER].lastLive?.rawHex).toBe(SELF_LPP);
  });

  it('answers 501 for firmware without self telemetry', async () => {
    session({
      requestSelfTelemetry: vi.fn(async () => {
        throw new Error('self telemetry unsupported by this firmware: UNSUPPORTED_CMD');
      }),
    });
    connectAs();

    const res = await post('/api/telemetry/self/live');

    expect(res.status).toBe(501);
    expect(((await res.json()) as ApiErrorBody).code).toBe('self_telemetry_unsupported');
  });

  it('answers 503 without a radio, or before SELF_INFO names it', async () => {
    session();
    expect((await post('/api/telemetry/self/live')).status).toBe(503);
    transportManager.setState('connected');
    stateHolder().setOwner(null);
    expect((await post('/api/telemetry/self/live')).status).toBe(503);
  });

  it('answers 409 busy_skip while a mesh request holds the radio, without reading', async () => {
    const s = session();
    connectAs();
    const release = tryAcquireMeshLock('login', 'aa'.repeat(32));

    const res = await post('/api/telemetry/self/live');

    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiErrorBody).code).toBe('busy_skip');
    expect(s.requestSelfTelemetry).not.toHaveBeenCalled();
    release?.();
  });

  it('answers 409 busy_skip while a user command is in flight, then reads once it ends', async () => {
    let finishWrite: (ok: boolean) => void = () => {};
    const s = session({ setAdvertName: vi.fn(() => new Promise<boolean>((r) => (finishWrite = r))) });
    connectAs();
    stateHolder().setDeviceIdentity({ ...stateHolder().getDeviceIdentity(), name: 'Base', publicKeyHex: OWNER });

    const write = testRoutes().request('/api/device/identity', json('PUT', { name: 'Renamed' }));
    await vi.waitFor(() => expect(s.setAdvertName).toHaveBeenCalled());

    expect((await post('/api/telemetry/self/live')).status).toBe(409);
    finishWrite(true);
    expect((await write).status).toBe(200);
    expect((await post('/api/telemetry/self/live')).status).toBe(200);
  });
});

describe('POST /api/telemetry/self/snapshot', () => {
  it('saves exactly the bytes of the last live read as a companion request', async () => {
    session();
    connectAs();
    await post('/api/telemetry/self/live');

    const res = await post('/api/telemetry/self/snapshot');

    expect(res.status).toBe(200);
    const saved = (await res.json()) as SavedRequestDto;
    expect(saved).toMatchObject({ nodeKey: OWNER, source: 'companion', outcome: 'ok', route: 'local', rawHex: SELF_LPP });
    const stored = telemetryStore.list(OWNER);
    expect(stored).toHaveLength(1);
    expect(stored[0].raw && bytesToHex(stored[0].raw)).toBe(SELF_LPP);
  });

  it('answers 409 no_live_read before any read', async () => {
    session();
    connectAs();

    const res = await post('/api/telemetry/self/snapshot');

    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiErrorBody).code).toBe('no_live_read');
    expect(telemetryStore.list(OWNER)).toEqual([]);
  });

  it('answers 409 stale_live_read for a read older than two polls', async () => {
    session();
    connectAs();
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    await post('/api/telemetry/self/live');
    vi.setSystemTime(1_000_000 + SELF_LIVE_MAX_AGE_MS + 1);

    const res = await post('/api/telemetry/self/snapshot');

    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiErrorBody).code).toBe('stale_live_read');
  });

  it('saves a read right at the age limit', async () => {
    session();
    connectAs();
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    await post('/api/telemetry/self/live');
    vi.setSystemTime(1_000_000 + SELF_LIVE_MAX_AGE_MS);

    expect((await post('/api/telemetry/self/snapshot')).status).toBe(200);
  });

  it('does not save radio A’s read under radio B after a switch', async () => {
    session();
    connectAs(OWNER);
    await post('/api/telemetry/self/live');
    transportManager.setState('idle');
    noteTransportState('idle');
    connectAs(OTHER);

    const res = await post('/api/telemetry/self/snapshot');

    expect(res.status).toBe(409);
    expect(telemetryStore.list(OTHER)).toEqual([]);
    expect(telemetryStore.list(OWNER)).toEqual([]);
  });

  it('has nothing to save after a disconnect clears the read', async () => {
    session();
    connectAs();
    await post('/api/telemetry/self/live');

    clearSelfLiveRead();

    expect((await post('/api/telemetry/self/snapshot')).status).toBe(409);
  });
});

describe('POST /api/device/stats', () => {
  it('reads core, radio and packets one at a time and returns them together', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const repeaterGetLocalStats = vi.fn(async (s: StatsSubtype) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return BY_SUBTYPE[s];
    });
    session({ repeaterGetLocalStats });
    connectAs();
    commit.deviceInfo({ ...DEFAULT_DEVICE_INFO, firmwareVerCode: 13 });

    const res = await post('/api/device/stats');

    expect(res.status).toBe(200);
    const stats = (await res.json()) as DeviceStats;
    expect(stats).toMatchObject({ core: CORE, radio: RADIO, packets: PACKETS });
    expect(typeof stats.at).toBe('number');
    expect(repeaterGetLocalStats.mock.calls.map((c) => c[0])).toEqual(['CORE', 'RADIO', 'PACKETS']);
    // The library supersedes an overlapping GET_STATS.
    expect(maxInFlight).toBe(1);
  });

  it('stops between subtypes and answers busy_skip when a user command starts', async () => {
    let release: (() => void) | null = null;
    const repeaterGetLocalStats = vi.fn(async (s: StatsSubtype) => {
      // A mesh request takes the radio while CORE is being read.
      if (s === 'CORE') release = tryAcquireMeshLock('cli', 'aa'.repeat(32));
      return BY_SUBTYPE[s];
    });
    session({ repeaterGetLocalStats });
    connectAs();
    commit.deviceInfo({ ...DEFAULT_DEVICE_INFO, firmwareVerCode: 13 });

    const res = await post('/api/device/stats');

    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiErrorBody).code).toBe('busy_skip');
    expect(repeaterGetLocalStats).toHaveBeenCalledTimes(1);
    (release as (() => void) | null)?.();
  });

  it('answers 501 for firmware older than ver_code 8, without asking', async () => {
    const s = session();
    connectAs();
    commit.deviceInfo({ ...DEFAULT_DEVICE_INFO, firmwareVerCode: 7 });

    const res = await post('/api/device/stats');

    expect(res.status).toBe(501);
    expect(((await res.json()) as ApiErrorBody).code).toBe('stats_unsupported');
    expect(s.repeaterGetLocalStats).not.toHaveBeenCalled();
  });

  it('answers 503 with the message when a read fails', async () => {
    session({ repeaterGetLocalStats: vi.fn(async () => Promise.reject(new Error('GET_STATS timed out'))) });
    connectAs();
    commit.deviceInfo({ ...DEFAULT_DEVICE_INFO, firmwareVerCode: 13 });

    const res = await post('/api/device/stats');

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'GET_STATS timed out' });
  });

  it('needs a radio', async () => {
    session();
    expect((await post('/api/device/stats')).status).toBe(503);
  });
});

describe('GET /api/device/advert-link', () => {
  it('exports the radio’s own advert once and serves it as a meshcore:// link', async () => {
    const s = session();
    connectAs();

    const first = await get('/api/device/advert-link');
    const second = await get('/api/device/advert-link');

    expect(first.status).toBe(200);
    expect((await first.json()) as AdvertLinkResponse).toEqual({ hex: 'ab12', uri: 'meshcore://ab12' });
    expect(second.status).toBe(200);
    expect(s.exportContact).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when the radio refuses, or without a radio', async () => {
    session({ exportContact: vi.fn(async () => null) });
    expect((await get('/api/device/advert-link')).status).toBe(503);
    connectAs();
    expect((await get('/api/device/advert-link')).status).toBe(503);
  });
});

describe('GET /api/device/clock', () => {
  it('returns the radio’s RTC', async () => {
    session();
    connectAs();

    const res = await get('/api/device/clock');

    expect((await res.json()) as DeviceClockResponse).toEqual({ epochSecs: 1_760_000_000 });
  });
});

describe('user command gate', () => {
  it.each([
    ['PUT', '/api/device/identity', true],
    ['POST', '/api/transport/advert', true],
    ['POST', '/api/messages/ch%3APublic', true],
    ['PUT', '/api/settings/radio', true],
    ['POST', '/api/repeater/c%3Aab/cli', true],
    ['GET', '/api/device/clock', false],
    ['POST', '/api/telemetry/self/live', false],
    ['POST', '/api/device/stats', false],
    ['PUT', '/api/drafts', false],
    ['PUT', '/api/ui-state', false],
    ['PUT', '/api/settings/app', false],
    ['POST', '/api/macros', false],
  ])('%s %s counts as a user command: %s', (method, path, expected) => {
    expect(countsAsUserCommand(method, path)).toBe(expected);
  });
});
