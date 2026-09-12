import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The four ACL roles the repeater can report. Before meshcore-ts 0.8.0 the
// library derived isAdmin/isGuest from individual bits of the permissions byte,
// which mislabelled read-only as admin and read-write as guest; the low 2 bits
// are a role VALUE, and `role` is now the authoritative decode.
const entries = [
  { pubKeyPrefixHex: '010101010101', permissions: 0x00, role: 'guest' as const, isAdmin: false, isGuest: true },
  { pubKeyPrefixHex: '020202020202', permissions: 0x01, role: 'readOnly' as const, isAdmin: false, isGuest: false },
  { pubKeyPrefixHex: '030303030303', permissions: 0x02, role: 'readWrite' as const, isAdmin: false, isGuest: false },
  { pubKeyPrefixHex: '040404040404', permissions: 0x03, role: 'admin' as const, isAdmin: true, isGuest: false },
];

const repeaterAcl = vi.fn(async () => ({ ok: true as const, entries }));

vi.mock('../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/renderer/lib/api', () => ({
  api: { repeaterAcl: () => repeaterAcl() },
}));

import { AclTab } from '../../src/renderer/panels/repeater-admin/AclTab';
import type { Contact } from '../../src/shared/types';

const client = { baseUrl: 'http://x', apiKey: 'k' };
const repeater: Contact = {
  key: `c:${'aa'.repeat(32)}`,
  publicKeyHex: 'aa'.repeat(32),
  name: 'Repeater A',
  kind: 'repeater',
};

describe('AclTab — role column', () => {
  it('names all four roles, including the two isAdmin/isGuest cannot express', async () => {
    render(<AclTab contact={repeater} client={client} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Refresh ACL/i }));
    await waitFor(() => expect(repeaterAcl).toHaveBeenCalled());

    const cells = await screen.findAllByRole('cell');
    const roles = cells.filter((_, i) => i % 3 === 2).map((c) => c.textContent);
    expect(roles).toEqual(['Guest', 'Read-only', 'Read-write', 'Admin']);
    // The raw byte stays alongside it — the only place reserved bits above the
    // 2-bit role mask are visible.
    expect(cells.filter((_, i) => i % 3 === 1).map((c) => c.textContent)).toEqual(['0x00', '0x01', '0x02', '0x03']);
  });
});
