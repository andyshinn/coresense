import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// LoginTab calls api.repeaterLogin and notify on submit — stub both.
const repeaterLogin = vi.fn(async (_c: unknown, _key: string, _password: string) => ({
  ok: true as const,
  session: {
    contactKey: 'c:x',
    role: 'guest' as const,
    mode: 'remote' as const,
    permissionsBits: 0,
    aclPermissionsBits: null,
    firmwareVerLevel: null,
    loggedInAt: 1_700_000_000_000,
  },
  login: { effective: 'flood' as const },
}));

vi.mock('../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/renderer/lib/api', () => ({
  api: { repeaterLogin: (...a: unknown[]) => repeaterLogin(...(a as Parameters<typeof repeaterLogin>)) },
}));

import { LoginTab } from '../../src/renderer/panels/repeater-admin/LoginTab';
import type { Contact } from '../../src/shared/types';

const client = { baseUrl: 'http://x', apiKey: 'k' };
// A flood-routed repeater (no out_path yet) — the case the guest login bootstraps.
const floodRepeater: Contact = {
  key: `c:${'aa'.repeat(32)}`,
  publicKeyHex: 'aa'.repeat(32),
  name: 'Repeater A',
  kind: 'repeater',
  outPathHex: undefined,
};

afterEach(() => repeaterLogin.mockClear());

describe('LoginTab — guest (empty-password) login', () => {
  it('leaves the login button enabled with a blank password', () => {
    render(<LoginTab contact={floodRepeater} client={client} session={null} onSession={() => {}} />);
    const button = screen.getByRole('button', { name: /Log In/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('submits an empty password as a guest login', async () => {
    render(<LoginTab contact={floodRepeater} client={client} session={null} onSession={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Log In/i }));
    await waitFor(() => expect(repeaterLogin).toHaveBeenCalledTimes(1));
    expect(repeaterLogin).toHaveBeenCalledWith(client, floodRepeater.key, '');
  });

  it('labels the button as a guest login while the password is blank', () => {
    render(<LoginTab contact={floodRepeater} client={client} session={null} onSession={() => {}} />);
    expect(screen.getByRole('button', { name: /Guest/i })).toBeTruthy();
  });
});
