// Where the renderer should look for its API server.
//
// Pure so it can be unit tested without mounting <App/>: it takes the preload's
// injected port and the window's location rather than reading globals.

/** The installed app's well-known port. Only ever a guess. */
export const FALLBACK_BASE_URL = 'http://127.0.0.1:7654';

export interface BaseUrlPlan {
  /** The base URL to probe first. */
  candidate: string;
  /**
   * A second base URL to try if the candidate probe fails, or `null` when
   * retrying would be unsafe or pointless.
   */
  fallback: string | null;
}

/**
 * Decide which base URL(s) the capabilities probe may try.
 *
 * A first-party Electron window is handed its own server's port by the preload.
 * That window must never fall back to the well-known port: anything answering
 * there is a *different* CoreSense instance, with a different API key and a
 * different database, and silently attaching to it would point the snapshot,
 * the WS stream and every mutating call at the wrong app (issue #21). Surfacing
 * the error is the correct outcome.
 */
export function resolveBaseUrl(
  injectedPort: number | null | undefined,
  location: { protocol: string; host: string },
): BaseUrlPlan {
  if (injectedPort) return { candidate: `http://127.0.0.1:${injectedPort}`, fallback: null };

  // A browser tab serving the web bundle: the server is its own origin.
  const candidate = location.protocol.startsWith('http')
    ? `${location.protocol}//${location.host}`
    : // file:// (or anything else with no usable origin) — guess.
      FALLBACK_BASE_URL;
  return { candidate, fallback: candidate === FALLBACK_BASE_URL ? null : FALLBACK_BASE_URL };
}
