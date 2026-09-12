import type { Models } from '@andyshinn/meshcore-ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { setProtocolSession } from '../../../src/main/protocol';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';

// Two receipt paths the library surfaces only as a resolved promise, never as a
// subscribable event: a repeater CLI reply and a returned trace. The route
// already knows the contact and already knows the reply arrived, so it is the
// cheapest honest place to bump last-heard (#45 item 9).

const PK = 'ee'.repeat(32);
const OTHER = 'ff'.repeat(32);

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

function seed(pubkey: string): void {
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
    { onRadio: true, nowMs: 1_750_000_000_000, heardLive: false },
  );
}

const heard = (pubkey: string) => discoveredStore.get(pubkey)?.last_heard_ms ?? null;

function postCli(body: unknown) {
  return app().request(`/api/repeater/c%3A${PK}/cli`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postTrace(body: unknown) {
  return app().request(`/api/repeater/c%3A${PK}/trace`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => setProtocolSession(null));

describe('POST /api/repeater/:key/cli — last-heard', () => {
  it('bumps last-heard when the repeater actually replies', async () => {
    seed(PK);
    seed(OTHER);
    const before = Date.now();
    setProtocolSession({ repeaterSendCli: vi.fn(() => Promise.resolve('uptime: 5d')) } as unknown as SessionAdapter);

    const res = await postCli({ command: 'uptime' });

    expect(res.status).toBe(200);
    expect(heard(PK)).toBeGreaterThanOrEqual(before);
    // Only the contact we heard from moves.
    expect(heard(OTHER)).toBe(0);
  });

  // A fire-and-forget send is outbound only; nothing came back to hear.
  it('does not bump for a send that expects no reply', async () => {
    seed(PK);
    setProtocolSession({ repeaterSendCli: vi.fn(() => Promise.resolve(undefined)) } as unknown as SessionAdapter);

    const res = await postCli({ command: 'reboot', expectReply: false });

    expect(res.status).toBe(202);
    expect(heard(PK)).toBe(0);
  });

  it('does not bump when the reply never arrives', async () => {
    seed(PK);
    setProtocolSession({
      repeaterSendCli: vi.fn(() => Promise.reject(new Error('CLI command timed out after 8000ms'))),
    } as unknown as SessionAdapter);

    const res = await postCli({ command: 'uptime' });

    expect(res.status).toBe(504);
    expect(heard(PK)).toBe(0);
  });
});

describe('POST /api/repeater/:key/trace — last-heard', () => {
  it('bumps last-heard for the traced contact when the trace comes back', async () => {
    seed(PK);
    const before = Date.now();
    setProtocolSession({
      repeaterTracePath: vi.fn(() => Promise.resolve({ tagHex: '01020304', hops: [] })),
    } as unknown as SessionAdapter);

    const res = await postTrace({ tag: 1, pathHex: 'aabb' });

    expect(res.status).toBe(200);
    expect(heard(PK)).toBeGreaterThanOrEqual(before);
  });

  it('does not bump when the trace never returns', async () => {
    seed(PK);
    setProtocolSession({
      repeaterTracePath: vi.fn(() => Promise.reject(new Error('trace timed out'))),
    } as unknown as SessionAdapter);

    const res = await postTrace({ tag: 1, pathHex: 'aabb' });

    expect(res.status).toBe(503);
    expect(heard(PK)).toBe(0);
  });
});
