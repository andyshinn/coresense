// Repeater admin: sessions, ACL, neighbours, stats, trace and telemetry.

/** Decoded admin-response surfaced to the UI. `payloadHex` is always populated
 *  so views can show raw bytes when decoding can't make sense of them; `fields`
 *  is the best-effort decode (status: well-known firmware layout; telemetry:
 *  CayenneLPP). */
export interface RepeaterStatusSnapshot {
  contactKey: string;
  receivedAt: number;
  payloadHex: string;
  fields: Array<{ name: string; value: number | string; unit?: string }>;
}

// Decoded admin-session state for a repeater contact. Lives in main-process
// memory only — admin auth is bound to the live radio connection, so reloads
// require a fresh login.
export type RepeaterAdminMode = 'local' | 'remote';

export type RepeaterAdminRole = 'admin' | 'guest';

/** ACL role, decoded from the low 2 bits of a repeater permissions byte
 *  (helpers/ClientACL.h PERM_ACL_GUEST=0/READ_ONLY=1/READ_WRITE=2/ADMIN=3).
 *  The two bits are a role VALUE, not independent flags. Declared locally
 *  rather than re-exported from meshcore-ts because this module is
 *  renderer-reachable and the library is main-process only. */
export type RepeaterAclRole = 'guest' | 'readOnly' | 'readWrite' | 'admin';

export interface RepeaterAdminSession {
  contactKey: string;
  publicKeyHex: string;
  mode: RepeaterAdminMode;
  role: RepeaterAdminRole;
  permissionsBits: number;
  aclPermissionsBits: number | null;
  /** `aclPermissionsBits` decoded. Null when the repeater's login reply carried
   *  no ACL byte (short-form PUSH_LOGIN_SUCCESS). */
  aclRole: RepeaterAclRole | null;
  firmwareVerLevel: number | null;
  loggedInAt: number;
}

export interface RepeaterLoginResult {
  permissions: number;
  pubKeyPrefixHex: string;
  serverTagHex: string | null;
  aclPermissions: number | null;
  firmwareVerLevel: number | null;
  isAdmin: boolean;
}

export interface RepeaterAclEntry {
  pubKeyPrefixHex: string;
  /** Raw permissions byte as sent by the repeater (role bits + reserved bits). */
  permissions: number;
  /** Decoded role — the authoritative reading of the low 2 bits. `isAdmin` and
   *  `isGuest` cover only two of the four roles, so read-only and read-write
   *  entries are indistinguishable through them. */
  role: RepeaterAclRole;
  isAdmin: boolean;
  isGuest: boolean;
}

export interface RepeaterNeighbour {
  pubKeyPrefixHex: string;
  heardSecsAgo: number;
  snrDb: number;
}

export interface RepeaterNeighboursPage {
  total: number;
  neighbours: RepeaterNeighbour[];
}

export interface RepeaterOwnerInfo {
  firmwareVersion: string;
  nodeName: string;
  ownerInfo: string;
}

export interface RepeaterTraceHop {
  hashHex: string;
  snrDb: number;
}

export interface RepeaterTrace {
  tagHex: string;
  authHex: string;
  flags: number;
  pathHashSize: number;
  hops: RepeaterTraceHop[];
  finalSnrDb: number;
}
