import { transportManager } from '../transport/manager';
import { SessionAdapter } from './sessionAdapter';

let _session: SessionAdapter | null = null;

export function protocolSession(): SessionAdapter {
  if (!_session) {
    _session = new SessionAdapter(transportManager.getLibTransport());
  }
  return _session;
}

export { SessionAdapter } from './sessionAdapter';
