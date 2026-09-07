import { type AddressInfo, createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { listenOnPort, portInUseError } from '../../../src/main/http-listen';
import { DEFAULT_HTTP_PORT_DEV, DEFAULT_HTTP_PORT_PROD } from '../../../src/main/http-port';
import { planBridgeBinding } from '../../../src/shared/ports';
import { BRIDGE_DEFAULT_TCP_PORT, BRIDGE_DEFAULT_TCP_PORT_DEV } from '../../../src/shared/types';

const HOST = '127.0.0.1';
const ok = () => new Response('ok');

const open: Array<{ close: (cb?: () => void) => void }> = [];

function track<T extends { close: (cb?: () => void) => void }>(server: T): T {
  open.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe('listenOnPort', () => {
  it('binds the exact port it was given', async () => {
    let bound = -1;
    // Take an ephemeral port first, note it, release it, then ask for it back.
    const probe = await listenOnPort(ok, 0, HOST, (p) => {
      bound = p;
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    expect(bound).toBeGreaterThan(0);

    let rebound = -1;
    track(
      await listenOnPort(ok, bound, HOST, (p) => {
        rebound = p;
      }),
    );
    expect(rebound).toBe(bound);
  });

  it('reports the OS-assigned port when asked for 0', async () => {
    let bound = -1;
    const server = track(
      await listenOnPort(ok, 0, HOST, (p) => {
        bound = p;
      }),
    );
    expect(bound).toBeGreaterThan(0);
    expect((server.address() as AddressInfo).port).toBe(bound);
  });

  it('rejects on a busy port instead of relocating to the next one', async () => {
    // The regression guard for issue #21. The old listener walked port+1 up to
    // 50 times, which is how a dev/test instance ended up answering on a port
    // some other CoreSense's clients were pointed at.
    let busy = -1;
    track(
      await listenOnPort(ok, 0, HOST, (p) => {
        busy = p;
      }),
    );

    let relocatedTo: number | null = null;
    await expect(
      listenOnPort(ok, busy, HOST, (p) => {
        relocatedTo = p;
      }),
    ).rejects.toThrow(/already in use/i);
    expect(relocatedTo).toBeNull();

    // And nothing was left listening on the port a walk would have taken.
    let neighbour = -1;
    track(
      await listenOnPort(ok, busy + 1, HOST, (p) => {
        neighbour = p;
      }),
    );
    expect(neighbour).toBe(busy + 1);
  });

  it('names the port and the remedy in the collision error', async () => {
    let busy = -1;
    track(
      await listenOnPort(ok, 0, HOST, (p) => {
        busy = p;
      }),
    );
    const err = await listenOnPort(ok, busy, HOST, () => {}).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('PortInUseError');
    expect((err as Error).message).toContain(String(busy));
    expect((err as Error).message).toContain('CORESENSE_HTTP_PORT');
    // The original errno error is preserved for the log/bug report.
    expect(((err as Error).cause as NodeJS.ErrnoException).code).toBe('EADDRINUSE');
  });
});

describe('portInUseError', () => {
  const RESERVED = [DEFAULT_HTTP_PORT_PROD, DEFAULT_HTTP_PORT_DEV, BRIDGE_DEFAULT_TCP_PORT, BRIDGE_DEFAULT_TCP_PORT_DEV];

  it('names the port that failed', () => {
    expect(portInUseError(new Error('boom'), 7654, '127.0.0.1').message).toContain('7654');
  });

  it.each([...RESERVED, 8654, 1, 65535])('never steers onto a reserved port (from %i)', (failed) => {
    // `port + 100` used to be the hint, which sent a prod collision on 7654
    // straight at 7754 — the port this app reserves for a dev instance.
    const match = /CORESENSE_HTTP_PORT=(\d+)/.exec(portInUseError(new Error('boom'), failed, '127.0.0.1').message);
    expect(match).not.toBeNull();
    const suggested = Number(match?.[1]);
    expect(RESERVED).not.toContain(suggested);
    expect(suggested).not.toBe(failed);
  });

  it('does not confidently misdiagnose the cause', () => {
    // The self-collision case (this app's own TCP proxy holding the port) is
    // one of several, so the text must hedge rather than assert.
    const msg = portInUseError(new Error('boom'), 7654, '127.0.0.1').message;
    expect(msg).toMatch(/commonly|likely|often|possibly/i);
    expect(msg).not.toMatch(/is already running/i);
  });
});

// The TCP proxy port is user-editable and the bridge binds it BEFORE the HTTP
// server binds its own. With no walk to a free port, a proxy port set to the
// HTTP port would leave the API server unable to start — and bootstrap quits
// before a window exists, so the setting could only be undone by hand-editing
// app-settings.json. These two tests pin the guard and prove it is what saves
// the boot, using the real listener against real sockets.
describe('boot with a proxy port equal to the HTTP port', () => {
  async function freePort(): Promise<number> {
    let port = -1;
    const probe = await listenOnPort(ok, 0, HOST, (p) => {
      port = p;
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  }

  function bindRaw(port: number): Promise<Server> {
    return new Promise((resolve) => {
      const server = track(createServer());
      server.listen(port, HOST, () => resolve(server));
    });
  }

  it('does not bind the listener, so the app still boots', async () => {
    const httpPort = await freePort();
    const plan = planBridgeBinding({ enabled: true, port: httpPort }, httpPort);
    expect(plan.conflict).not.toBeNull();

    // bootstrap: the bridge goes first, but only when the plan allows it.
    if (plan.enableTcp) await bindRaw(httpPort);

    let bound = -1;
    track(
      await listenOnPort(ok, httpPort, HOST, (p) => {
        bound = p;
      }),
    );
    expect(bound).toBe(httpPort);
  });

  it('would be fatal without the guard', async () => {
    // Same sequence with the plan ignored — this is what the app did before the
    // guard, and the rejection here is the app quitting with no window.
    const httpPort = await freePort();
    await bindRaw(httpPort);
    await expect(listenOnPort(ok, httpPort, HOST, () => {})).rejects.toThrow(/already in use/i);
  });
});
