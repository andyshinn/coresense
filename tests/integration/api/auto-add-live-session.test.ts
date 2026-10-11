import { Buffer } from 'node:buffer';
import { Protocol } from '@andyshinn/meshcore-ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { markRadioTelemetryPolicyKnown } from '../../../src/main/telemetry/policy';
import { type AutoAddConfig, DEFAULT_AUTO_ADD_CONFIG } from '../../../src/shared/types';
import { json, testRoutes } from '../../support/api';
import { makeTestSession, type TestSession } from '../../support/session-harness';

// PUT /api/device/auto-add driven against a REAL MeshCoreSession over a
// LoopbackTransport, not a hand-rolled SessionAdapter double. The defect these
// cover lives in the seam between the two: the library's `setAutoAddConfig()`
// writes the frame but never its own AutoAddConfig mirror, and a later
// `setOtherParams()` re-emits `autoAddConfig` built from that mirror — which
// wireSessionEvents persists straight into the holder. Only a session that
// really emits can catch it.

const { CMD, RESP } = Protocol;

/** A started session whose transport is connected and which acks the two
 *  commands this route issues, exactly as a radio would. */
function connectedSession(): TestSession {
  const s = makeTestSession({ connected: true, installAsProtocolSession: true });
  const send = s.transport.send.bind(s.transport);
  s.transport.send = async (bytes: Uint8Array) => {
    await send(bytes);
    if (bytes[0] === CMD.SET_AUTO_ADD_CONFIG || bytes[0] === CMD.SET_OTHER_PARAMS) s.receive(Buffer.from([RESP.OK]));
  };
  // Makes the session `connected` so its command methods run. The handshake it
  // kicks off writes its own frames in the background; nothing here waits on it.
  s.transport.setState('connected');
  // Stand in for the connect-time telemetry-policy read-back, which needs a
  // RESP_SELF_INFO this loopback never sends (see telemetry/policy.ts).
  markRadioTelemetryPolicyKnown();
  return s;
}

function putAutoAdd(body: AutoAddConfig) {
  return testRoutes().request('/api/device/auto-add', json('PUT', body));
}

/** Every frame the session put on the wire whose code byte is `code`, as hex. */
const sentHex = (s: TestSession, code: number) => s.sentWithCode(code).map((f) => f.toString('hex'));

// In beforeEach, not afterEach: the previous test's session is stopped only in
// the global afterEach (tests/support/teardown.ts), after this file's hooks, and
// its background handshake can still write the holder until then.
beforeEach(() => {
  stateHolder().setAutoAddConfig({ ...DEFAULT_AUTO_ADD_CONFIG });
});

describe('PUT /api/device/auto-add against a live MeshCoreSession', () => {
  it('does not let the mode frame roll the saved kind flags back', async () => {
    // The state at connect: radio auto-adds everything, every kind ticked.
    // (Seeded before the session is built — SessionAdapter.start() primes the
    // library mirror from the holder.)
    stateHolder().setAutoAddConfig({ ...DEFAULT_AUTO_ADD_CONFIG });
    const s = connectedSession();

    const res = await putAutoAdd({
      ...DEFAULT_AUTO_ADD_CONFIG,
      mode: 'selected',
      chat: true,
      repeater: false,
      room: false,
      sensor: false,
      radioMaxHops: 3,
    });

    expect(res.status).toBe(200);
    // 0x3a [overwriteOldest|chat = 0x03] [hops 3], then 0x26 with the manual-add
    // byte in position 1.
    expect(sentHex(s, CMD.SET_AUTO_ADD_CONFIG)).toEqual(['3a0303']);
    expect(sentHex(s, CMD.SET_OTHER_PARAMS)[0]?.slice(2, 4)).toBe('01');

    // The radio is chat-only now. So must the app be: the library's
    // setOtherParams emits the whole mirror, and wireSessionEvents writes it
    // into the holder — a stale mirror silently republishes the four kind flags
    // as they stood at process start and persists them over the user's save.
    const cfg = stateHolder().getAutoAddConfig();
    expect(cfg.mode).toBe('selected');
    expect(cfg.manualAddContacts).toBe(1);
    expect(cfg.chat).toBe(true);
    expect(cfg.repeater).toBe(false);
    expect(cfg.room).toBe(false);
    expect(cfg.sensor).toBe(false);
    expect(cfg.radioMaxHops).toBe(3);
  });

  it('leaves the library holding the selection it just pushed', async () => {
    stateHolder().setAutoAddConfig({ ...DEFAULT_AUTO_ADD_CONFIG });
    const s = connectedSession();

    await putAutoAdd({
      ...DEFAULT_AUTO_ADD_CONFIG,
      mode: 'selected',
      chat: true,
      repeater: false,
      room: false,
      sensor: false,
    });

    // The library gates its post-advert GET_CONTACTS re-sync on this mirror
    // (`shouldAutoAdd`): left at the boot value it keeps re-syncing the whole
    // contact store for every repeater advert the radio is now refusing.
    expect(s.adapter.getLibAutoAddConfig()).toMatchObject({
      mode: 'selected',
      chat: true,
      repeater: false,
      room: false,
      sensor: false,
      manualAddContacts: 1,
    });
  });

  it('keeps the app-only fields across the library re-emit', async () => {
    stateHolder().setAutoAddConfig({ ...DEFAULT_AUTO_ADD_CONFIG, autoRefreshContacts: true, showPublicKeys: false });
    connectedSession();

    await putAutoAdd({
      ...DEFAULT_AUTO_ADD_CONFIG,
      mode: 'selected',
      autoRefreshContacts: true,
      showPublicKeys: false,
    });

    const cfg = stateHolder().getAutoAddConfig();
    expect(cfg.autoRefreshContacts).toBe(true);
    expect(cfg.showPublicKeys).toBe(false);
  });
});
