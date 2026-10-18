// Per-repeater admin auth read-model. The library owns the login round-trip
// and the tag/prefix correlation of mesh-side replies; SessionAdapter mirrors
// each login/logout result in here so the HTTP API can report who we are
// logged in to without reaching into the session. Nothing clears it on
// transport disconnect, so a session outlives the link until logout.

import type { RepeaterAclRole } from '../../shared/types';

export type AdminMode = 'local' | 'remote';
export type AdminRole = 'admin' | 'guest';

export interface AdminSessionState {
  contactKey: string;
  publicKeyHex: string;
  mode: AdminMode;
  role: AdminRole;
  permissionsBits: number;
  aclPermissionsBits: number | null;
  /** `aclPermissionsBits` decoded into a role name; null when the login reply
   *  carried no ACL byte. Decoded in the main process because the renderer
   *  cannot import meshcore-ts. */
  aclRole: RepeaterAclRole | null;
  firmwareVerLevel: number | null;
  loggedInAt: number;
}

export class AdminSessionStore {
  private readonly sessions = new Map<string, AdminSessionState>();

  getSession(contactKey: string): AdminSessionState | null {
    return this.sessions.get(contactKey) ?? null;
  }

  setSession(state: AdminSessionState): void {
    this.sessions.set(state.contactKey, state);
  }

  clearSession(contactKey: string): void {
    this.sessions.delete(contactKey);
  }
}

export const adminSessions = new AdminSessionStore();
