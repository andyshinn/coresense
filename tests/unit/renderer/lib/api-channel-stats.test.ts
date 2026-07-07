import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ApiClient, api } from '../../../../src/renderer/lib/api';
import type { ChannelStats } from '../../../../src/shared/types';

const client: ApiClient = { baseUrl: 'http://localhost:9999', apiKey: 'k' };
const STATS: ChannelStats = {
  count: 3,
  firstTs: 1,
  lastTs: 9,
  count24h: 1,
  count7d: 3,
  distinctSenders: 2,
  roster: [],
  perDay: [0, 0, 0, 0, 0, 0, 3],
};

afterEach(() => vi.unstubAllGlobals());

describe('api.getChannelStats', () => {
  it('GETs the encoded stats path and returns parsed ChannelStats', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(STATS), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getChannelStats(client, 'ch:General');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9999/api/channels/ch%3AGeneral/stats');
    expect(result).toEqual(STATS);
  });

  it('throws the server error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 500 })));
    await expect(api.getChannelStats(client, 'ch:x')).rejects.toThrow('boom');
  });
});
