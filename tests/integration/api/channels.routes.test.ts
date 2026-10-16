import { describe, expect, it, vi } from 'vitest';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { stateHolder } from '../../../src/main/state/holder';
import type { ApiErrorBody, OkResponse, PushChannelResponse } from '../../../src/shared/api/contract';
import type { Channel } from '../../../src/shared/types';
import { installSessionStub, json, testRoutes } from '../../support/api';
import { captureBus } from '../../support/bus';

const SECRET = '00112233445566778899aabbccddeeff';
const DERIVED = 'ffeeddccbbaa99887766554433221100';

const general: Channel = { key: 'ch:General', name: 'General', kind: 'public' };
const onDevice: Channel = { key: 'ch:Ops', name: 'Ops', kind: 'private', idx: 4, secretHex: SECRET };

const channel = (key: string) =>
  stateHolder()
    .getChannels()
    .find((c) => c.key === key);

interface SlotStub {
  setChannel: ReturnType<typeof vi.fn<SessionAdapter['setChannel']>>;
  markChannelPresent: ReturnType<typeof vi.fn<SessionAdapter['markChannelPresent']>>;
  markChannelAbsent: ReturnType<typeof vi.fn<SessionAdapter['markChannelAbsent']>>;
}

/** A radio double for the channel-slot writes: `freeSlot` is what
 *  pickFreeSlot answers, `present` the keys the device reports holding, and
 *  `accepts` whether SET_CHANNEL is acked. */
function slotRadio(opts: { freeSlot?: number | null; present?: string[]; accepts?: boolean } = {}): SlotStub {
  const stub: SlotStub = {
    setChannel: vi.fn<SessionAdapter['setChannel']>(() => Promise.resolve(opts.accepts ?? true)),
    markChannelPresent: vi.fn<SessionAdapter['markChannelPresent']>(),
    markChannelAbsent: vi.fn<SessionAdapter['markChannelAbsent']>(),
  };
  installSessionStub({
    ...stub,
    getDevicePresence: () => opts.present ?? [],
    pickFreeSlot: () => (opts.freeSlot === undefined ? 7 : opts.freeSlot),
    deriveSecret: () => DERIVED,
  });
  return stub;
}

const post = (path: string) => testRoutes().request(path, { method: 'POST' });

describe('PUT /api/channels/:key', () => {
  it('upserts the channel and broadcasts the list', async () => {
    stateHolder().setChannels([general]);
    const broadcast = captureBus('channels');
    const edited: Channel = { ...general, muted: true, pinned: true };

    const res = await testRoutes().request('/api/channels/ch%3AGeneral', json('PUT', edited));

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(channel('ch:General')).toMatchObject(edited);
    expect(broadcast.last()).toEqual(stateHolder().getChannels());
  });

  it('adds a channel it has not seen', async () => {
    stateHolder().setChannels([general]);
    const hashtag: Channel = { key: 'ch:#mesh', name: '#mesh', kind: 'hashtag' };

    const res = await testRoutes().request(`/api/channels/${encodeURIComponent('ch:#mesh')}`, json('PUT', hashtag));

    expect(res.status).toBe(200);
    expect(
      stateHolder()
        .getChannels()
        .map((c) => c.key),
    ).toEqual(['ch:General', 'ch:#mesh']);
  });
});

