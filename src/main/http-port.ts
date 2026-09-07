// Which TCP port the local HTTP/WS server binds.
//
// Kept in its own electron-free, dependency-free module so it can be unit
// tested: src/main/server.ts drags in hono, ws and the whole route tree, and
// src/main/index.ts touches electron at module scope, so neither is loadable
// from vitest.
//
// The port is FIXED. There is no probing and no walk to the next free port: a
// server that quietly relocates is a server nothing can find, and on macOS a
// relocation was how a test run ended up answering for the installed app
// (issue #21). A bind failure is a startup failure.
//
// The four ports the app claims are all even and at least 2 apart, so no
// default can ever land on another's:
//
//   7654  HTTP/WS  installed      7656  bridge TCP  installed
//   7754  HTTP/WS  dev            7756  bridge TCP  dev
//
// (The bridge halves live in src/shared/types.ts, since the renderer shows
// them in the Proxy settings panel.)

/** Port an installed (packaged) instance claims. */
export const DEFAULT_HTTP_PORT_PROD = 7654;
/** Port a dev instance claims, so it never fights the installed app. */
export const DEFAULT_HTTP_PORT_DEV = 7754;
/** Explicit override. `0` asks the OS for an ephemeral port. */
export const HTTP_PORT_ENV = 'CORESENSE_HTTP_PORT';

/**
 * Resolve the port the HTTP/WS server binds.
 *
 * `CORESENSE_HTTP_PORT` wins over the dev/prod default; a malformed or
 * out-of-range value is ignored (falling back to the default) rather than
 * failing the boot. `0` requests an OS-assigned ephemeral port — which is what
 * tests/e2e/support/launch.ts sets, so a test run can never claim the port an
 * installed app is serving on.
 */
export function resolveHttpPort(env: NodeJS.ProcessEnv, dev: boolean): number {
  const raw = env[HTTP_PORT_ENV]?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const port = Number(raw);
    if (port <= 65535) return port;
  }
  return dev ? DEFAULT_HTTP_PORT_DEV : DEFAULT_HTTP_PORT_PROD;
}
