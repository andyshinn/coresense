import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: { disconnect: vi.fn(async () => ({ ok: true })) },
}));
vi.mock('../../src/renderer/lib/notify', () => import('../support/notifyMock'));

import { createMenuActionHandler } from '../../src/renderer/app/menuActions';
import { api } from '../../src/renderer/lib/api';
import { setApiClient } from '../../src/renderer/lib/apiClientContext';
import { useStore } from '../../src/renderer/lib/store';
import { TEST_CLIENT } from '../support/apiClient';
import { notify } from '../support/notifyMock';

const deps = () => ({
  cycleThemePref: vi.fn(),
  toggleLeftNav: vi.fn(),
  toggleRightRail: vi.fn(),
  togglePin: vi.fn(),
  setActiveKey: vi.fn(),
});

// File > New Channel / Add Contact / Disconnect Radio used to fall through the
// handler's `default: break` and do nothing.
describe('File menu actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ addChannelOpen: false, transportState: 'idle' });
    // App's ApiClientProvider mirrors its client into this holder.
    setApiClient(TEST_CLIENT);
  });

  it('newChannel opens the add-channel popover when a radio is connected', () => {
    useStore.setState({ transportState: 'connected' });
    createMenuActionHandler(deps())({ kind: 'newChannel' });
    expect(useStore.getState().addChannelOpen).toBe(true);
  });

  it('newChannel asks for a radio instead of opening without one', () => {
    createMenuActionHandler(deps())({ kind: 'newChannel' });
    expect(useStore.getState().addChannelOpen).toBe(false);
    expect(notify.info).toHaveBeenCalledWith('Connect a radio first');
  });

  it('addContact opens the contact management tool', () => {
    const d = deps();
    createMenuActionHandler(d)({ kind: 'addContact' });
    expect(d.setActiveKey).toHaveBeenCalledWith('tool:contacts');
  });

  it('disconnect asks main to drop the radio', () => {
    createMenuActionHandler(deps())({ kind: 'disconnect' });
    expect(api.disconnect).toHaveBeenCalledWith(TEST_CLIENT);
  });

  it('disconnect does nothing before a client exists', () => {
    setApiClient(null);
    createMenuActionHandler(deps())({ kind: 'disconnect' });
    expect(api.disconnect).not.toHaveBeenCalled();
  });

  it('reads the client when the action runs, not when the handler is built', () => {
    setApiClient(null);
    const handle = createMenuActionHandler(deps());
    const later = { baseUrl: 'http://y', apiKey: 'k2' };
    setApiClient(later);
    handle({ kind: 'disconnect' });
    expect(api.disconnect).toHaveBeenCalledWith(later);
  });

  it('disconnect reports a failure', async () => {
    const err = new Error('busy');
    vi.mocked(api.disconnect).mockRejectedValueOnce(err);
    createMenuActionHandler(deps())({ kind: 'disconnect' });
    await vi.waitFor(() => expect(notify.failure).toHaveBeenCalledWith('Disconnect', err));
  });
});
