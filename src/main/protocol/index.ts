import { ProtocolSession } from './session';

let _session: ProtocolSession | null = null;

export function protocolSession(): ProtocolSession {
  if (!_session) _session = new ProtocolSession();
  return _session;
}

export { ProtocolSession } from './session';
