import { describe, expect, it, vi } from 'vitest';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { stateHolder } from '../../../src/main/state/holder';
import { messagesStore } from '../../../src/main/storage/messages';
import type { ApiErrorBody, SendMessageResponse } from '../../../src/shared/api/contract';
import type { Message, SearchResults } from '../../../src/shared/types';
import { installSessionStub, json, testRoutes } from '../../support/api';
import { captureBus } from '../../support/bus';

const DM_PK = 'dd'.repeat(32);

function seed(key: string, n: number): void {
  for (let i = 0; i < n; i++) {
    messagesStore.insert({
      id: `${key}-m${i}`,
      key,
      ts: 1_700_000_000_000 + i,
      body: `beacon ${i}`,
      state: 'received',
      fromPublicKeyHex: 'name:alice',
    } as Message);
  }
}

const send = (key: string, body: unknown) =>
  testRoutes().request(`/api/messages/${encodeURIComponent(key)}`, json('POST', body));

describe('GET /api/messages/:key', () => {
  it('serves the trailing window of one conversation, oldest first', async () => {
    seed('ch:General', 3);
    seed('ch:Other', 2);

    const res = await testRoutes().request('/api/messages/ch%3AGeneral');

    expect(res.status).toBe(200);
    const rows = (await res.json()) as Message[];
    expect(rows.map((m) => m.id)).toEqual(['ch:General-m0', 'ch:General-m1', 'ch:General-m2']);
  });

  it('honours limit and before', async () => {
    seed('ch:General', 5);

    const limited = (await (await testRoutes().request('/api/messages/ch%3AGeneral?limit=2')).json()) as Message[];
    expect(limited.map((m) => m.id)).toEqual(['ch:General-m3', 'ch:General-m4']);

    const before = 1_700_000_000_000 + 3;
    const older = (await (
      await testRoutes().request(`/api/messages/ch%3AGeneral?limit=2&before=${before}`)
    ).json()) as Message[];
    expect(older.map((m) => m.id)).toEqual(['ch:General-m1', 'ch:General-m2']);
  });
});

describe('POST /api/messages/:key', () => {
  it('sends to a channel, records the message as sent and answers its id', async () => {
    const sendChannelText = vi.fn((_key: string, _text: string) =>
      Promise.resolve({ ok: true, channelHash: 0x2a, timestampUnix: 1_750_000_000 }),
    );
    const registerChannelSend = vi.fn<SessionAdapter['registerChannelSend']>();
    installSessionStub({ sendChannelText, registerChannelSend });
    const broadcast = captureBus('messages');
    const states = captureBus('messageState');

    const res = await send('ch:General', { body: 'hello mesh' });

    expect(res.status).toBe(200);
    const { ok, id } = (await res.json()) as SendMessageResponse;
    expect(ok).toBe(true);
    expect(sendChannelText).toHaveBeenCalledWith('ch:General', 'hello mesh');
    expect(registerChannelSend).toHaveBeenCalledWith({ messageId: id, channelHash: 0x2a, timestampUnix: 1_750_000_000 });
    expect(stateHolder().getMessagesForKey('ch:General')).toEqual([
      expect.objectContaining({ id, body: 'hello mesh', state: 'sent' }),
    ]);
    expect(broadcast.calls[0]?.[0]).toBe('ch:General');
    expect(states.calls).toEqual([[id, 'sent']]);
  });

  it('answers 503 with the radio error when a channel send fails, marking the row failed', async () => {
    installSessionStub({ sendChannelText: () => Promise.resolve({ ok: false, error: 'no slot index' }) });

    const res = await send('ch:General', { body: 'hello mesh' });

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'no slot index' });
    expect(
      stateHolder()
        .getMessagesForKey('ch:General')
        .map((m) => m.state),
    ).toEqual(['failed']);
  });

  it('answers a DM as soon as it is queued, leaving the retries to the background', async () => {
    const sendDm = vi.fn((_key: string, _text: string, _id: string) => Promise.resolve({ ok: true }));
    installSessionStub({ sendDmTextWithRetry: sendDm });

    const res = await send(`c:${DM_PK}`, { body: 'hi bob' });

    expect(res.status).toBe(200);
    const { id } = (await res.json()) as SendMessageResponse;
    expect(sendDm).toHaveBeenCalledWith(`c:${DM_PK}`, 'hi bob', id);
    expect(stateHolder().getMessagesForKey(`c:${DM_PK}`)).toEqual([
      expect.objectContaining({ id, body: 'hi bob', state: 'sending' }),
    ]);
  });

  it('answers 400 for a key that is neither a channel nor a contact', async () => {
    const sendChannelText = vi.fn();
    installSessionStub({ sendChannelText });

    const res = await send('bogus', { body: 'hello' });

    expect(res.status).toBe(400);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'key must be ch:<name> or c:<pubkey>' });
    expect(sendChannelText).not.toHaveBeenCalled();
  });
});

describe('POST /api/search', () => {
  it('answers matching messages with totals', async () => {
    seed('ch:Ops', 3);

    const res = await testRoutes().request('/api/search', json('POST', { query: 'beacon', sort: 'recency', limit: 2 }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchResults;
    expect(body.total.messages).toBe(3);
    expect(body.messages.map((m) => m.id)).toEqual(['ch:Ops-m2', 'ch:Ops-m1']);
  });

  it('answers no hits for a query nothing matches', async () => {
    seed('ch:Ops', 3);

    const res = await testRoutes().request('/api/search', json('POST', { query: 'zzzz', sort: 'relevance' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchResults;
    expect(body.messages).toEqual([]);
    expect(body.total.messages).toBe(0);
  });
});
