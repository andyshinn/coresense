import { type ServerType, serve } from '@hono/node-server';
import { HTTP_PORT_ENV } from './http-port';

// Binding the HTTP/WS server. Split out of server.ts — which drags in hono's
// route tree, ws, and electron-touching state modules — so the "bind the port
// we asked for, or fail" contract can be tested against real sockets.

type FetchHandler = Parameters<typeof serve>[0]['fetch'];

/**
 * Bind the requested port, or fail.
 *
 * Deliberately has no fallback: a server that relocates to another port is a
 * server no client can find, and relocation is how a dev/test instance came to
 * answer for the installed app on macOS (issue #21). A busy port means another
 * CoreSense is already running, which is what the user needs to be told.
 *
 * Port `0` asks the OS for an ephemeral port; `onBound` receives whichever
 * port was actually bound.
 */
export function listenOnPort(
  fetch: FetchHandler,
  port: number,
  hostname: string,
  onBound: (port: number) => void,
): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, port, hostname }, (info) => {
      // With port 0 the OS picks; info.port carries the real bound port.
      onBound(info.port);
      resolve(server);
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'EADDRINUSE' ? portInUseError(err, port, hostname) : err);
    });
  });
}

/**
 * Replace the bare `listen EADDRINUSE 127.0.0.1:7654` with something a user can
 * act on. This message is the only explanation they get: the failure happens
 * before the window exists, so bootstrap can only show it and quit.
 */
export function portInUseError(cause: Error, port: number, hostname: string): Error {
  const err = new Error(
    `Port ${port} on ${hostname} is already in use, so the CoreSense API server could not start. ` +
      'Another copy of CoreSense is most likely already running — quit it and try again. ' +
      `To use a different port, set ${HTTP_PORT_ENV} (e.g. ${HTTP_PORT_ENV}=${port + 100}).`,
    { cause },
  );
  err.name = 'PortInUseError';
  return err;
}
