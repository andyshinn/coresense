import type { Models } from '@andyshinn/meshcore-ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { bus } from '../../../src/main/events/bus';
import { setProtocolSession } from '../../../src/main/protocol';
import { LibUnsupportedError } from '../../../src/main/protocol/errors';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { flushContactSyncEmits } from '../../../src/main/state/contactSync';
import { stateHolder } from '../../../src/main/state/holder';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { telemetryStore } from '../../../src/main/storage/telemetry';
import { tryAcquireMeshLock } from '../../../src/main/telemetry/meshLock';
import { forgetRadioTelemetryPolicy, markRadioTelemetryPolicyKnown } from '../../../src/main/telemetry/policy';
import { transportManager } from '../../../src/main/transport/manager';
import type { DiscoveredContact } from '../../../src/shared/contacts/discovered';
import { hexToBytes } from '../../../src/shared/telemetry/lpp';
import type {
  RequestDetailDto,
  SavedRequest,
  SavedRequestDto,
  TelemetryDeletedPayload,
} from '../../../src/shared/telemetry/types';
import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_GPS_CONFIG,
  DEFAULT_SYNC_PROGRESS,
  DEFAULT_TELEMETRY_POLICY,
  type StateSnapshot,
  type TelemetryPolicy,
} from '../../../src/shared/types';

const PK = 'ab'.repeat(32);
const KEY = `c%3A${PK}`;
const OWNER = 'cd'.repeat(32);

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

const json = { 'content-type': 'application/json' };
const post = (path: string) => app().request(path, { method: 'POST' });
const del = (path: string) => app().request(path, { method: 'DELETE' });
const put = (path: string, body: unknown) =>
  app().request(path, { method: 'PUT', headers: json, body: JSON.stringify(body) });

/** A SessionAdapter double with every method these routes reach; override per test. */
function fakeSession(over: Record<string, unknown> = {}) {
  const session = {
    hasRadioContact: () => true,
    binaryRequestReportsSent: () => false,
    supportsSelfTelemetry: () => false,
    sendBinaryRequest: vi.fn(async () => hexToBytes('017401a9') as Uint8Array),
    requestSelfTelemetry: vi.fn(async () => {
      throw new LibUnsupportedError('requestSelfTelemetry');
    }),
    repeaterRequestAcl: vi.fn(async () => []),
    repeaterTracePath: vi.fn(async () => ({})),
    setContactTelemetryPerms: vi.fn(async () => {
      throw new LibUnsupportedError('setContactTelemetryPerms');
    }),
    requestCustomVarsMap: vi.fn(async () => {
      throw new LibUnsupportedError('requestCustomVars');
    }),
    setCustomVar: vi.fn(async () => {
      throw new LibUnsupportedError('setCustomVar');
    }),
    setOtherParams: vi.fn(async () => true),
    readTelemetryPolicy: vi.fn(async (): Promise<TelemetryPolicy> => ({ base: 2, loc: 0, env: 1, multiAcks: 0 })),
    // Read by the snapshot route.
    getDevicePresence: () => [],
    getSyncProgress: () => DEFAULT_SYNC_PROGRESS,
    ...over,
  };
  setProtocolSession(session as unknown as SessionAdapter);
  return session;
}

let seq = 0;
function saved(over: Partial<SavedRequest> & { hex?: string | null } = {}): SavedRequest {
  seq += 1;
  const { hex = '017401a9', ...rest } = over;
  const r: SavedRequest = {
    id: `t-${seq}`,
    nodeKey: PK,
    source: 'repeater',
    requestedAt: seq * 1000,
    repliedAt: hex ? seq * 1000 + 900 : null,
    outcome: hex ? 'ok' : 'timeout',
    roundTripMs: hex ? 900 : null,
    hops: 1,
    route: 'direct',
    aclRole: 'admin',
    permsGranted: 7,
    raw: hex ? hexToBytes(hex) : null,
    ...rest,
  };
  telemetryStore.insert(r, 500);
  return r;
}