describe('DELETE /api/channels/:key', () => {
  it('forgets the channel and broadcasts the list', async () => {
    stateHolder().setChannels([general, onDevice]);
    const broadcast = captureBus('channels');

    const res = await testRoutes().request('/api/channels/ch%3AGeneral', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(
      stateHolder()
        .getChannels()
        .map((c) => c.key),
    ).toEqual(['ch:Ops']);
    expect(broadcast.last()?.map((c) => c.key)).toEqual(['ch:Ops']);
  });
});

describe('POST /api/channels/reorder', () => {
  it('rewrites each channel order by position, ignoring unknown keys, and broadcasts', async () => {
    stateHolder().setChannels([general, onDevice]);
    const broadcast = captureBus('channels');

    const res = await testRoutes().request(
      '/api/channels/reorder',
      json('POST', { keys: ['ch:Ops', 'ch:Nope', 'ch:General'] }),
    );

    expect(res.status).toBe(200);
    expect(channel('ch:Ops')?.order).toBe(0);
    expect(channel('ch:General')?.order).toBe(2);
    expect(broadcast.calls).toHaveLength(1);
  });
});

describe('POST /api/channels/:key/push-to-device', () => {
  it('writes an app-only channel to a free slot, records the slot and broadcasts', async () => {
    stateHolder().setChannels([general]);
    const radio = slotRadio({ freeSlot: 7 });
    const broadcast = captureBus('channels');

    const res = await post('/api/channels/ch%3AGeneral/push-to-device');

    expect(res.status).toBe(200);
    expect((await res.json()) as PushChannelResponse).toEqual({ ok: true, idx: 7 });
    // A public channel without a stored secret gets the name-derived one.
    expect(radio.setChannel).toHaveBeenCalledWith(7, 'General', DERIVED);
    expect(channel('ch:General')).toMatchObject({ idx: 7, secretHex: DERIVED });
    expect(radio.markChannelPresent).toHaveBeenCalledWith(expect.objectContaining({ key: 'ch:General', idx: 7 }));
    expect(broadcast.last()).toEqual(stateHolder().getChannels());
  });

  it('overwrites the slot a channel already holds on the device', async () => {
    stateHolder().setChannels([onDevice]);
    const radio = slotRadio({ freeSlot: 9, present: ['ch:Ops'] });

    const res = await post('/api/channels/ch%3AOps/push-to-device');

    expect((await res.json()) as PushChannelResponse).toEqual({ ok: true, idx: 4 });
    expect(radio.setChannel).toHaveBeenCalledWith(4, 'Ops', SECRET);
  });

  it('answers 404 for a channel the app does not know', async () => {
    stateHolder().setChannels([general]);
    const radio = slotRadio();

    const res = await post('/api/channels/ch%3ANope/push-to-device');

    expect(res.status).toBe(404);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'unknown channel ch:Nope' });
    expect(radio.setChannel).not.toHaveBeenCalled();
  });

  it('answers 409 when every slot is taken', async () => {
    stateHolder().setChannels([general]);
    const radio = slotRadio({ freeSlot: null });

    const res = await post('/api/channels/ch%3AGeneral/push-to-device');

    expect(res.status).toBe(409);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'all 16 channel slots are in use' });
    expect(radio.setChannel).not.toHaveBeenCalled();
    expect(channel('ch:General')?.idx).toBeUndefined();
  });

  it('answers 503 and records nothing when the radio rejects the write', async () => {
    stateHolder().setChannels([general]);
    const radio = slotRadio({ accepts: false });
    const broadcast = captureBus('channels');

    const res = await post('/api/channels/ch%3AGeneral/push-to-device');

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'radio rejected SET_CHANNEL or timed out' });
    expect(channel('ch:General')).toEqual(general);
    expect(radio.markChannelPresent).not.toHaveBeenCalled();
    expect(broadcast.calls).toHaveLength(0);
  });
});

describe('POST /api/channels/:key/remove-from-device', () => {
  it('zeroes the slot, forgets the slot index (keeping the channel) and broadcasts', async () => {
    stateHolder().setChannels([onDevice]);
    const radio = slotRadio();
    const broadcast = captureBus('channels');

    const res = await post('/api/channels/ch%3AOps/remove-from-device');

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(radio.setChannel).toHaveBeenCalledWith(4, '', '00'.repeat(16));
    expect(radio.markChannelAbsent).toHaveBeenCalledWith(4);
    expect(channel('ch:Ops')).toBeDefined();
    expect(channel('ch:Ops')?.idx).toBeUndefined();
    expect(broadcast.calls).toHaveLength(1);
  });

  it('answers 404 for a channel the app does not know', async () => {
    stateHolder().setChannels([onDevice]);
    slotRadio();

    const res = await post('/api/channels/ch%3ANope/remove-from-device');

    expect(res.status).toBe(404);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'unknown channel ch:Nope' });
  });

  it('answers 409 for a channel with no known device slot', async () => {
    stateHolder().setChannels([general]);
    const radio = slotRadio();

    const res = await post('/api/channels/ch%3AGeneral/remove-from-device');

    expect(res.status).toBe(409);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'channel has no known device slot' });
    expect(radio.setChannel).not.toHaveBeenCalled();
  });

  it('answers 503 and keeps the slot when the radio rejects the write', async () => {
    stateHolder().setChannels([onDevice]);
    const radio = slotRadio({ accepts: false });

    const res = await post('/api/channels/ch%3AOps/remove-from-device');

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'radio rejected SET_CHANNEL or timed out' });
    expect(channel('ch:Ops')?.idx).toBe(4);
    expect(radio.markChannelAbsent).not.toHaveBeenCalled();
  });
});
