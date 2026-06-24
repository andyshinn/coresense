import { transportManager } from '../transport/manager';
import { SessionAdapter } from './sessionAdapter';

let _session: SessionAdapter | null = null;

export function protocolSession(): SessionAdapter {
  if (!_session) {
    _session = new SessionAdapter(transportManager.getLibTransport());
  }
  return _session;
}

/** Test seam: inject a SessionAdapter double, or pass null to drop the lazy
 *  singleton so the next protocolSession() rebuilds it. Mirrors the
 *  setAppLifecycle/setSecretStore DI seams. */
export function setProtocolSession(session: SessionAdapter | null): void {
  _session = session;
}

export { SessionAdapter } from './sessionAdapter';
