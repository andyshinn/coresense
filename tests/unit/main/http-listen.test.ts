import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { listenOnPort, portInUseError } from '../../../src/main/http-listen';

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
  it('suggests a port that is not the one that failed', () => {
    const msg = portInUseError(new Error('boom'), 7654, '127.0.0.1').message;
    expect(msg).toContain('7654');
    expect(msg).toContain('CORESENSE_HTTP_PORT=7754');
    expect(msg).toMatch(/another copy of coresense/i);
  });
});
