import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { packetStore } from '../../../src/main/storage/packets';
import type { OkResponse } from '../../../src/shared/api/contract';
import { json, testRoutes } from '../../support/api';
import { captureBusEvents } from '../../support/bus';

const putDraft = (body: unknown) => testRoutes().request('/api/drafts', json('PUT', body));

describe('PUT /api/drafts', () => {
  it('stores a draft under its key without broadcasting it', async () => {
    stateHolder().setDrafts({ 'ch:Other': 'keep me' });
    const bus = captureBusEvents();

    const res = await putDraft({ key: 'ch:General', text: 'half-typed' });

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(stateHolder().getDrafts()).toEqual({ 'ch:Other': 'keep me', 'ch:General': 'half-typed' });
    // Draft text is per-window typing; fanning it out would fight a second window.
    expect(bus.names).toEqual([]);
  });

  it('deletes the entry for empty text', async () => {
    stateHolder().setDrafts({ 'ch:General': 'old', 'ch:Other': 'keep me' });

    const res = await putDraft({ key: 'ch:General', text: '' });

    expect(res.status).toBe(200);
    expect(stateHolder().getDrafts()).toEqual({ 'ch:Other': 'keep me' });
  });

  // The key travels in the body precisely so a literal '%' survives.
  it('keeps a key containing a literal percent sign intact', async () => {
    stateHolder().setDrafts({});

    await putDraft({ key: 'ch:100% Club', text: 'hi' });

    expect(stateHolder().getDrafts()).toEqual({ 'ch:100% Club': 'hi' });
  });
});

describe('POST /api/packets/clear', () => {
  it('empties the stored packet log', async () => {
    const pkt = { transportType: 'ble', kind: 'mesh', hex: '88', bytes: [], payloadHex: '15', payloadBytes: [] } as const;
    for (let i = 0; i < 3; i++) packetStore.record({ ...pkt, timestamp: i, bytes: [], payloadBytes: [] }, 1000);
    expect(packetStore.recent(10)).toHaveLength(3);

    const res = await testRoutes().request('/api/packets/clear', { method: 'POST' });

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(packetStore.recent(10)).toEqual([]);
  });
});