function deletedEvents(): TelemetryDeletedPayload[] {
  const out: TelemetryDeletedPayload[] = [];
  bus.on('telemetryDeleted', (p: TelemetryDeletedPayload) => out.push(p));
  return out;
}

let appSettings: AppSettings;
beforeEach(() => {
  appSettings = stateHolder().getAppSettings();
  transportManager.setState('connected');
  stateHolder().setOwner({ name: 'Me', publicKeyHex: OWNER, publicKeyShort: OWNER.slice(0, 12) });
});

afterEach(() => {
  setProtocolSession(null);
  transportManager.setState('idle');
  stateHolder().setOwner(null);
  stateHolder().setAppSettings(appSettings);
  stateHolder().setTelemetryPolicy({ ...DEFAULT_TELEMETRY_POLICY });
  stateHolder().setDeviceIdentity({ ...DEFAULT_DEVICE_IDENTITY });
  stateHolder().setGpsConfig({ ...DEFAULT_GPS_CONFIG });
  forgetRadioTelemetryPolicy();
});

describe('POST /api/telemetry/:nodeKey/request', () => {
  it('returns the saved request for a contact key and for a bare key', async () => {
    fakeSession();
    const viaContactKey = await post(`/api/telemetry/${KEY}/request`);
    expect(viaContactKey.status).toBe(200);
    const body = (await viaContactKey.json()) as SavedRequestDto;
    expect(body).toMatchObject({ nodeKey: PK, outcome: 'ok', rawHex: '017401a9' });
    expect(body.readings).toHaveLength(1);

    const viaBare = await post(`/api/telemetry/${PK.toUpperCase()}/request`);
    expect(viaBare.status).toBe(200);
    expect(telemetryStore.list(PK)).toHaveLength(2);
  });

  it('answers 200 for a request that ran and timed out or errored', async () => {
    fakeSession({
      sendBinaryRequest: vi.fn(async () => {
        throw new Error('admin request tag:0badf00d timed out after 15000ms');
      }),
    });
    const res = await post(`/api/telemetry/${KEY}/request`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as SavedRequestDto).outcome).toBe('timeout');
  });

  it('rejects a key that is not a public key', async () => {
    fakeSession();
    expect((await post('/api/telemetry/c%3Aabcd/request')).status).toBe(400);
    expect((await post('/api/telemetry/ch%3APublic/request')).status).toBe(400);
  });

  it('maps pre-send failures to 503 / 422 / 501 / 409 and saves none of them', async () => {
    transportManager.setState('idle');
    fakeSession();
    expect((await post(`/api/telemetry/${KEY}/request`)).status).toBe(503);

    transportManager.setState('connected');
    fakeSession({ hasRadioContact: () => false });
    const notOnRadio = await post(`/api/telemetry/${KEY}/request`);
    expect(notOnRadio.status).toBe(422);
    expect(await notOnRadio.json()).toMatchObject({ code: 'NOT_ON_RADIO' });

    // The owner's own key reads the companion radio, which 0.8.1 can't.
    fakeSession();
    const self = await post(`/api/telemetry/${OWNER}/request`);
    expect(self.status).toBe(501);
    expect(await self.json()).toMatchObject({ code: 'lib_unsupported' });

    const release = tryAcquireMeshLock('cli', 'ee'.repeat(32));
    try {
      const busy = await post(`/api/telemetry/${KEY}/request`);
      expect(busy.status).toBe(409);
      expect(await busy.json()).toMatchObject({ code: 'radio_busy', owner: 'cli' });
    } finally {
      release?.();
    }
    expect(telemetryStore.list(PK)).toEqual([]);
    expect(telemetryStore.list(OWNER)).toEqual([]);
  });

  it('makes the awaited admin routes answer 409 radio_busy while telemetry is in flight', async () => {
    let reply: (b: Uint8Array) => void = () => {};
    const session = fakeSession({
      sendBinaryRequest: vi.fn(() => new Promise<Uint8Array>((r) => (reply = r))),
    });
    const pending = post(`/api/telemetry/${KEY}/request`);
    await vi.waitFor(() => expect(session.sendBinaryRequest).toHaveBeenCalled());

    const snapshot = (await (await app().request('/api/state/snapshot')).json()) as StateSnapshot;
    expect(snapshot.telemetryInFlight).toEqual([expect.objectContaining({ nodeKey: PK, deadlineAt: expect.any(Number) })]);

    const acl = await post(`/api/repeater/${KEY}/acl`);
    expect(acl.status).toBe(409);
    expect(await acl.json()).toEqual({ error: 'Waiting for telemetry request', code: 'radio_busy', owner: 'telemetry' });
    expect(session.repeaterRequestAcl).not.toHaveBeenCalled();

    // Trace too: its RESP_SENT can be swapped with telemetry's.
    const trace = await app().request(`/api/repeater/${KEY}/trace`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ tag: 1, pathHex: 'ab' }),
    });
    expect(trace.status).toBe(409);
    expect(session.repeaterTracePath).not.toHaveBeenCalled();

    reply(hexToBytes('017401a9') as Uint8Array);
    expect((await pending).status).toBe(200);
    expect((await post(`/api/repeater/${KEY}/acl`)).status).toBe(200);
  });
});

