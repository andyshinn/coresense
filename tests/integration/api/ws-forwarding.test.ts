import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { getApiKey } from '../../../src/main/api/middleware/auth';
import { bus, emit } from '../../../src/main/events/bus';
import { startServer } from '../../../src/main/server';
import type { WsMessage } from '../../../src/shared/types';

let handle: Awaited<ReturnType<typeof startServer>> | null = null;
let socket: WebSocket | null = null;

afterEach(async () => {
  socket?.terminate();
  socket = null;
  await handle?.close();
  handle = null;
});

async function bootAndConnect(received: WsMessage[]) {
  const bridge = { getStatus: () => ({ running: false, clients: 0 }), on: () => {}, off: () => {} };
  handle = await startServer(null, bridge as never, { port: 0, bindAddress: '127.0.0.1' });
  const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?key=${getApiKey()}`);
  socket = ws;
  ws.on('message', (data) => received.push(JSON.parse(String(data)) as WsMessage));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

describe('server bus → WS forwarding', () => {
  it('wraps forwarded bus events in their WS envelope', async () => {
    const received: WsMessage[] = [];
    await bootAndConnect(received);

    emit.contactEvicted('Old Node');
    emit.messageState('m1', 'sent');
    emit.error('radio said no');

    await vi.waitFor(() => expect(received.some((m) => m.type === 'error')).toBe(true));
    expect(received).toContainEqual({ type: 'contactEvicted', payload: { name: 'Old Node' } });
    expect(received).toContainEqual({ type: 'messageState', payload: { id: 'm1', state: 'sent' } });
    expect(received).toContainEqual({ type: 'error', payload: { message: 'radio said no' } });
  });

  it('unsubscribes every listener it registered on close', async () => {
    const before = new Map(bus.eventNames().map((e) => [e, bus.listenerCount(e)]));
    await bootAndConnect([]);
    expect(bus.listenerCount('contactEvicted')).toBeGreaterThan(before.get('contactEvicted') ?? 0);

    socket?.terminate();
    socket = null;
    await handle?.close();
    handle = null;

    for (const event of bus.eventNames()) expect(bus.listenerCount(event)).toBe(before.get(event) ?? 0);
  });
});
