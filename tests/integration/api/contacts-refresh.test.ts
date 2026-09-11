import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { setProtocolSession } from '../../../src/main/protocol';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { endContactWalk, noteContactWalkStreaming } from '../../../src/main/state/contactWalk';
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

afterEach(() => {
  setProtocolSession(null);
  // Walk state is module-level (it has to be — it is shared between the route
  // and the auto-refresh timer), so drop it between cases.
  endContactWalk();
});

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

  // The hazard behind every guard here: meshcore-ts keeps ONE contacts iterator.
  // RESP_CONTACTS_START clears its syncSeen list and END_OF_CONTACTS removes
  // every contact missing from it, so a second walk started mid-stream makes the
  // first walk's END_OF_CONTACTS delete everything the second hasn't reached.
  it('refuses a second refresh while the first request is still outstanding', async () => {
    transportManager.setState('connected');
    let finish!: (v: unknown[]) => void;
    const { getContacts } = spySession({ contacts: () => new Promise<unknown[]>((r) => (finish = r)) });

    const first = post();
    await vi.waitFor(() => expect(getContacts).toHaveBeenCalledTimes(1));

    // The second control on screen (the rail's "Refresh from radio") has its own
    // React `refreshing` flag, so the click really does reach the server.
    const second = await post();
    expect(await second.json()).toEqual({ ok: true, skipped: true });
    expect(getContacts).toHaveBeenCalledTimes(1);

    finish([]);
    await first;
  });

  // getContacts() RESOLVING is not "the walk finished": the lib arms its
  // END_OF_CONTACTS waiter with a 10s timeout that resolves rather than
  // rejects, so on a radio with more contacts than that walk fits into, the
  // call returns while RESP_CONTACT frames are still arriving.
  it('keeps refusing after the request resolves mid-stream, until END_OF_CONTACTS', async () => {
    transportManager.setState('connected');
    const { getContacts } = spySession({
      contacts: () => {
        // Frames are flowing when the 10s waiter gives up and resolves us.
        noteContactWalkStreaming();
        return Promise.resolve([{}, {}]);
      },
    });

    expect((await post()).status).toBe(200);
    expect(getContacts).toHaveBeenCalledTimes(1);

    const duringStream = await post();
    expect(await duringStream.json()).toEqual({ ok: true, skipped: true });
    expect(getContacts).toHaveBeenCalledTimes(1);

    // RESP_END_OF_CONTACTS — what adapterEvents' `contactsSynced` handler calls.
    endContactWalk();
    expect((await post()).status).toBe(200);
    expect(getContacts).toHaveBeenCalledTimes(2);
  });

  // The mirror image: a request that never drew a single frame (dead link, the
  // lib's start waiter timing out) must not lock the button out for two minutes.
  it('releases the guard when the walk drew no frames at all', async () => {
    transportManager.setState('connected');
    const { getContacts } = spySession();

    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect(getContacts).toHaveBeenCalledTimes(2);
  });

  // The handshake's own walk keeps streaming after its END_OF_CONTACTS waiter
  // times out and flips phase to 'done', so `phase` alone can't gate this.
  it("refuses while some other walk (the handshake's) is still streaming", async () => {
    transportManager.setState('connected');
    const { getContacts } = spySession({ phase: 'done' });
    noteContactWalkStreaming();

    const res = await post();

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