describe('GET / DELETE saved requests', () => {
  it('lists a node newest first with readings decoded', async () => {
    const a = saved();
    const b = saved({ hex: null });
    const res = await app().request(`/api/telemetry/${KEY}`);
    const list = (await res.json()) as SavedRequestDto[];
    expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(list[1].readings[0]).toMatchObject({ ch: 1, typeId: 116 });
    expect(list[0]).toMatchObject({ rawHex: null, readings: [] });
  });

  it('attaches, per reading, the most recent earlier ok request that has it', async () => {
    // ch1 4.20 V + ch2 20.0 °C
    const full = saved({ hex: '017401a4026700c8' });
    saved({ hex: null }); // a timeout in between hides nothing
    // A guest reply: battery only, so it can't stand in for the temperature.
    const guest = saved({ hex: '017401a6', aclRole: 'guest', permsGranted: 1 });
    // 4.25 V, 24.6 °C, and a newly added ch3 bus voltage.
    const latest = saved({ hex: '017401a9026700f603740200' });

    const res = await app().request(`/api/telemetry/request/${latest.id}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as RequestDetailDto;
    expect(detail.previous).toHaveLength(3);
    expect(detail.previous[0]).toMatchObject({ requestedAt: guest.requestedAt, requestId: guest.id });
    expect(detail.previous[0]?.reading.value).toBeCloseTo(4.22);
    expect(detail.previous[1]).toMatchObject({ requestedAt: full.requestedAt, requestId: full.id });
    expect(detail.previous[1]?.reading.value).toBeCloseTo(20.0);
    expect(detail.previous[2]).toBeNull();

    expect((await app().request('/api/telemetry/request/nope')).status).toBe(404);
  });

  it('deletes one request and announces it', async () => {
    const r = saved();
    const events = deletedEvents();
    expect((await del(`/api/telemetry/request/${r.id}`)).status).toBe(200);
    expect(events).toEqual([{ nodeKey: PK, ids: [r.id] }]);
    expect((await del(`/api/telemetry/request/${r.id}`)).status).toBe(404);
  });

  it('clears a node and announces "all"', async () => {
    saved();
    saved();
    const events = deletedEvents();
    expect((await del(`/api/telemetry/${KEY}`)).status).toBe(200);
    expect(telemetryStore.list(PK)).toEqual([]);
    expect(events).toEqual([{ nodeKey: PK, ids: 'all' }]);
  });
});

describe('PUT /api/settings/app — telemetry retention', () => {
  const withRetention = (n: unknown): AppSettings =>
    ({ ...DEFAULT_APP_SETTINGS, telemetry: { retentionPerNode: n } }) as AppSettings;

  it('prunes every node at once when retention shrinks, and announces what went', async () => {
    const old = saved();
    const kept = saved();
    const otherOld = saved({ nodeKey: 'ef'.repeat(32) });
    const otherKept = saved({ nodeKey: 'ef'.repeat(32) });
    const events = deletedEvents();

    expect((await put('/api/settings/app', withRetention(1))).status).toBe(200);

    expect(telemetryStore.list(PK).map((r) => r.id)).toEqual([kept.id]);
    expect(telemetryStore.list('ef'.repeat(32)).map((r) => r.id)).toEqual([otherKept.id]);
    expect(events).toEqual(
      expect.arrayContaining([
        { nodeKey: PK, ids: [old.id] },
        { nodeKey: 'ef'.repeat(32), ids: [otherOld.id] },
      ]),
    );
  });

  it('clamps the value, and keeps the current one when the body omits it', async () => {
    await put('/api/settings/app', withRetention(9999));
    expect(stateHolder().getAppSettings().telemetry.retentionPerNode).toBe(500);
    await put('/api/settings/app', withRetention(0));
    expect(stateHolder().getAppSettings().telemetry.retentionPerNode).toBe(1);
    await put('/api/settings/app', withRetention(20));
    const { telemetry: _t, ...older } = DEFAULT_APP_SETTINGS;
    await put('/api/settings/app', older);
    expect(stateHolder().getAppSettings().telemetry.retentionPerNode).toBe(20);
  });

  it('keeps the current value for garbage rather than shrinking to the default and pruning', async () => {
    await put('/api/settings/app', withRetention(300));
    const rows = Array.from({ length: 60 }, () => saved());
    const events = deletedEvents();
    for (const garbage of ['300', Number.NaN, {}, null]) {
      expect((await put('/api/settings/app', withRetention(garbage))).status).toBe(200);
      expect(stateHolder().getAppSettings().telemetry.retentionPerNode).toBe(300);
    }
    expect(telemetryStore.list(PK)).toHaveLength(rows.length);
    expect(events).toEqual([]);
  });

  it('applies to the next insert', async () => {
    fakeSession();
    stateHolder().setAppSettings(withRetention(2));
    for (let i = 0; i < 3; i++) await post(`/api/telemetry/${KEY}/request`);
    expect(telemetryStore.list(PK)).toHaveLength(2);
  });
});

describe('PUT /api/contacts/:key/telemetry-perms', () => {
  function seedDiscovered(flags: number): void {
    discoveredStore.upsert(
      {
        publicKeyHex: PK,
        name: 'Friend',
        type: 1,
        flags,
        outPathLen: 0xff,
        outPathHex: '',
        lastAdvertUnix: 1_700_000_000,
        gpsLat: 0,
        gpsLon: 0,
        lastmod: 1,
      } as Models.ContactRecord,
      { onRadio: true, nowMs: 1, heardLive: false },
    );
  }
  const row = (): DiscoveredContact | undefined => discoveredStore.list([]).find((r) => r.publicKeyHex === PK);

  it('reads the stored flags bits 1–3 onto the discovered DTO', () => {
    seedDiscovered(0b0101); // favourite + location
    expect(row()?.telemetryPerms).toEqual({ base: false, loc: true, env: false });
  });

  it('answers 501 lib_unsupported on meshcore-ts 0.8.1', async () => {
    fakeSession();
    const res = await put(`/api/contacts/${KEY}/telemetry-perms`, { base: true, loc: false, env: true });
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ code: 'lib_unsupported' });
  });

  it('writes through the library, then mirrors the bits keeping the favourite bit', async () => {
    seedDiscovered(0b0001);
    const setContactTelemetryPerms = vi.fn(async () => true);
    fakeSession({ setContactTelemetryPerms });
    const discovered: DiscoveredContact[][] = [];
    bus.on('discovered', (rows: DiscoveredContact[]) => discovered.push(rows));

    const res = await put(`/api/contacts/${KEY}/telemetry-perms`, { base: true, loc: false, env: true });

    expect(res.status).toBe(200);
    expect(setContactTelemetryPerms).toHaveBeenCalledWith(`c:${PK}`, { base: true, loc: false, env: true });
    expect(discoveredStore.get(PK)?.flags).toBe(0b1011);
    expect(row()).toMatchObject({ favourite: true, telemetryPerms: { base: true, loc: false, env: true } });
    await flushContactSyncEmits();
    expect(discovered.at(-1)?.find((r) => r.publicKeyHex === PK)?.telemetryPerms).toEqual({
      base: true,
      loc: false,
      env: true,
    });
  });

  it('validates the body and maps a refusal and an unknown contact', async () => {
    fakeSession({ setContactTelemetryPerms: vi.fn(async () => false) });
    expect((await put(`/api/contacts/${KEY}/telemetry-perms`, { base: true })).status).toBe(400);
    expect((await put(`/api/contacts/${KEY}/telemetry-perms`, { base: true, loc: true, env: true })).status).toBe(503);

    const unknown = new Error('unknown discovered contact');
    unknown.name = 'UnknownContactError';
    fakeSession({
      setContactTelemetryPerms: vi.fn(async () => {
        throw unknown;
      }),
    });
    expect((await put(`/api/contacts/${KEY}/telemetry-perms`, { base: true, loc: true, env: true })).status).toBe(422);
  });
});

describe('/api/device/custom-vars', () => {
  it('answers 501 lib_unsupported on meshcore-ts 0.8.1, and 503 offline', async () => {
    fakeSession();
    const res = await app().request('/api/device/custom-vars');
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ code: 'lib_unsupported' });
    expect((await put('/api/device/custom-vars', { key: 'gps', value: '1' })).status).toBe(501);

    transportManager.setState('idle');
    expect((await app().request('/api/device/custom-vars')).status).toBe(503);
  });

  it('returns the raw map, {} meaning no GPS hardware', async () => {
    fakeSession({ requestCustomVarsMap: vi.fn(async () => ({})) });
    expect(await (await app().request('/api/device/custom-vars')).json()).toEqual({});
    fakeSession({ requestCustomVarsMap: vi.fn(async () => ({ gps: '1' })) });
    expect(await (await app().request('/api/device/custom-vars')).json()).toEqual({ gps: '1' });
  });

  it('writes one key, remembering the write-only gps_interval in GpsConfig', async () => {
    const setCustomVar = vi.fn(async (key: string) => key !== 'gps_interval');
    fakeSession({ setCustomVar });

    expect((await put('/api/device/custom-vars', { key: 'gps', value: '1' })).status).toBe(200);
    expect(stateHolder().getGpsConfig().enabled).toBe(true);

    // T1000 refuses the interval: a partial save the UI reports on its own.
    const rejected = await put('/api/device/custom-vars', { key: 'gps_interval', value: '900' });
    expect(rejected.status).toBe(503);
    expect(stateHolder().getGpsConfig().intervalSec).toBe(DEFAULT_GPS_CONFIG.intervalSec);

    fakeSession({ setCustomVar: vi.fn(async () => true) });
    await put('/api/device/custom-vars', { key: 'gps_interval', value: '900' });
    expect(stateHolder().getGpsConfig().intervalSec).toBe(900);

    expect((await put('/api/device/custom-vars', { key: 'a:b', value: '1' })).status).toBe(400);
    expect((await put('/api/device/custom-vars', { key: 'gps', value: 1 })).status).toBe(400);
  });
});

describe('telemetry policy — the radio is the source of truth', () => {
  const policy: TelemetryPolicy = { base: 2, loc: 1, env: 0, multiAcks: 1 };

  it('writes the radio first and the holder only once it accepted', async () => {
    const session = fakeSession({ setOtherParams: vi.fn(async () => false) });
    stateHolder().setTelemetryPolicy({ base: 2, loc: 0, env: 1, multiAcks: 0 });
    markRadioTelemetryPolicyKnown();
    expect((await put('/api/device/telemetry-policy', policy)).status).toBe(503);
    expect(stateHolder().getTelemetryPolicy()).toEqual({ base: 2, loc: 0, env: 1, multiAcks: 0 });

    session.setOtherParams.mockResolvedValue(true);
    expect((await put('/api/device/telemetry-policy', policy)).status).toBe(200);
    expect(stateHolder().getTelemetryPolicy()).toEqual(policy);
  });

  it('merges a partial body onto the RADIO’s policy, reading it first when unknown', async () => {
    const session = fakeSession();
    // The stale JSON copy: saving multi-acks must not send these modes.
    stateHolder().setTelemetryPolicy({ base: 0, loc: 0, env: 0, multiAcks: 0 });

    expect((await put('/api/device/telemetry-policy', { multiAcks: 2 })).status).toBe(200);

    expect(session.readTelemetryPolicy).toHaveBeenCalledTimes(1);
    expect(session.setOtherParams).toHaveBeenCalledWith({ base: 2, loc: 0, env: 1, multiAcks: 2 }, expect.any(Boolean));
    expect(stateHolder().getTelemetryPolicy()).toEqual({ base: 2, loc: 0, env: 1, multiAcks: 2 });
  });

  it('refuses a write it could not base on the radio’s policy', async () => {
    const session = fakeSession({
      readTelemetryPolicy: vi.fn(async () => {
        throw new Error('timeout waiting for frame 0x05');
      }),
    });
    expect((await put('/api/device/telemetry-policy', { multiAcks: 2 })).status).toBe(503);
    expect(session.setOtherParams).not.toHaveBeenCalled();
  });

  it('rejects a body that is not a policy (400), leaving radio and holder alone', async () => {
    const session = fakeSession();
    for (const body of [{}, { base: 3 }, { loc: '1' }, { multiAcks: 300 }]) {
      expect((await put('/api/device/telemetry-policy', body)).status).toBe(400);
    }
    expect(session.setOtherParams).not.toHaveBeenCalled();
    expect(stateHolder().getTelemetryPolicy()).toEqual(DEFAULT_TELEMETRY_POLICY);
  });

  it('merges onto the holder when no radio is attached', async () => {
    const session = fakeSession();
    transportManager.setState('idle');
    stateHolder().setTelemetryPolicy({ base: 1, loc: 1, env: 1, multiAcks: 0 });
    expect((await put('/api/device/telemetry-policy', { env: 2 })).status).toBe(200);
    expect(session.setOtherParams).not.toHaveBeenCalled();
    expect(stateHolder().getTelemetryPolicy()).toEqual({ base: 1, loc: 1, env: 2, multiAcks: 0 });
  });

  it('re-sends the radio’s policy on a share-position save, reading it first when unknown', async () => {
    const session = fakeSession();
    // The stale JSON copy that used to be re-sent.
    stateHolder().setTelemetryPolicy({ base: 0, loc: 0, env: 0, multiAcks: 0 });
    stateHolder().setDeviceIdentity({ ...DEFAULT_DEVICE_IDENTITY, sharePositionInAdvert: false });

    const res = await put('/api/device/identity', { sharePositionInAdvert: true });

    expect(res.status).toBe(200);
    expect(session.readTelemetryPolicy).toHaveBeenCalledTimes(1);
    expect(session.setOtherParams).toHaveBeenCalledWith({ base: 2, loc: 0, env: 1, multiAcks: 0 }, true);
    expect(stateHolder().getTelemetryPolicy()).toEqual({ base: 2, loc: 0, env: 1, multiAcks: 0 });
  });

  it('refuses rather than re-send a policy it could not read back', async () => {
    const session = fakeSession({
      readTelemetryPolicy: vi.fn(async () => {
        throw new Error('timeout waiting for frame 0x05');
      }),
    });
    stateHolder().setDeviceIdentity({ ...DEFAULT_DEVICE_IDENTITY, sharePositionInAdvert: false });
    const res = await put('/api/device/identity', { sharePositionInAdvert: true });
    expect(res.status).toBe(503);
    expect(session.setOtherParams).not.toHaveBeenCalled();
  });

  it('uses the known policy without another read', async () => {
    const session = fakeSession();
    stateHolder().setTelemetryPolicy(policy);
    markRadioTelemetryPolicyKnown();
    stateHolder().setDeviceIdentity({ ...DEFAULT_DEVICE_IDENTITY, sharePositionInAdvert: true });
    await put('/api/device/identity', { sharePositionInAdvert: false });
    expect(session.readTelemetryPolicy).not.toHaveBeenCalled();
    expect(session.setOtherParams).toHaveBeenCalledWith(policy, false);
  });
});
