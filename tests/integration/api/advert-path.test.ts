import type { Models } from '@andyshinn/meshcore-ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { bus } from '../../../src/main/events/bus';
import { setProtocolSession } from '../../../src/main/protocol';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { ADVERT_PATH_COOLDOWN_MS } from '../../../src/main/state/advertPath';
import { flushContactSyncEmits } from '../../../src/main/state/contactSync';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { transportManager } from '../../../src/main/transport/manager';
import type { DiscoveredContact } from '../../../src/shared/contacts/discovered';

// #45 item 7 — POST /api/contacts/:key/advert-path asks the radio for its cached
// INBOUND advert path for one contact. Every way that round trip can fail to
// produce a number is a distinct, non-alarming answer; the tests below pin each
// one to its status, because collapsing them into a generic 503 would report
// "radio error" for the majority of a real contact pool.

const PK = 'c3'.repeat(32);
const KEY = `c%3A${PK}`;

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

function seed(pubkey = PK, opts: { nowMs?: number; heardLive?: boolean } = {}): void {
  discoveredStore.upsert(
    {
      publicKeyHex: pubkey,
      name: 'Repeater',
      type: 2,
      flags: 0,
      outPathLen: 0xff,
      outPathHex: '',
      lastAdvertUnix: 1_700_000_000,
      gpsLat: 0,
      gpsLon: 0,
      lastmod: 1,
    } as Models.ContactRecord,
    { onRadio: true, nowMs: opts.nowMs ?? 1_750_000_000_000, heardLive: opts.heardLive ?? false },
  );
}

/** A SessionAdapter double exposing the two methods the measurement path uses. */
function spySession(opts: { path?: () => Promise<unknown>; onRadio?: boolean } = {}) {
  const getAdvertPath = vi.fn(
    opts.path ?? (() => Promise.resolve({ recvTimestampUnix: 1_760_000_000, hops: 2, pathHex: 'aabb' })),
  );
  const hasRadioContact = vi.fn(() => opts.onRadio ?? true);
  setProtocolSession({ getAdvertPath, hasRadioContact } as unknown as SessionAdapter);
  return { getAdvertPath, hasRadioContact };
}

const post = (query = '') => app().request(`/api/contacts/${KEY}/advert-path${query}`, { method: 'POST' });
const row = (pubkey = PK) => discoveredStore.get(pubkey);

afterEach(() => {
  setProtocolSession(null);
  transportManager.setState('idle');
  vi.useRealTimers();
});

describe('POST /api/contacts/:key/advert-path', () => {
  it('stores and returns the radio-reported inbound path', async () => {
    transportManager.setState('connected');
    seed();
    const { getAdvertPath } = spySession();

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cached: true,
      hops: 2,
      pathHex: 'aabb',
      recvTimestampUnix: 1_760_000_000,
      fromCache: false,
    });
    // The lib resolves the contact key itself, so it is the key — not the bare
    // pubkey — that has to go in.
    expect(getAdvertPath).toHaveBeenCalledWith(`c:${PK}`);
    expect(row()?.observed_hops).toBe(2);
    expect(row()?.observed_path_hex).toBe('aabb');
    expect(row()?.observed_at_unix).toBe(1_760_000_000);
  });

  it('broadcasts the refreshed pool so the rail updates without a reload', async () => {
    transportManager.setState('connected');
    seed();
    spySession();
    const onDiscovered = vi.fn();
    bus.on('discovered', onDiscovered);

    await post();
    await flushContactSyncEmits();

    expect(onDiscovered).toHaveBeenCalled();
    const pool = onDiscovered.mock.calls.at(-1)?.[0] as DiscoveredContact[];
    expect(pool.find((d) => d.publicKeyHex === PK)?.observedHops).toBe(2);
  });

  // "Heard direct" is the best possible answer and the one most likely to be
  // mangled by a truthiness check somewhere in the chain.
  it('keeps a zero-hop measurement as a real value end to end', async () => {
    transportManager.setState('connected');
    seed();
    spySession({ path: () => Promise.resolve({ recvTimestampUnix: 1_760_000_000, hops: 0, pathHex: '' }) });

    const body = (await (await post()).json()) as { cached: boolean; hops: number };

    expect(body).toMatchObject({ cached: true, hops: 0 });
    expect(row()?.observed_hops).toBe(0);
  });

  // The radio's advert-path table is a 16-entry RAM ring, so this is the normal
  // answer for most contacts — not an error, and it must not clobber an older
  // real measurement.
  it('answers 200 { cached: false } when the radio has nothing cached', async () => {
    transportManager.setState('connected');
    seed();
    discoveredStore.setObservedPath(PK, { hops: 4, pathHex: 'ccdd', recvUnix: 1_759_000_000 });
    spySession({ path: () => Promise.resolve(null) });

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cached: false });
    expect(row()?.observed_hops).toBe(4);
  });

  it('refuses without a radio instead of hanging on a dead link', async () => {
    transportManager.setState('idle');
    seed();
    const { getAdvertPath } = spySession();

    const res = await post();

    expect(res.status).toBe(503);
    expect(getAdvertPath).not.toHaveBeenCalled();
  });

  // meshcore-ts THROWS rather than resolving null for a contact the radio does
  // not store, which is most of a real discovered pool. Pre-checked, so it never
  // reaches the radio and never reads as a fault.
  it('answers 422 for a contact the radio does not store', async () => {
    transportManager.setState('connected');
    seed();
    const { getAdvertPath } = spySession({ onRadio: false });

    const res = await post();

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'contact is not on the radio', code: 'NOT_ON_RADIO' });
    expect(getAdvertPath).not.toHaveBeenCalled();
  });

  it('reports a timed-out command as 503 and writes nothing', async () => {
    transportManager.setState('connected');
    seed();
    spySession({ path: () => Promise.reject(new Error('request timed out after 5000ms')) });

    const res = await post();

    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toEqual({ error: 'request timed out after 5000ms' });
    expect(row()?.observed_hops).toBe(-1);
  });

  // Three affordances can want the same contact at once (the rail's automatic
  // measure, its button, and an advert landing). One answer, one command.
  it('collapses concurrent requests for the same contact into one command', async () => {
    transportManager.setState('connected');
    seed();
    let finish!: (v: unknown) => void;
    const { getAdvertPath } = spySession({ path: () => new Promise((r) => (finish = r)) });

    const first = post();
    await vi.waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(1));
    const second = post();

    finish({ recvTimestampUnix: 1_760_000_000, hops: 1, pathHex: 'aa' });
    expect(await (await first).json()).toMatchObject({ cached: true, hops: 1 });
    expect(await (await second).json()).toMatchObject({ cached: true, hops: 1 });
    expect(getAdvertPath).toHaveBeenCalledTimes(1);
  });

  it('answers a repeat request from the mirror instead of re-asking the radio', async () => {
    transportManager.setState('connected');
    seed();
    const { getAdvertPath } = spySession();

    await post();
    const res = await post();

    expect(await res.json()).toEqual({
      cached: true,
      hops: 2,
      pathHex: 'aabb',
      recvTimestampUnix: 1_760_000_000,
      fromCache: true,
    });
    expect(getAdvertPath).toHaveBeenCalledTimes(1);
  });

  // A miss stores nothing, so without the cooldown covering it too, a rail that
  // re-renders on every websocket push would re-ask forever.
  it('does not re-ask the radio after a miss either', async () => {
    transportManager.setState('connected');
    seed();
    const { getAdvertPath } = spySession({ path: () => Promise.resolve(null) });

    await post();
    const res = await post();

    expect(await res.json()).toEqual({ cached: false });
    expect(getAdvertPath).toHaveBeenCalledTimes(1);
  });

  it('re-asks the radio when the user forces it', async () => {
    transportManager.setState('connected');
    seed();
    const { getAdvertPath } = spySession();

    await post();
    const res = await post('?force=1');

    expect(await res.json()).toMatchObject({ fromCache: false });
    expect(getAdvertPath).toHaveBeenCalledTimes(2);
  });

  it('re-asks the radio once the cooldown has elapsed', async () => {
    transportManager.setState('connected');
    seed();
    const { getAdvertPath } = spySession();

    await post();
    const realNow = Date.now;
    const t = realNow();
    vi.spyOn(Date, 'now').mockImplementation(() => t + ADVERT_PATH_COOLDOWN_MS + 1);
    try {
      await post();
    } finally {
      vi.mocked(Date.now).mockRestore();
    }

    expect(getAdvertPath).toHaveBeenCalledTimes(2);
  });
});

