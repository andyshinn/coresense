import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/renderer/lib/api', () => ({
  api: { checkForUpdates: vi.fn(async () => ({ ok: true, updateState: null })) },
}));

// Adjust the import + call to match the real builder export and its argument shape:
import { buildActionItems } from '../../../../../src/renderer/features/command-palette/items/actions';
import { api } from '../../../../../src/renderer/lib/api';

describe('command palette: check for updates', () => {
  it('exposes an action that calls api.checkForUpdates', () => {
    const client = { baseUrl: 'http://x', apiKey: 'k' };
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
    const action = items.find((i) => i.id === 'action:checkForUpdates');
    expect(action).toBeTruthy();
    action?.run();
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
