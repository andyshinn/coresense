import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { setProtocolSession } from '../../../src/main/protocol';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { transportManager } from '../../../src/main/transport/manager';
import { DEFAULT_SYNC_PROGRESS, type SyncProgress } from '../../../src/shared/types';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

/** A SessionAdapter double exposing only the two methods the route uses. */
function spySession(opts: { contacts?: () => Promise<unknown[]>; phase?: SyncProgress['phase'] } = {}) {
  const getContacts = vi.fn(opts.contacts ?? (() => Promise.resolve([{}, {}, {}])));
  const getSyncProgress = vi.fn(() => ({ ...DEFAULT_SYNC_PROGRESS, phase: opts.phase ?? 'done' }));
  setProtocolSession({ getContacts, getSyncProgress } as unknown as SessionAdapter);
  return { getContacts, getSyncProgress };
}

const post = () => app().request('/api/contacts/refresh', { method: 'POST' });

afterEach(() => setProtocolSession(null));

// #45 item 6 — the lever that isn't "disconnect and reconnect".
describe('POST /api/contacts/refresh', () => {
  it('re-enumerates the radio contact store and reports the count', async () => {
    transportManager.setState('connected');
    const { getContacts } = spySession();

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 3 });
    // Exactly once: a ~25s contact walk is not something to issue twice.
    expect(getContacts).toHaveBeenCalledTimes(1);
  });

  it('refuses without a radio instead of hanging on a dead link', async () => {
    transportManager.setState('idle');
    const { getContacts } = spySession();

    const res = await post();

    expect(res.status).toBe(503);
    expect(getContacts).not.toHaveBeenCalled();
  });

  // withSyncLock QUEUES rather than rejects, so a walk issued mid-handshake
  // doesn't fail — it just runs a second full walk once the first finishes.
  it('skips (without calling the radio) while the handshake is still syncing', async () => {
    transportManager.setState('connected');
    const { getContacts } = spySession({ phase: 'syncing' });

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: true });
    expect(getContacts).not.toHaveBeenCalled();
  });

  it('surfaces a radio-side failure as 503 with the message', async () => {
    transportManager.setState('connected');
    spySession({ contacts: () => Promise.reject(new Error('GET_CONTACTS timed out')) });

    const res = await post();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'GET_CONTACTS timed out' });
  });
});