// The reply's recvTimestampUnix is the RADIO's record that it received an
// advert from this node — frequently while coresense was not attached, and for
// a contact that arrived through a GET_CONTACTS walk it is the only reception
// time that will ever exist (a walk deliberately never advances last_heard_ms).
// Dropping it left such a node reading "never" on every surface and excluded
// from every Last-heard window, while the app held firmware-authoritative proof
// it was heard minutes ago (#45 items 7 and 9).
describe('POST /api/contacts/:key/advert-path — the reception time is a last-heard', () => {
  const minutesAgoUnix = (m: number) => Math.floor((Date.now() - m * 60_000) / 1000);

  it('adopts a plausible radio reception time as last heard', async () => {
    transportManager.setState('connected');
    seed();
    expect(row()?.last_heard_ms).toBe(0); // a contact walk heard nothing
    const recv = minutesAgoUnix(10);
    spySession({ path: () => Promise.resolve({ recvTimestampUnix: recv, hops: 2, pathHex: 'aabb' }) });

    await post();

    expect(row()?.last_heard_ms).toBe(recv * 1000);
  });

  it('never moves the clock backwards over a reception we timed ourselves', async () => {
    transportManager.setState('connected');
    // Seeded as a LIVE advert, so the SQL `last_heard_ms < ?` guard is what has
    // to refuse the older value — not markHeard's write throttle.
    const ourReception = Date.now() - 60_000;
    seed(PK, { nowMs: ourReception, heardLive: true });
    spySession({ path: () => Promise.resolve({ recvTimestampUnix: minutesAgoUnix(30), hops: 2, pathHex: 'aabb' }) });

    await post();

    expect(row()?.last_heard_ms).toBe(ourReception);
  });

  // A radio whose RTC was never set reports something near the epoch, and one
  // that is fast would park last_heard_ms ahead of now — where, because the
  // column only moves forward, it would block every REAL reception after it.
  it.each([
    ['an unset clock (0)', 0],
    ['an epoch-ish clock', 60],
    ['a clock in the future', Math.floor(Date.now() / 1000) + 86_400],
    ['a reading older than the sanity window', Math.floor(Date.now() / 1000) - 30 * 86_400],
  ])('ignores %s', async (_label, recv) => {
    transportManager.setState('connected');
    seed();
    spySession({ path: () => Promise.resolve({ recvTimestampUnix: recv, hops: 2, pathHex: 'aabb' }) });

    await post();

    // The measurement itself still lands; only the last-heard column is refused.
    expect(row()?.observed_hops).toBe(2);
    expect(row()?.last_heard_ms).toBe(0);
  });
});
