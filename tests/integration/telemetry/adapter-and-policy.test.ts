import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { LibUnsupportedError } from '../../../src/main/protocol/errors';
import { endContactWalk, noteContactWalkStreaming } from '../../../src/main/state/contactWalk';
import { stateHolder } from '../../../src/main/state/holder';
import {
  forgetRadioTelemetryPolicy,
  isRadioTelemetryPolicyKnown,
  parseTelemetryPolicyPatch,
  policyFromSelfInfo,
  radioTelemetryPolicy,
  seedTelemetryPolicyFromRadio,
} from '../../../src/main/telemetry/policy';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryPolicy } from '../../../src/shared/types';
import { makeTestSession } from '../../support/session-harness';

afterEach(() => {
  stateHolder().setTelemetryPolicy({ ...DEFAULT_TELEMETRY_POLICY });
  forgetRadioTelemetryPolicy();
  endContactWalk();
});

/** Give the session a method meshcore-ts 0.8.1 lacks, as 0.9 will. */
function patch(session: object, name: string, fn: (...args: never[]) => unknown): void {
  (session as Record<string, unknown>)[name] = fn;
}

describe('SessionAdapter — feature-detected meshcore-ts 0.9 surface', () => {
  it('reports every 0.9 method unsupported on the installed 0.8.1 and throws LibUnsupportedError', async () => {
    const { adapter } = makeTestSession();
    expect(adapter.supportsSelfTelemetry()).toBe(false);
    expect(adapter.binaryRequestReportsSent()).toBe(false);
    expect(adapter.supportsContactTelemetryPerms()).toBe(false);
    expect(adapter.supportsCustomVars()).toBe(false);
    await expect(adapter.requestSelfTelemetry()).rejects.toBeInstanceOf(LibUnsupportedError);
    await expect(adapter.setContactTelemetryPerms('c:aa', { base: true, loc: true, env: true })).rejects.toBeInstanceOf(
      LibUnsupportedError,
    );
    await expect(adapter.requestCustomVarsMap()).rejects.toBeInstanceOf(LibUnsupportedError);
    await expect(adapter.setCustomVar('gps', '1')).rejects.toBeInstanceOf(LibUnsupportedError);
  });

  it('calls straight through once the library has them', async () => {
    const { adapter } = makeTestSession();
    const self = vi.fn(async () => Buffer.from('0174019f', 'hex'));
    const perms = vi.fn(async () => true);
    const setVar = vi.fn(async () => true);
    const getVars = vi.fn(async () => ({ gps: '1' }));
    patch(adapter.session, 'requestSelfTelemetry', self);
    patch(adapter.session, 'setContactTelemetryPerms', perms);
    patch(adapter.session, 'setCustomVar', setVar);
    patch(adapter.session, 'requestCustomVars', getVars);

    expect(adapter.binaryRequestReportsSent()).toBe(true);
    const raw = await adapter.requestSelfTelemetry({ timeoutMs: 1234 });
    expect(raw).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(raw).toString('hex')).toBe('0174019f');
    expect(self).toHaveBeenCalledWith({ timeoutMs: 1234 });

    expect(await adapter.setContactTelemetryPerms('c:aa', { base: true, loc: false, env: true })).toBe(true);
    expect(perms).toHaveBeenCalledWith('c:aa', { base: true, loc: false, env: true });
    expect(await adapter.requestCustomVarsMap()).toEqual({ gps: '1' });
    expect(await adapter.setCustomVar('gps_interval', '900')).toBe(true);
    expect(setVar).toHaveBeenCalledWith('gps_interval', '900');
  });

  it('reads a void requestCustomVars from a library that has the API as no answer, not as unsupported', async () => {
    const { adapter } = makeTestSession();
    patch(
      adapter.session,
      'setCustomVar',
      vi.fn(async () => true),
    );
    patch(
      adapter.session,
      'requestCustomVars',
      vi.fn(async () => undefined),
    );
    // A radio mid-handshake resolves void: a 503, never 501 "needs meshcore-ts 0.9".
    const err = await adapter.requestCustomVarsMap().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LibUnsupportedError);
  });

  it('refuses a binary request resolved with something other than bytes', async () => {
    const { adapter } = makeTestSession();
    // A swapped RESP_SENT resolves the waiter with a trace's TRACE_DATA object.
    patch(
      adapter.session,
      'sendBinaryRequest',
      vi.fn(async () => ({ tag: 1, pathHashes: [] })),
    );
    await expect(adapter.sendBinaryRequest(`c:${'ab'.repeat(32)}`, new Uint8Array([3]))).rejects.toThrow(/non-binary/);
  });
});

