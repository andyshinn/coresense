import type { Models } from '@andyshinn/meshcore-ts';
import { describe, expect, it, vi } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import type { ApiErrorBody, DiscoveredContactsResponse, OkResponse } from '../../../src/shared/api/contract';
import type { Contact } from '../../../src/shared/types';
import { installSessionStub, json, testRoutes } from '../../support/api';
import { captureBus } from '../../support/bus';

const ON_RADIO = 'aa'.repeat(32);
const HEARD_ONLY = 'bb'.repeat(32);

const alice: Contact = { key: `c:${ON_RADIO}`, publicKeyHex: ON_RADIO, name: 'Alice', kind: 'chat' };

/** A discovered-pool row, as an advert or a contact sync would leave it. */
function seedDiscovered(pubkey: string, name: string, onRadio: boolean): void {
  discoveredStore.upsert(
    {
      publicKeyHex: pubkey,
      name,
      type: 1,
      flags: 0,
      outPathLen: 0xff,
      outPathHex: '',
      lastAdvertUnix: 1_700_000_000,
      gpsLat: 0,
      gpsLon: 0,
      lastmod: 1,
    } as Models.ContactRecord,
    { onRadio, nowMs: 1_750_000_000_000, heardLive: false },
  );
}

async function discovered(): Promise<DiscoveredContactsResponse> {
  const res = await testRoutes().request('/api/discovered-contacts');
  expect(res.status).toBe(200);
  return (await res.json()) as DiscoveredContactsResponse;
}

describe('GET /api/contacts', () => {
  it('serves the stored contacts', async () => {
    stateHolder().setContacts([alice]);

    const res = await testRoutes().request('/api/contacts');

    expect(res.status).toBe(200);
    expect((await res.json()) as Contact[]).toEqual([alice]);
  });
});

describe('PUT /api/contacts/:key', () => {
  it('upserts the contact and broadcasts the list', async () => {
    stateHolder().setContacts([alice]);
    const broadcast = captureBus('contacts');
    const edited: Contact = { ...alice, pinned: true, muted: true };

    const res = await testRoutes().request(`/api/contacts/c%3A${ON_RADIO}`, json('PUT', edited));

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(stateHolder().getContacts()).toEqual([edited]);
    expect(broadcast.last()).toEqual([edited]);
  });
});

describe('GET /api/discovered-contacts', () => {
  it('serves the discovered pool with its on-radio flag', async () => {
    seedDiscovered(ON_RADIO, 'Alice', true);
    seedDiscovered(HEARD_ONLY, 'Bob', false);

    const rows = await discovered();

    expect(rows.map((r) => [r.key, r.name, r.onRadio]).sort()).toEqual([
      [`c:${ON_RADIO}`, 'Alice', true],
      [`c:${HEARD_ONLY}`, 'Bob', false],
    ]);
  });

  it('flags a node matched by an enabled block rule', async () => {
    seedDiscovered(ON_RADIO, 'Alice', true);
    seedDiscovered(HEARD_ONLY, 'Bob', false);
    stateHolder().addBlockRules([{ type: 'pubkey', pattern: HEARD_ONLY, tsFrom: 0, enabled: true }]);

    const blocked = Object.fromEntries((await discovered()).map((r) => [r.key, r.blocked]));
    expect(blocked).toEqual({ [`c:${ON_RADIO}`]: false, [`c:${HEARD_ONLY}`]: true });
  });
});

describe('POST /api/discovered-contacts/clear', () => {
  it('drops discovered-only rows, keeps on-radio ones, and broadcasts the pool', async () => {
    seedDiscovered(ON_RADIO, 'Alice', true);
    seedDiscovered(HEARD_ONLY, 'Bob', false);
    const broadcast = captureBus('discovered');

    const res = await testRoutes().request('/api/discovered-contacts/clear', { method: 'POST' });

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect((await discovered()).map((r) => r.key)).toEqual([`c:${ON_RADIO}`]);
    expect(broadcast.last()?.map((r) => r.key)).toEqual([`c:${ON_RADIO}`]);
  });
});

describe('POST /api/contacts/:key/remove-from-radio', () => {
  it('removes the contact from the radio by public key, keeping the local row', async () => {
    stateHolder().setContacts([alice]);
    const removeContactFromRadio = vi.fn((_pk: string) => Promise.resolve());
    installSessionStub({ removeContactFromRadio });

    const res = await testRoutes().request(`/api/contacts/c%3A${ON_RADIO}/remove-from-radio`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(removeContactFromRadio).toHaveBeenCalledWith(ON_RADIO);
    expect(stateHolder().getContacts()).toEqual([alice]);
  });

  it('answers 503 with the message when the radio op fails', async () => {
    installSessionStub({ removeContactFromRadio: () => Promise.reject(new Error('radio disconnected')) });

    const res = await testRoutes().request(`/api/contacts/c%3A${ON_RADIO}/remove-from-radio`, { method: 'POST' });

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'radio disconnected' });
  });
});
