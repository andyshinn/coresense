import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above the file body, so the doubles they close
// over have to be hoisted with them.
const { refreshContacts } = vi.hoisted(() => ({ refreshContacts: vi.fn() }));

// The panel tree (ContactManager → Toolbar/ContactRows) touches the api client
// and notify at module scope; stub both so only the refresh path is live.
vi.mock('@/lib/notify', () => import('../support/notifyMock'));
vi.mock('@/lib/api', () => ({
  api: { refreshContacts, addToRadio: vi.fn(), removeFromRadio: vi.fn(), clearDiscovered: vi.fn() },
}));

import { ContactManager } from '@/panels/contacts/ContactManager';
import { TEST_CLIENT as client } from '../support/apiClient';
import { notify, resetNotifyMock } from '../support/notifyMock';
import { renderWithClient } from '../support/renderWithClient';

const button = () => screen.getByRole('button', { name: 'Refresh contacts from radio' }) as HTMLButtonElement;

beforeEach(() => {
  refreshContacts.mockReset();
  resetNotifyMock();
});

// #45 item 6: before this the only way to re-read the radio's contact store was
// to disconnect and reconnect.
describe('ContactManager refresh button', () => {
  it('asks the server to re-read the radio and reports the count', async () => {
    refreshContacts.mockResolvedValue({ ok: true, count: 42 });
    renderWithClient(<ContactManager />);

    fireEvent.click(button());

    await waitFor(() => expect(refreshContacts).toHaveBeenCalledWith(client));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Re-read 42 contacts from the radio'));
  });

  it('disables itself while the walk is in flight', async () => {
    let resolve!: (v: { ok: true; count: number }) => void;
    refreshContacts.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithClient(<ContactManager />);

    fireEvent.click(button());
    await waitFor(() => expect(button().disabled).toBe(true));

    // A second click while disabled must not queue another ~25s contact walk.
    fireEvent.click(button());
    expect(refreshContacts).toHaveBeenCalledTimes(1);

    resolve({ ok: true, count: 1 });
    await waitFor(() => expect(button().disabled).toBe(false));
  });

  it('is disabled with no server connection', () => {
    render(<ContactManager />);
    expect(button().disabled).toBe(true);
  });

  it('surfaces a failure as an error rather than a silent no-op', async () => {
    refreshContacts.mockRejectedValue(new Error('no radio attached'));
    renderWithClient(<ContactManager />);

    fireEvent.click(button());

    await waitFor(() =>
      expect(notify.failure).toHaveBeenCalledWith(
        'Contact refresh',
        expect.objectContaining({ message: 'no radio attached' }),
      ),
    );
    expect(notify.success).not.toHaveBeenCalled();
  });

  // The server answers `{ skipped: true }` when the handshake is already walking
  // the same stream; claiming "re-read 0 contacts" there would be a lie.
  it('reports a skipped refresh as info, not success', async () => {
    refreshContacts.mockResolvedValue({ ok: true, skipped: true });
    renderWithClient(<ContactManager />);

    fireEvent.click(button());

    await waitFor(() => expect(notify.info).toHaveBeenCalledWith('Radio is already syncing contacts'));
    expect(notify.success).not.toHaveBeenCalled();
  });
});
