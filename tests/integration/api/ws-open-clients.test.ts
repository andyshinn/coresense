import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { getApiKey } from '../../../src/main/api/middleware/auth';
import { startServer } from '../../../src/main/server';

// hasOpenClients() is what the quit path asks before deferring a quit to the
// renderer (see shouldDeferQuit). It must track real sockets: false before any
// renderer connects, true while one is open, false again once it goes away.

let handle: Awaited<ReturnType<typeof startServer>> | null = null;
let socket: WebSocket | null = null;

async function boot() {
  const bridge = { getStatus: () => ({ running: false, clients: 0 }), on: () => {}, off: () => {} };
  handle = await startServer(null, bridge as never, { port: 0, bindAddress: '127.0.0.1' });
  return handle;
}

function connect(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?key=${getApiKey()}`);
  socket = ws;
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

afterEach(async () => {
  socket?.terminate();
  socket = null;
  await handle?.close();
  handle = null;
});

describe('startServer().hasOpenClients', () => {
  it('is false before any client connects', async () => {
    const server = await boot();
    expect(server.hasOpenClients()).toBe(false);
  });

  it('is true while a client is connected and false after it leaves', async () => {
    const server = await boot();
    const ws = await connect(server.port);
    await vi.waitFor(() => expect(server.hasOpenClients()).toBe(true));

    ws.close();
    await vi.waitFor(() => expect(server.hasOpenClients()).toBe(false));
  });

  it('does not count a client the key check rejected', async () => {
    const server = await boot();
    const rejected = new WebSocket(`ws://127.0.0.1:${server.port}/ws?key=wrong`);
    socket = rejected;
    await new Promise<void>((resolve) => {
      rejected.once('error', () => resolve());
      rejected.once('close', () => resolve());
    });
    expect(server.hasOpenClients()).toBe(false);
  });
});
