import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { bus } from '../../../src/main/events/bus';
import { messagesStore } from '../../../src/main/storage/messages';
import type { Message } from '../../../src/shared/types';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  key: 'ch:General',
  ts: 1_700_000_000_000,
  body: 'hello world',
  state: 'received',
  ...over,
});

afterEach(() => {
  bus.removeAllListeners('messagesDeleted');
  bus.removeAllListeners('messages');
});

describe('DELETE /api/messages/:key/:id', () => {
  it('deletes the message and returns ok', async () => {
    messagesStore.insert(msg());
    const res = await app().request('/api/messages/ch%3AGeneral/m1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(messagesStore.findById('m1')).toBeNull();
  });

  it('emits messagesDeleted with the key and ids', async () => {
    messagesStore.insert(msg());
    const seen: { key: string; ids: string[] }[] = [];
    bus.on('messagesDeleted', (payload: { key: string; ids: string[] }) => seen.push(payload));
    await app().request('/api/messages/ch%3AGeneral/m1', { method: 'DELETE' });
    expect(seen).toEqual([{ key: 'ch:General', ids: ['m1'] }]);
  });

  it('does not emit the full messages re-push', async () => {
    messagesStore.insert(msg());
    const onMessages = vi.fn();
    bus.on('messages', onMessages);
    await app().request('/api/messages/ch%3AGeneral/m1', { method: 'DELETE' });
    expect(onMessages).not.toHaveBeenCalled();
  });

  it('404s an unknown id', async () => {
    const res = await app().request('/api/messages/ch%3AGeneral/nope', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('400s a malformed conversation key', async () => {
    messagesStore.insert(msg());
    const res = await app().request('/api/messages/bogus/m1', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('handles a DM key', async () => {
    messagesStore.insert(msg({ id: 'd1', key: 'c:deadbeef' }));
    const res = await app().request('/api/messages/c%3Adeadbeef/d1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(messagesStore.findById('d1')).toBeNull();
  });
});
