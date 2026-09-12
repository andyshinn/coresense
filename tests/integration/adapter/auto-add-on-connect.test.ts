import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { DEFAULT_AUTO_ADD_CONFIG } from '../../../src/shared/types';
import { makeTestSession, type TestSession } from '../../support/session-harness';

// The library's handshake asks for device info, contacts, channels and battery
// — never CMD_GET_AUTO_ADD_CONFIG (0x3b). Without an explicit request the kind
// flags and `autoadd_max_hops` the Contacts panel presents as the RADIO's prefs
// are only ever whatever coresense last wrote locally, so a limit configured
// from the repeater CLI or another client is reported as "no limit" until the
// user happens to press Refresh in Device Info.

const CMD_GET_AUTO_ADD_CONFIG = 0x3b;
const CMD_APP_START = 0x01;

let live: TestSession | null = null;

/** Drive a full handshake to completion on fake timers: connect, let the paced
 *  writes run, close the contact-sync window, then let the 40 channel GETs
 *  drain so the session reaches phase 'done'. */
async function handshake(): Promise<TestSession> {
  const s = makeTestSession();
  live = s;
  s.transport.setState('connected');
  await vi.advanceTimersByTimeAsync(200); // DEVICE_QUERY, APP_START, GET_CONTACTS
  s.transport.receiveHex('0200000000'); // RESP_CONTACTS_START, total 0
  s.transport.receiveHex('0400000000'); // RESP_END_OF_CONTACTS
  await vi.advanceTimersByTimeAsync(5000); // channel slots + the tail of the handshake
  return s;
}

const codes = (s: TestSession) => s.transport.sent.map((f) => f[0]);

beforeEach(() => {
  vi.useFakeTimers();
  stateHolder().setAutoAddConfig({ ...DEFAULT_AUTO_ADD_CONFIG });
});

afterEach(() => {
  live?.transport.setState('idle');
  live?.adapter.stop();
  live = null;
  vi.useRealTimers();
  stateHolder().setAutoAddConfig({ ...DEFAULT_AUTO_ADD_CONFIG });
});

describe('auto-add config is read from the radio on connect', () => {
  it('issues CMD_GET_AUTO_ADD_CONFIG once the handshake completes', async () => {
    const s = await handshake();

    expect(codes(s)).toContain(CMD_GET_AUTO_ADD_CONFIG);
    expect(codes(s).filter((c) => c === CMD_GET_AUTO_ADD_CONFIG)).toHaveLength(1);
  });

  it('asks only after CMD_APP_START, so the radio has a session to answer from', async () => {
    const s = await handshake();

    const sent = codes(s);
    expect(sent.indexOf(CMD_GET_AUTO_ADD_CONFIG)).toBeGreaterThan(sent.indexOf(CMD_APP_START));
  });

  it('folds the radio reply into the holder, overriding the locally stored prefs', async () => {
    stateHolder().setAutoAddConfig({ ...DEFAULT_AUTO_ADD_CONFIG, radioMaxHops: 0, repeater: true });
    const s = await handshake();

    // RESP_AUTOADD_CONFIG: chat only (0x02), autoadd_max_hops = 3.
    s.transport.receiveHex('190203');

    const cfg = stateHolder().getAutoAddConfig();
    expect(cfg.radioMaxHops).toBe(3);
    expect(cfg.repeater).toBe(false);
    expect(cfg.chat).toBe(true);
  });
});
