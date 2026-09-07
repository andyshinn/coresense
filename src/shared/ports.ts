// Guards against CoreSense taking its own HTTP/WS port for something else.
//
// The TCP proxy port is user-editable, and the bridge binds it *before* the
// HTTP server binds its own fixed port. Nothing walks to a free port any more
// (see src/main/http-port.ts), so a proxy port set to the HTTP port used to
// mean: the bridge binds it, the API server then fails, and bootstrap quits
// before a window exists — leaving no UI to undo the setting in. The app could
// permanently brick its own boot from a valid-looking number in a settings
// field.
//
// Lives in shared/ so the same rule is enforced in three places: the settings
// API (rejects the value), the Proxy panel (warns before saving), and boot
// (refuses to bind the TCP listener rather than losing the whole app).

/** Lowest/highest port a user may configure. 0 ("any free port") is not useful
 *  for a listener clients have to find, so it is rejected too. */
const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * Why this proxy port is unusable, or `null` if it is fine.
 *
 * Only the app's *own* HTTP port is treated as a conflict. A prod install
 * configured onto the dev HTTP port (or vice versa) is the user's call — it
 * only collides if they run both at once, and that raises a real EADDRINUSE
 * the bridge reports on its own.
 *
 * The returned string is shown to the user verbatim, in a 400 from the
 * settings API and in the Proxy settings panel.
 */
export function checkProxyPort(proxyPort: number, httpPort: number): string | null {
  if (!Number.isInteger(proxyPort) || proxyPort < MIN_PORT || proxyPort > MAX_PORT) {
    return `TCP proxy port must be a whole number between ${MIN_PORT} and ${MAX_PORT} (got ${proxyPort}).`;
  }
  if (proxyPort === httpPort) {
    return (
      `TCP proxy port ${proxyPort} is already used by CoreSense's own API server, which the app ` +
      'needs in order to run. Choose a different port.'
    );
  }
  return null;
}

export interface BridgeBindingPlan {
  /** Whether the bridge should bind its TCP listener at all. */
  enableTcp: boolean;
  /** Human-readable reason the listener is off, or `null` when it is fine. */
  conflict: string | null;
}

/**
 * Decide whether boot may bind the TCP proxy listener.
 *
 * On conflict the *listener* is dropped, not the app: the HTTP server is what
 * the window talks to, so keeping it alive leaves the user a running app in
 * which they can see the reason (it rides along in BridgeStatus) and fix the
 * port. Killing the app instead would be unrecoverable without hand-editing
 * app-settings.json.
 */
export function planBridgeBinding(proxy: { enabled: boolean; port: number }, httpPort: number): BridgeBindingPlan {
  if (!proxy.enabled) return { enableTcp: false, conflict: null };
  const conflict = checkProxyPort(proxy.port, httpPort);
  return { enableTcp: conflict === null, conflict };
}