describe('telemetry policy read-back', () => {
  const radio: TelemetryPolicy = { base: 2, loc: 0, env: 1, multiAcks: 2 };

  it('maps SELF_INFO byte 46 / 44, reading mode 3 as Deny — what firmware does with it', () => {
    expect(policyFromSelfInfo({ telemetryModeBase: 2, telemetryModeLoc: 1, telemetryModeEnv: 3, multiAcks: 1 })).toEqual({
      base: 2,
      loc: 1,
      env: 0,
      multiAcks: 1,
    });
  });

  it('never reads (APP_START) while a contact walk streams, and reads once it ended', async () => {
    const read = vi.fn(async () => radio);
    noteContactWalkStreaming();
    expect(await radioTelemetryPolicy(read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    endContactWalk();
    expect(await radioTelemetryPolicy(read)).toEqual(radio);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('seeds the holder and broadcasts, sharing one read between callers', async () => {
    const read = vi.fn(async () => radio);
    const seen: TelemetryPolicy[] = [];
    bus.on('telemetryPolicy', (p: TelemetryPolicy) => seen.push(p));

    const [a, b] = await Promise.all([seedTelemetryPolicyFromRadio(read), radioTelemetryPolicy(read)]);

    expect(read).toHaveBeenCalledTimes(1);
    expect(a).toEqual(radio);
    expect(b).toEqual(radio);
    expect(stateHolder().getTelemetryPolicy()).toEqual(radio);
    expect(seen).toEqual([radio]);
    expect(isRadioTelemetryPolicyKnown()).toBe(true);
    // Known now: no second read.
    expect(await radioTelemetryPolicy(read)).toEqual(radio);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('drops a read that straddles a disconnect', async () => {
    let answer: (p: TelemetryPolicy) => void = () => {};
    const pending = seedTelemetryPolicyFromRadio(() => new Promise((r) => (answer = r)));
    forgetRadioTelemetryPolicy();
    answer(radio);
    expect(await pending).toBeNull();
    expect(stateHolder().getTelemetryPolicy()).toEqual(DEFAULT_TELEMETRY_POLICY);
    expect(isRadioTelemetryPolicyKnown()).toBe(false);
  });

  it('resolves null on a failed read, leaving the holder alone', async () => {
    expect(await radioTelemetryPolicy(async () => Promise.reject(new Error('timeout')))).toBeNull();
    expect(stateHolder().getTelemetryPolicy()).toEqual(DEFAULT_TELEMETRY_POLICY);
  });
});

describe('telemetry policy PUT body', () => {
  it('accepts any non-empty subset with modes 0–2 and a byte of multi-acks', () => {
    expect(parseTelemetryPolicyPatch({ multiAcks: 2 })).toEqual({ multiAcks: 2 });
    expect(parseTelemetryPolicyPatch({ base: 0, loc: 1, env: 2, extra: true })).toEqual({ base: 0, loc: 1, env: 2 });
  });

  it('rejects anything the radio would be handed as garbage', () => {
    for (const body of [null, [], 'x', {}, { base: 3 }, { loc: '1' }, { env: -1 }, { multiAcks: 256 }, { multiAcks: 1.5 }]) {
      expect(typeof parseTelemetryPolicyPatch(body)).toBe('string');
    }
  });
});

describe('connect-time policy seed', () => {
  type Emit = { emit: (event: string, ...args: unknown[]) => void };
  const progress = (phase: 'idle' | 'syncing' | 'done', done = 0, total = 0) => ({
    phase,
    channels: { done: 0, total: 0 },
    contacts: { done, total },
  });

  it('waits for END_OF_CONTACTS when the handshake reports done mid-walk', async () => {
    const { adapter } = makeTestSession();
    const events = adapter.session.events as unknown as Emit;
    const getSelfInfo = vi
      .spyOn(adapter.session, 'getSelfInfo')
      .mockResolvedValue({ telemetryModeBase: 2, telemetryModeLoc: 0, telemetryModeEnv: 1, multiAcks: 0 } as never);
    vi.spyOn(adapter.session, 'requestAutoAddConfig').mockResolvedValue(undefined as never);

    events.emit('syncProgress', progress('syncing', 10, 250));
    // The library's 10 s END_OF_CONTACTS waiter ran out; frames still stream.
    events.emit('syncProgress', progress('done', 120, 250));
    await Promise.resolve();
    expect(getSelfInfo).not.toHaveBeenCalled();

    events.emit('contactsSynced', { count: 250, mostRecentLastmod: 0 });
    await vi.waitFor(() => expect(isRadioTelemetryPolicyKnown()).toBe(true));
    expect(getSelfInfo).toHaveBeenCalledTimes(1);
    expect(stateHolder().getTelemetryPolicy()).toEqual({ base: 2, loc: 0, env: 1, multiAcks: 0 });
  });

  it('reads straight away when the walk had already finished', async () => {
    const { adapter } = makeTestSession();
    const events = adapter.session.events as unknown as Emit;
    const getSelfInfo = vi
      .spyOn(adapter.session, 'getSelfInfo')
      .mockResolvedValue({ telemetryModeBase: 1, telemetryModeLoc: 1, telemetryModeEnv: 1, multiAcks: 0 } as never);
    vi.spyOn(adapter.session, 'requestAutoAddConfig').mockResolvedValue(undefined as never);

    events.emit('syncProgress', progress('syncing'));
    events.emit('syncProgress', progress('done'));
    await vi.waitFor(() => expect(isRadioTelemetryPolicyKnown()).toBe(true));
    expect(getSelfInfo).toHaveBeenCalledTimes(1);
  });
});
