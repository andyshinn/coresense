import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { endContactWalk, noteContactWalkStreaming } from '../../../src/main/state/contactWalk';
import { stateHolder } from '../../../src/main/state/holder';
import {
  forgetRadioTelemetryPolicy,
  isRadioTelemetryPolicyKnown,
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

describe('SessionAdapter — telemetry surface', () => {
  it('calls straight through to the library', async () => {
    const { adapter } = makeTestSession();
    const self = vi.spyOn(adapter.session, 'requestSelfTelemetry').mockResolvedValue(Buffer.from('0174019f', 'hex'));
    const perms = vi.spyOn(adapter.session, 'setContactTelemetryPerms').mockResolvedValue(true);
    const setVar = vi.spyOn(adapter.session, 'setCustomVar').mockResolvedValue(true);
    vi.spyOn(adapter.session, 'requestCustomVars').mockResolvedValue({ gps: '1' });

    const raw = await adapter.requestSelfTelemetry({ timeoutMs: 1234 });
    expect(raw).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(raw).toString('hex')).toBe('0174019f');
    expect(self).toHaveBeenCalledWith({ timeoutMs: 1234 });

    expect(await adapter.setContactTelemetryPerms('c:aa', { base: true, loc: false, env: true })).toBe(true);
    expect(perms).toHaveBeenCalledWith('c:aa', { base: true, loc: false, env: true });
    expect(await adapter.requestCustomVars('')).toEqual({ gps: '1' });
    expect(await adapter.setCustomVar('gps_interval', '900')).toBe(true);
    expect(setVar).toHaveBeenCalledWith('gps_interval', '900');
  });

  it('refuses a binary request resolved with something other than bytes', async () => {
    const { adapter } = makeTestSession();
    // A swapped RESP_SENT resolves the waiter with a trace's TRACE_DATA object.
    vi.spyOn(adapter.session, 'sendBinaryRequest').mockResolvedValue({ tag: 1, pathHashes: [] } as never);
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

  it('never reads (APP_START) while a contact walk streams: it waits for the walk, then reads', async () => {
    const read = vi.fn(async () => radio);
    noteContactWalkStreaming();
    let settled = false;
    const pending = radioTelemetryPolicy(read).finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    expect(read).not.toHaveBeenCalled();
    endContactWalk();
    expect(await pending).toEqual(radio);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('callers waiting out the same walk share one read', async () => {
    const read = vi.fn(async () => radio);
    noteContactWalkStreaming();
    const a = radioTelemetryPolicy(read);
    const b = radioTelemetryPolicy(read);
    endContactWalk();
    expect(await a).toEqual(radio);
    expect(await b).toEqual(radio);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting (null, no read) when the link drops mid walk', async () => {
    const read = vi.fn(async () => radio);
    noteContactWalkStreaming();
    const pending = radioTelemetryPolicy(read);
    forgetRadioTelemetryPolicy();
    endContactWalk();
    expect(await pending).toBeNull();
    expect(read).not.toHaveBeenCalled();
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

describe('policy from the session', () => {
  type Emit = { emit: (event: string, ...args: unknown[]) => void };
  const idle = { phase: 'idle', channels: { done: 0, total: 0 }, contacts: { done: 0, total: 0 } };

  it("adopts the handshake's SELF_INFO policy without a read of its own", async () => {
    const { adapter } = makeTestSession();
    const events = adapter.session.events as unknown as Emit;
    const getSelfInfo = vi.spyOn(adapter.session, 'getSelfInfo');
    const policy: TelemetryPolicy = { base: 2, loc: 0, env: 1, multiAcks: 0 };

    events.emit('telemetryPolicy', policy);

    expect(isRadioTelemetryPolicyKnown()).toBe(true);
    expect(stateHolder().getTelemetryPolicy()).toEqual(policy);
    expect(await radioTelemetryPolicy(() => adapter.readTelemetryPolicy())).toEqual(policy);
    expect(getSelfInfo).not.toHaveBeenCalled();
  });

  it('forgets it on the disconnect edge', () => {
    const { adapter } = makeTestSession();
    const events = adapter.session.events as unknown as Emit;
    events.emit('telemetryPolicy', { base: 1, loc: 1, env: 1, multiAcks: 0 });
    events.emit('syncProgress', idle);
    expect(isRadioTelemetryPolicyKnown()).toBe(false);
  });
});
