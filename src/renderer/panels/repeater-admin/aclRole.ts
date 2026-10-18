import type { RepeaterAclRole } from '../../../shared/types';

/** Display names for the four ACL roles the low 2 bits of a permissions byte
 *  encode. Same wording as the `setperm` argument help in the repeater CLI
 *  catalog (src/shared/repeater-cli/catalog.ts), so the ACL table, the login
 *  card and the command autocomplete all name a role identically. */
export const ACL_ROLE_LABEL: Record<RepeaterAclRole, string> = {
  guest: 'Guest',
  readOnly: 'Read-only',
  readWrite: 'Read-write',
  admin: 'Admin',
};

/** A raw permissions byte as the ACL table and login card show it: `0x03`. */
export function formatPermissions(bits: number): string {
  return `0x${bits.toString(16).padStart(2, '0')}`;
}
