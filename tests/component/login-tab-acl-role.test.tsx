import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// LoginTab imports notify + api at module scope; stub both so mounting is inert.
vi.mock('../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/renderer/lib/api', () => ({
  api: { repeaterLogin: vi.fn() },
}));

import { LoginTab } from '../../src/renderer/panels/repeater-admin/LoginTab';
import type { Contact, RepeaterAdminSession } from '../../src/shared/types';

const client = { baseUrl: 'http://x', apiKey: 'k' };
const repeater: Contact = {
  key: `c:${'aa'.repeat(32)}`,
  publicKeyHex: 'aa'.repeat(32),
  name: 'Repeater A',
  kind: 'repeater',
};

const session = (over: Partial<RepeaterAdminSession>): RepeaterAdminSession => ({
  contactKey: repeater.key,
  publicKeyHex: repeater.publicKeyHex,
  mode: 'remote',
  role: 'admin',
  permissionsBits: 1,
  aclPermissionsBits: 2,
  aclRole: 'readWrite',
  firmwareVerLevel: 1,
  loggedInAt: 1_700_000_000_000,
  ...over,
});

describe('LoginTab — ACL permissions', () => {
  it('names the role the repeater actually enforces alongside the raw byte', () => {
    render(<LoginTab contact={repeater} client={client} session={session({})} onSession={() => {}} />);
    // `role` above is the login reply's isAdmin boolean; the ACL byte is the
    // one with the 2-bit role value in it, and "Read-write" is a role neither
    // isAdmin nor isGuest can express.
    expect(screen.getByText(/0x02/).textContent).toContain('Read-write');
  });

  it('shows the raw byte alone when the login reply carried no ACL byte', () => {
    render(
      <LoginTab
        contact={repeater}
        client={client}
        session={session({ aclPermissionsBits: 3, aclRole: null })}
        onSession={() => {}}
      />,
    );
    expect(screen.getByText(/0x03/).textContent).not.toContain('Admin');
  });
});
