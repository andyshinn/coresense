// Which TCP port the local HTTP/WS server should claim.
//
// Kept in its own electron-free, dependency-free module so it can be unit
// tested: src/main/server.ts drags in hono, ws and the whole route tree, and
// src/main/index.ts touches electron at module scope, so neither is loadable
// from vitest.

/** Port an installed (packaged) instance claims. */
export const DEFAULT_HTTP_PORT_PROD = 7654;
/** Port a dev instance claims, so it never fights the installed app. */
export const DEFAULT_HTTP_PORT_DEV = 7754;
/** Explicit override. `0` asks the OS for an ephemeral port. */
export const HTTP_PORT_ENV = 'CORESENSE_HTTP_PORT';

export interface ResolvedHttpPort {
  /** Port to bind. `0` means "any free port, chosen by the OS". */
  port: number;
  /**
   * Whether a bind collision may silently relocate the server to the next
   * free port. An explicitly requested port is a contract, not a hint: the
   * caller asked for *that* port, so a collision must surface rather than
   * leave the server answering somewhere nobody is looking.
   */
  allowFallback: boolean;
}

/**
 * Resolve the port the HTTP/WS server should start on.
 *
 * `CORESENSE_HTTP_PORT` wins over the dev/prod default; a malformed or
 * out-of-range value is ignored (falling back to the default) rather than
 * failing the boot. See issue #21 — the e2e harness sets it to `0` so a test
 * run can never claim the port an installed app is serving on.
 */
export function resolveHttpPort(env: NodeJS.ProcessEnv, dev: boolean): ResolvedHttpPort {
  const raw = env[HTTP_PORT_ENV]?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const port = Number(raw);
    if (port <= 65535) return { port, allowFallback: false };
  }
  return { port: dev ? DEFAULT_HTTP_PORT_DEV : DEFAULT_HTTP_PORT_PROD, allowFallback: true };
}
