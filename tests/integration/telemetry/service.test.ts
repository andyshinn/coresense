import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminSessions } from '../../../src/main/bridge/adminSession';
import { bus } from '../../../src/main/events/bus';
import { setProtocolSession } from '../../../src/main/protocol';
import type { BinaryRequestOptions, SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { stateHolder } from '../../../src/main/state/holder';
import { telemetryStore } from '../../../src/main/storage/telemetry';
import { meshLockHolder, tryAcquireMeshLock } from '../../../src/main/telemetry/meshLock';
import {
  buildTelemetryReqData,
  requestTelemetry,
  TELEMETRY_FALLBACK_DEADLINE_MS,
  TELEMETRY_SENT_MARGIN_MS,
  telemetryInFlightSnapshot,
} from '../../../src/main/telemetry/service';
import { transportManager } from '../../../src/main/transport/manager';
import type { TelemetryInFlightPayload, TelemetrySavedPayload } from '../../../src/shared/telemetry/types';
import type { Contact } from '../../../src/shared/types';
import { makeTestSession } from '../../support/session-harness';

const PK = 'ab'.repeat(32);
const OWNER = 'cd'.repeat(32);
// ch1 voltage 4.25 V + ch1 temperature 24.6 °C, then mesh AES padding.
const LPP = Uint8Array.from([0x01, 0x74, 0x01, 0xa9, 0x01, 0x67, 0x00, 0xf6, 0x00, 0x00]);

const repeater = (over: Partial<Contact> = {}): Contact => ({
  key: `c:${PK}`,
  publicKeyHex: PK,
  name: 'Hilltop',
  kind: 'repeater',
  hops: 2,
  outPathHex: 'a1b2',
  ...over,
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Fake {
  sendBinaryRequest: ReturnType<typeof vi.fn>;
  requestSelfTelemetry: ReturnType<typeof vi.fn>;
  /** The options the last binary request was sent with. */
  lastOpts: () => BinaryRequestOptions;
}

/** A SessionAdapter double; `binary` stands in for sendBinaryRequest, whose
 *  options carry onSent/signal. */
function fakeSession(
  opts: {
    binary?: (key: string, req: Uint8Array, o: BinaryRequestOptions) => Promise<Uint8Array>;
    self?: () => Promise<Uint8Array>;
    onRadio?: boolean;
  } = {},
): Fake {
  const sendBinaryRequest = vi.fn(opts.binary ?? (async () => LPP));
  const requestSelfTelemetry = vi.fn(opts.self ?? (async () => Uint8Array.from([0x01, 0x74, 0x01, 0x9f])));
  setProtocolSession({
    hasRadioContact: () => opts.onRadio ?? true,
    sendBinaryRequest,
    requestSelfTelemetry,
  } as unknown as SessionAdapter);
  return {
    sendBinaryRequest,
    requestSelfTelemetry,
    lastOpts: () => sendBinaryRequest.mock.calls.at(-1)?.[2] as BinaryRequestOptions,
  };
}

function collect() {
  const saved: TelemetrySavedPayload[] = [];
  const inFlight: TelemetryInFlightPayload[] = [];
  bus.on('telemetrySaved', (p: TelemetrySavedPayload) => saved.push(p));
  bus.on('telemetryInFlight', (p: TelemetryInFlightPayload) => inFlight.push(p));
  return { saved, inFlight };
}

beforeEach(() => {
  transportManager.setState('connected');
  stateHolder().setContacts([repeater()]);
  stateHolder().setOwner({ name: 'Me', publicKeyHex: OWNER, publicKeyShort: OWNER.slice(0, 12) });
});

afterEach(() => {
  vi.useRealTimers();
  setProtocolSession(null);
  transportManager.setState('idle');
  stateHolder().setContacts([]);
  stateHolder().setOwner(null);
  adminSessions.clearSession(`c:${PK}`);
});

describe('requestTelemetry — remote node', () => {
  it('saves a reply as ok with the raw bytes, and announces it', async () => {
    const fake = fakeSession();
    const ev = collect();
    adminSessions.setSession({
      contactKey: `c:${PK}`,
      publicKeyHex: PK,
      mode: 'remote',
      role: 'guest',
      permissionsBits: 0,
      aclPermissionsBits: 0,
      aclRole: 'guest',
      firmwareVerLevel: 2,
      loggedInAt: 1,
    });

    const res = await requestTelemetry(PK);

    expect(res.status).toBe('saved');
    if (res.status !== 'saved') return;
    expect(res.request).toMatchObject({
      nodeKey: PK,
      source: 'repeater',
      outcome: 'ok',
      rawHex: '017401a9016700f60000',
      route: 'direct',
      hops: 2,
      aclRole: 'guest',
      permsGranted: 0x01,
      restHex: '',
    });
    expect(res.request.readings.map((r) => r.typeId)).toEqual([116, 103]);
    expect(res.request.roundTripMs).not.toBeNull();
    // Persisted with raw bytes intact — raw stays the source of truth.
    expect(Array.from(telemetryStore.get(res.request.id)?.raw ?? [])).toEqual(Array.from(LPP));
    expect(ev.saved.map((p) => p.request.id)).toEqual([res.request.id]);
    // A snapshot on start (one pending) and on finish (none).
    expect(ev.inFlight.map((p) => p.inFlight.length)).toEqual([1, 0]);
    expect(fake.sendBinaryRequest).toHaveBeenCalledWith(`c:${PK}`, expect.any(Uint8Array), expect.any(Object));
  });

  it('sends the firmware request layout: type, inverted mask 0, 3 reserved, 4 random', () => {
    const a = buildTelemetryReqData();
    const b = buildTelemetryReqData();
    expect(a.length).toBe(9);
    expect(Array.from(a.subarray(0, 5))).toEqual([0x03, 0x00, 0, 0, 0]);
    // Random tails keep two requests from sharing a packet hash.
    expect(Array.from(a.subarray(5))).not.toEqual(Array.from(b.subarray(5)));
  });

  it('saves a timeout with raw = null at the 15 s fallback when RESP_SENT never comes', async () => {
    vi.useFakeTimers();
    const never = deferred<Uint8Array>();
    const fake = fakeSession({ binary: () => never.promise });
    const startedAt = Date.now();

    const pending = requestTelemetry(PK);
    // Unannounced: the fallback only stands in until RESP_SENT gives a figure.
    expect(telemetryInFlightSnapshot()).toEqual([{ nodeKey: PK, source: 'repeater', startedAt, deadlineAt: null }]);
    expect(fake.lastOpts().signal).toBeInstanceOf(AbortSignal);

    await vi.advanceTimersByTimeAsync(TELEMETRY_FALLBACK_DEADLINE_MS - 1);
    expect(telemetryInFlightSnapshot()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;

    expect(res.status).toBe('saved');
    if (res.status !== 'saved') return;
    expect(res.request).toMatchObject({
      outcome: 'timeout',
      rawHex: null,
      repliedAt: null,
      // How long it waited, for "no reply in 15 s".
      roundTripMs: TELEMETRY_FALLBACK_DEADLINE_MS,
    });
    expect(telemetryStore.get(res.request.id)?.raw).toBeNull();
    expect(telemetryInFlightSnapshot()).toEqual([]);
    expect(meshLockHolder()).toBeNull();
  });

  it('joins a second click to the in-flight request instead of sending again', async () => {
    const reply = deferred<Uint8Array>();
    const fake = fakeSession({ binary: () => reply.promise });

    const first = requestTelemetry(PK);
    const second = requestTelemetry(`${PK}`);
    reply.resolve(LPP);
    const [a, b] = await Promise.all([first, second]);

    expect(fake.sendBinaryRequest).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(telemetryStore.list(PK)).toHaveLength(1);
  });

  it('refuses with busy while another mesh request holds the radio, and saves nothing', async () => {
    const fake = fakeSession();
    const release = tryAcquireMeshLock('acl', 'ee'.repeat(32));
    try {
      const res = await requestTelemetry(PK);
      expect(res).toEqual({ status: 'busy', holder: expect.objectContaining({ owner: 'acl' }) });
      expect(fake.sendBinaryRequest).not.toHaveBeenCalled();
      expect(telemetryStore.list(PK)).toEqual([]);
    } finally {
      release?.();
    }
  });

  it('holds the mesh lock while in flight, so a request to another node is busy', async () => {
    const reply = deferred<Uint8Array>();
    fakeSession({ binary: () => reply.promise });
    const first = requestTelemetry(PK);
    expect(meshLockHolder()).toMatchObject({ owner: 'telemetry', nodeKey: PK });

    const other = await requestTelemetry('ef'.repeat(32));
    expect(other.status).toBe('busy');

    reply.resolve(LPP);
    await first;
    expect(meshLockHolder()).toBeNull();
  });

  it('saves a disconnect as error "disconnected"', async () => {
    fakeSession({
      binary: async () => {
        transportManager.setState('idle');
        throw new Error('transport disconnected');
      },
    });
    const res = await requestTelemetry(PK);
    expect(res.status === 'saved' && res.request).toMatchObject({ outcome: 'error', error: 'disconnected', rawHex: null });
  });

  it('saves a RESP_ERR rejection as error with the library message', async () => {
    fakeSession({
      binary: async () => {
        const err = new Error('radio returned error 0x02');
        err.name = 'ProtocolError';
        throw err;
      },
    });
    const res = await requestTelemetry(PK);
    expect(res.status === 'saved' && res.request).toMatchObject({ outcome: 'error', error: 'radio returned error 0x02' });
  });

  it('saves a library-side timeout as timeout', async () => {
    fakeSession({
      binary: async () => {
        throw new Error('admin RESP_SENT timed out after 5000ms');
      },
    });
    const res = await requestTelemetry(PK);
    expect(res.status === 'saved' && res.request.outcome).toBe('timeout');
  });

  it('does not save pre-send failures: offline, not on radio, or the library losing the contact', async () => {
    transportManager.setState('idle');
    fakeSession();
    expect(await requestTelemetry(PK)).toEqual({ status: 'offline' });

    transportManager.setState('connected');
    fakeSession({ onRadio: false });
    expect(await requestTelemetry(PK)).toEqual({ status: 'notOnRadio' });

    fakeSession({
      binary: async () => {
        throw new Error(`unknown contact c:${PK}`);
      },
    });
    expect(await requestTelemetry(PK)).toEqual({ status: 'notOnRadio' });
    expect(telemetryStore.list(PK)).toEqual([]);
    expect(meshLockHolder()).toBeNull();
  });

  it('times out at est_timeout + 2 s from RESP_SENT when the library reports it (≥ 0.9)', async () => {
    vi.useFakeTimers();
    const never = deferred<Uint8Array>();
    const fake = fakeSession({ binary: () => never.promise });

    const pending = requestTelemetry(PK);
    // Unknown until the radio says how long the reply should take.
    expect(telemetryInFlightSnapshot()[0].deadlineAt).toBeNull();
    const opts = fake.lastOpts();
    expect(opts.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(400); // RESP_SENT arrives
    const sentAt = Date.now();
    opts.onSent?.({ flood: true, estTimeoutMs: 3000 });
    expect(telemetryInFlightSnapshot()[0].deadlineAt).toBe(sentAt + 3000 + TELEMETRY_SENT_MARGIN_MS);

    // Well past the 15 s fallback would be wrong here; and the est deadline holds.
    await vi.advanceTimersByTimeAsync(3000 + TELEMETRY_SENT_MARGIN_MS - 1);
    expect(telemetryInFlightSnapshot()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;

    expect(opts.signal?.aborted).toBe(true);
    // RESP_SENT's flood flag beats the click-time "direct" guess.
    expect(res.status === 'saved' && res.request).toMatchObject({ outcome: 'timeout', route: 'flood', hops: null });
  });

  it('still times out at the 15 s fallback when a "≥ 0.9" library never calls onSent', async () => {
    vi.useFakeTimers();
    const never = deferred<Uint8Array>();
    // binaryRequestReportsSent is inferred, not detected: a library can claim
    // it and ship without onSent. The lock must not wait out its backstop.
    const fake = fakeSession({ binary: () => never.promise });

    const pending = requestTelemetry(PK);
    expect(fake.lastOpts().timeoutMs).toBeLessThanOrEqual(90_000);

    await vi.advanceTimersByTimeAsync(TELEMETRY_FALLBACK_DEADLINE_MS - 1);
    // The fallback is never announced as the radio's figure.
    expect(telemetryInFlightSnapshot()).toEqual([expect.objectContaining({ deadlineAt: null })]);
    expect(meshLockHolder()?.owner).toBe('telemetry');
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;

    expect(res.status === 'saved' && res.request.outcome).toBe('timeout');
    expect(fake.lastOpts().signal?.aborted).toBe(true);
    expect(telemetryInFlightSnapshot()).toEqual([]);
    expect(meshLockHolder()).toBeNull();
  });

  it('lets RESP_SENT’s estimate replace the fallback, even when it runs past 15 s', async () => {
    vi.useFakeTimers();
    const never = deferred<Uint8Array>();
    const fake = fakeSession({ binary: () => never.promise });

    const pending = requestTelemetry(PK);
    await vi.advanceTimersByTimeAsync(300);
    fake.lastOpts().onSent?.({ flood: true, estTimeoutMs: 30_000 });

    await vi.advanceTimersByTimeAsync(TELEMETRY_FALLBACK_DEADLINE_MS);
    expect(telemetryInFlightSnapshot()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000 + TELEMETRY_SENT_MARGIN_MS - TELEMETRY_FALLBACK_DEADLINE_MS);
    expect((await pending).status).toBe('saved');
    expect(meshLockHolder()).toBeNull();
  });

  it('infers source, role and permissions from the contact kind and admin session (B3)', async () => {
    fakeSession();
    stateHolder().setContacts([repeater({ kind: 'sensor', hops: undefined, outPathHex: undefined })]);
    const sensor = await requestTelemetry(PK);
    expect(sensor.status === 'saved' && sensor.request).toMatchObject({
      source: 'repeater',
      permsGranted: 0x07,
      aclRole: null,
      route: 'flood',
      hops: null,
    });

    stateHolder().setContacts([repeater({ kind: 'chat' })]);
    const chat = await requestTelemetry(PK);
    expect(chat.status === 'saved' && chat.request).toMatchObject({ source: 'contact', permsGranted: null });

    stateHolder().setContacts([repeater()]);
    const unknownRole = await requestTelemetry(PK);
    expect(unknownRole.status === 'saved' && unknownRole.request).toMatchObject({ aclRole: null, permsGranted: null });
  });
});

describe('requestTelemetry — my own radio', () => {
  it('saves a self read as a companion request over the local link, without the mesh lock', async () => {
    const read = deferred<Uint8Array>();
    fakeSession({ self: () => read.promise });

    const pending = requestTelemetry(OWNER);
    expect(meshLockHolder()).toBeNull();
    expect(telemetryInFlightSnapshot()[0]).toMatchObject({ source: 'companion' });
    expect(telemetryInFlightSnapshot()[0].deadlineAt).not.toBeNull();
    read.resolve(Uint8Array.from([0x01, 0x74, 0x01, 0x9f]));
    const res = await pending;

    expect(res.status === 'saved' && res.request).toMatchObject({
      nodeKey: OWNER,
      source: 'companion',
      outcome: 'ok',
      route: 'local',
      hops: null,
      permsGranted: 0x07,
      rawHex: '0174019f',
    });
  });

  it('saves firmware without self telemetry (RESP_ERR) as an error', async () => {
    fakeSession({
      self: async () => {
        throw new Error('self telemetry unsupported by firmware');
      },
    });
    const res = await requestTelemetry(OWNER);
    expect(res.status === 'saved' && res.request).toMatchObject({ outcome: 'error', source: 'companion' });
  });
});

describe('requestTelemetry — against a real MeshCoreSession (0.8.1)', () => {
  it('sends CMD_SEND_BINARY_REQ and saves the tagged reply, padding kept in raw but not decoded', async () => {
    const { adapter, transport, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());
    setProtocolSession(adapter);

    const pending = requestTelemetry(PK);
    await vi.waitFor(() => expect(transport.sent.some((f) => f[0] === 0x32)).toBe(true));
    const frame = transport.sent.find((f) => f[0] === 0x32) as Uint8Array;
    expect(Array.from(frame.subarray(33, 38))).toEqual([0x03, 0x00, 0, 0, 0]);

    // RESP_SENT [0x06][flood][tag u32][est u32], then PUSH_BINARY_RESPONSE.
    receive('06010badf00d88130000');
    await new Promise((r) => setTimeout(r, 0));
    receive(`8c000badf00d${Buffer.from(LPP).toString('hex')}`);
    const res = await pending;

    expect(res.status === 'saved' && res.request).toMatchObject({
      outcome: 'ok',
      rawHex: '017401a9016700f60000',
      restHex: '',
    });
    expect(res.status === 'saved' && res.request.readings).toHaveLength(2);
  });
});
