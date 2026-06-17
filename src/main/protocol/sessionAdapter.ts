import { MeshCoreSession, type Transport } from '@andyshinn/meshcore-ts';
import { wireSessionEvents } from './adapterEvents';

const APP_NAME = 'coresense';
const APP_VERSION = 1;

/** Owns a MeshCoreSession and bridges its events into coresense's persistence
 *  + bus, and its command methods to the API layer. Replaces ProtocolSession. */
export class SessionAdapter {
  readonly session: MeshCoreSession;
  private started = false;

  constructor(transport: Transport) {
    this.session = new MeshCoreSession({ transport, appName: APP_NAME, appVersion: APP_VERSION });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    wireSessionEvents(this.session);
    this.session.start();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.session.stop();
  }
}
