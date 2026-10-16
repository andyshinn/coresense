import { startServer } from '../../src/main/server';
import { stubBridge } from './api';
import { deferTeardown } from './teardown';

export type TestServer = Awaited<ReturnType<typeof startServer>>;

/** The real HTTP + WS server on an ephemeral loopback port, with a stub bridge.
 *  It owns coresense's transportState subscriber (src/main/server.ts's
 *  `onTransportState`), which is a closure rather than an export, so booting
 *  it is the only way to assert on that handler. The integration project's
 *  global afterEach closes it; a test that closes it itself may, once. */
export async function bootTestServer(rendererDir: string | null = null): Promise<TestServer> {
  const server = await startServer(rendererDir, stubBridge(), { port: 0, bindAddress: '127.0.0.1' });
  let closed: Promise<void> | null = null;
  const close = () => {
    closed ??= server.close();
    return closed;
  };
  deferTeardown(close);
  return { ...server, close };
}
