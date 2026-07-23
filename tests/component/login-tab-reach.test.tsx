import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// LoginTab imports notify + api at module scope; stub both so mounting is inert.
vi.mock('../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/renderer/lib/api', () => ({
  api: { repeaterLogin: vi.fn() },
}));

import { LoginTab } from '../../src/renderer/panels/repeater-admin/LoginTab';
import type { Contact } from '../../src/shared/types';

const client = { baseUrl: 'http://x', apiKey: 'k' };

function repeater(overrides: Partial<Contact>): Contact {
  return {
    key: `c:${'aa'.repeat(32)}`,
    publicKeyHex: 'aa'.repeat(32),
    name: 'Repeater A',
    kind: 'repeater',
    ...overrides,
  };
}

// Type a non-blank password so the label drops the "as Guest" prefix and we can
// assert the reach suffix against the exact "Log In · <reach>" form.
function typePassword() {
  fireEvent.change(screen.getByPlaceholderText(/Password/i), { target: { value: 'secret' } });
}

describe('LoginTab — reach label mirrors meshcore_py effective', () => {
  it('labels a known 0-hop route as Direct', () => {
    render(<LoginTab contact={repeater({ hops: 0 })} client={client} session={null} onSession={() => {}} />);
    typePassword();
    expect(screen.getByRole('button', { name: 'Log In · Direct' })).toBeTruthy();
  });

  it('labels an unknown out_path (hops undefined) as Flood', () => {
    render(<LoginTab contact={repeater({ hops: undefined })} client={client} session={null} onSession={() => {}} />);
    typePassword();
    expect(screen.getByRole('button', { name: 'Log In · Flood' })).toBeTruthy();
  });
});
