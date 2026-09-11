import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProtocolSession } from '../../../src/main/protocol';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import {
  isContactAutoRefreshRunning,
  startContactAutoRefresh,
  stopContactAutoRefresh,
} from '../../../src/main/state/contactRefresh';
import { stateHolder } from '../../../src/main/state/holder';
import { transportManager } from '../../../src/main/transport/manager';
import { DEFAULT_AUTO_ADD_CONFIG, DEFAULT_SYNC_PROGRESS, type SyncProgress } from '../../../src/shared/types';

const INTERVAL = 60_000;

function spySession(opts: { contacts?: () => Promise<unknown[]>; phase?: SyncProgress['phase'] } = {}) {
  const getContacts = vi.fn(opts.contacts ?? (() => Promise.resolve([])));
  const getSyncProgress = vi.fn(() => ({ ...DEFAULT_SYNC_PROGRESS, phase: opts.phase ?? 'done' }));
  setProtocolSession({ getContacts, getSyncProgress } as unknown as SessionAdapter);
  return { getContacts };
}

function setAutoRefresh(on: boolean) {
  stateHolder().setAutoAddConfig({ ...DEFAULT_AUTO_ADD_CONFIG, pullToRefresh: on });
}

beforeEach(() => {
  vi.useFakeTimers();
  setAutoRefresh(true);
  transportManager.setState('connected');
});

afterEach(() => {
  stopContactAutoRefresh();
  vi.useRealTimers();
  setProtocolSession(null);
});

// The "Auto-refresh contacts" setting (persisted as `pullToRefresh`) had no
// implementation at all before #45 item 6 — the toggle wrote a field nothing
// read. This is the behaviour it now buys.
describe('contact auto-refresh', () => {
  it('re-reads the contact store once per interval while connected and enabled', async () => {
    const { getContacts } = spySession();
    startContactAutoRefresh(INTERVAL);

    // Nothing immediately: the connect that armed this just finished the
    // handshake's own full contact sync.
    expect(getContacts).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(getContacts).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(getContacts).toHaveBeenCalledTimes(2);
  });

  it('does nothing while the setting is off', async () => {
    const { getContacts } = spySession();
    setAutoRefresh(false);
    startContactAutoRefresh(INTERVAL);

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(getContacts).not.toHaveBeenCalled();
  });

  it('picks the setting up live, without a reconnect', async () => {
    const { getContacts } = spySession();
    setAutoRefresh(false);
    startContactAutoRefresh(INTERVAL);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(getContacts).not.toHaveBeenCalled();

    setAutoRefresh(true);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(getContacts).toHaveBeenCalledTimes(1);
  });

  it('does not walk the radio while it is disconnected', async () => {
    const { getContacts } = spySession();
    startContactAutoRefresh(INTERVAL);
    transportManager.setState('idle');

    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(getContacts).not.toHaveBeenCalled();
  });

  it('stands down while the handshake is syncing the same stream', async () => {
    const { getContacts } = spySession({ phase: 'syncing' });
    startContactAutoRefresh(INTERVAL);

    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(getContacts).not.toHaveBeenCalled();
  });

  // withSyncLock queues rather than rejects, so a radio slower than the interval
  // would otherwise accumulate back-to-back walks and stop delivering messages.
  it('never stacks a second walk on top of one still in flight', async () => {
    let finish!: (v: unknown[]) => void;
    let calls = 0;
    const { getContacts } = spySession({
      contacts: () => {
        calls += 1;
        // Only the FIRST walk hangs. Later ones settle, so the module's
        // in-flight flag can't stay latched past this test.
        return calls === 1 ? new Promise<unknown[]>((r) => (finish = r)) : Promise.resolve([]);
      },
    });
    startContactAutoRefresh(INTERVAL);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(getContacts).toHaveBeenCalledTimes(1);

    // Three more ticks pass while the first walk is still outstanding.
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(getContacts).toHaveBeenCalledTimes(1);

    finish([]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(getContacts).toHaveBeenCalledTimes(2);
  });

  it('keeps ticking after a failed walk rather than wedging', async () => {
    const { getContacts } = spySession({ contacts: () => Promise.reject(new Error('transport gone')) });
    startContactAutoRefresh(INTERVAL);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(getContacts).toHaveBeenCalledTimes(2);
  });

  it('is idempotent to start and safe to stop twice', async () => {
    const { getContacts } = spySession();
    startContactAutoRefresh(INTERVAL);
    startContactAutoRefresh(INTERVAL);
    expect(isContactAutoRefreshRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    // Two start calls must not mean two timers.
    expect(getContacts).toHaveBeenCalledTimes(1);

    stopContactAutoRefresh();
    stopContactAutoRefresh();
    expect(isContactAutoRefreshRunning()).toBe(false);

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(getContacts).toHaveBeenCalledTimes(1);
  });
});
