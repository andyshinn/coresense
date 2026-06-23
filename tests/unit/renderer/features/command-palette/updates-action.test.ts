import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/renderer/lib/api', () => ({
  api: { checkForUpdates: vi.fn(async () => ({ ok: true, updateState: null })) },
}));
vi.mock('../../../../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { buildActionItems } from '../../../../../src/renderer/features/command-palette/items/actions';
import { api } from '../../../../../src/renderer/lib/api';
import { notify } from '../../../../../src/renderer/lib/notify';

const client = { baseUrl: 'http://x', apiKey: 'k' };

function checkForUpdatesAction() {
  const items = buildActionItems({
    client,
    close: () => {},
    cycleThemePref: () => {},
    toggleLeftNav: () => {},
    toggleRightRail: () => {},
    togglePin: () => {},
    setActiveKey: () => {},
    setAddChannelOpen: () => {},
    markAllRead: () => {},
    markAllReadGlobal: () => {},
    clearPackets: () => {},
    lastDevice: null,
    transportState: 'idle' as const,
    owner: null,
    packets: [],
    activeKey: '',
    activeContact: undefined,
  });
  return items.find((i) => i.id === 'action:checkForUpdates');
}

describe('command palette: check for updates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes an action that calls api.checkForUpdates', () => {
    const action = checkForUpdatesAction();
    expect(action).toBeTruthy();
    action?.run();
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error toast when the check returns a 200 with an error state', async () => {
    (api.checkForUpdates as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      updateState: {
        status: 'error',
        error: 'GitHub API 503',
        mode: 'notify',
        channel: 'development',
        currentVersion: '0.0.10',
      },
    });
    checkForUpdatesAction()?.run();
    await vi.waitFor(() => expect(notify.error).toHaveBeenCalledWith('GitHub API 503'));
  });
});
