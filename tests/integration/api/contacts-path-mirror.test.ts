import type { Models } from '@andyshinn/meshcore-ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { bus } from '../../../src/main/events/bus';
import { setProtocolSession } from '../../../src/main/protocol';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { flushContactSyncEmits } from '../../../src/main/state/contactSync';
import { stateHolder } from '../../../src/main/state/holder';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import type { DiscoveredContact } from '../../../src/shared/contacts/discovered';
import { DEFAULT_RADIO_SETTINGS } from '../../../src/shared/types';

// meshcore-ts's setContactPath/resetContactPath write the radio and then their
// OWN contact map — they emit neither contactObserved nor discovered, so nothing
// reached coresense's sqlite mirror. The Contact Manager reads its hop count
// from that mirror (and so does the rail, which prefers the discovered row), so
// a hand-set path left both showing the pre-edit value until the next full
// GET_CONTACTS. That is the stale-hop half of #45 item 8.

const PK = 'a1'.repeat(32);
const KEY = `c%3A${PK}`;

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

/** Seed a flood-routed (OUT_PATH_UNKNOWN) contact in the mirror. */
function seed(outPathLen = 0xff, outPathHex = ''): void {
  discoveredStore.upsert(
    {
      publicKeyHex: PK,
      name: 'Repeater-1',
      type: 2,
      flags: 0,
      outPathLen,
      outPathHex,
      lastAdvertUnix: 1_700_000_000,
      gpsLat: 0,
      gpsLon: 0,
      lastmod: 1,
    } as Models.ContactRecord,
    { onRadio: true, nowMs: 1_750_000_000_000, heardLive: false },
  );
}

function spySession(over: Partial<Record<'setContactPath' | 'resetContactPath', unknown>> = {}) {
  const setContactPath = vi.fn(() => Promise.resolve());
  const resetContactPath = vi.fn(() => Promise.resolve());
  setProtocolSession({
    setContactPath,
    resetContactPath,
    setContactPreferDirect: vi.fn(),
    ...over,
  } as unknown as SessionAdapter);
  return { setContactPath, resetContactPath };
}

/** Capture the coalesced discovered broadcast the route schedules. */
async function capturedDiscovered(run: () => Promise<unknown> | unknown): Promise<DiscoveredContact[] | null> {
  let rows: DiscoveredContact[] | null = null;
  const onDiscovered = (r: DiscoveredContact[]) => {
    rows = r;
  };
  bus.on('discovered', onDiscovered);
  try {
    await run();
    await flushContactSyncEmits();
  } finally {
    bus.off('discovered', onDiscovered);
  }
  return rows;
}

const putPath = (outPathHex: string) =>
  app().request(`/api/contacts/${KEY}/path`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ outPathHex }),
  });

afterEach(() => setProtocolSession(null));

describe('PUT /api/contacts/:key/path — discovered mirror', () => {
  it('packs the new path into out_path_len so the hop count reads back', async () => {
    stateHolder().setRadioSettings({ ...DEFAULT_RADIO_SETTINGS, pathHashMode: 2 });
    seed();
    spySession();

    const res = await putPath('aabbccdd'); // 4 bytes / 2-byte hashes = 2 hops

    expect(res.status).toBe(200);
    const row = discoveredStore.get(PK);
    // ((hashSize - 1) << 6) | hopCount — the firmware's packing, not a byte count.
    expect(row?.out_path_len).toBe(0x42);
    expect(row?.out_path_hex).toBe('aabbccdd');
  });

  it('makes the projected hop count match what the user set', async () => {
    stateHolder().setRadioSettings({ ...DEFAULT_RADIO_SETTINGS, pathHashMode: 2 });
    seed();
    spySession();

    const rows = await capturedDiscovered(() => putPath('aabbccdd'));

    const row = rows?.find((r) => r.publicKeyHex === PK);
    expect(row?.hops).toBe(2);
    expect(row?.outPathHashSize).toBe(2);
  });

  it('honours the radio 3-byte path-hash mode when packing', async () => {
    stateHolder().setRadioSettings({ ...DEFAULT_RADIO_SETTINGS, pathHashMode: 3 });
    seed();
    spySession();

    await putPath('aabbcc'); // 3 bytes / 3-byte hashes = 1 hop

    expect(discoveredStore.get(PK)?.out_path_len).toBe(0x81); // ((3-1)<<6)|1
    expect(discoveredStore.list([]).find((r) => r.publicKeyHex === PK)?.hops).toBe(1);
  });

  // Radio first, mirror second — the same strictness contacts-delete enforces.
  // A local write the radio rejected would desync the app from the firmware.
  it('leaves the mirror untouched when the radio rejects the write', async () => {
    stateHolder().setRadioSettings({ ...DEFAULT_RADIO_SETTINGS, pathHashMode: 2 });
    seed();
    spySession({ setContactPath: vi.fn(() => Promise.reject(new Error('radio disconnected'))) });

    const res = await putPath('aabbccdd');

    expect(res.status).toBe(503);
    expect(discoveredStore.get(PK)?.out_path_len).toBe(0xff);
  });
});

describe('DELETE /api/contacts/:key/path — discovered mirror', () => {
  it('returns the row to OUT_PATH_UNKNOWN so the hop cell reads Flood again', async () => {
    stateHolder().setRadioSettings({ ...DEFAULT_RADIO_SETTINGS, pathHashMode: 2 });
    seed(0x42, 'aabbccdd');
    spySession();

    const res = await app().request(`/api/contacts/${KEY}/path`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(discoveredStore.get(PK)?.out_path_len).toBe(0xff);
    expect(discoveredStore.get(PK)?.out_path_hex).toBe('');
    expect(discoveredStore.list([]).find((r) => r.publicKeyHex === PK)?.hops).toBeUndefined();
  });

  it('leaves the mirror untouched when the radio rejects the reset', async () => {
    seed(0x42, 'aabbccdd');
    spySession({ resetContactPath: vi.fn(() => Promise.reject(new Error('radio disconnected'))) });

    const res = await app().request(`/api/contacts/${KEY}/path`, { method: 'DELETE' });

    expect(res.status).toBe(503);
    expect(discoveredStore.get(PK)?.out_path_len).toBe(0x42);
  });
});
