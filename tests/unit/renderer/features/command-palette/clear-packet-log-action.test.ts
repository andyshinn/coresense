import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/renderer/lib/api', () => ({
  api: { clearPackets: vi.fn(async () => ({ ok: true })) },
}));
vi.mock('../../../../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { buildActionItems } from '../../../../../src/renderer/features/command-palette/items/actions';
import { api } from '../../../../../src/renderer/lib/api';
import { notify } from '../../../../../src/renderer/lib/notify';

const client = { baseUrl: 'http://x', apiKey: 'k' };

function clearPacketLogAction(clearPackets: () => void) {
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
    clearPackets,
    lastDevice: null,
    transportState: 'idle' as const,
    owner: null,
    packets: [],
    activeKey: '',
    activeContact: undefined,
  });
  return items.find((i) => i.id === 'action:clearPacketLog');
}

describe('command palette: clear packet log', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clears the live buffer and calls api.clearPackets to clear the DB', () => {
    const clearPackets = vi.fn();
    const action = clearPacketLogAction(clearPackets);
    expect(action).toBeTruthy();
    action?.run();
    expect(clearPackets).toHaveBeenCalledTimes(1);
    expect(api.clearPackets).toHaveBeenCalledTimes(1);
    expect(api.clearPackets).toHaveBeenCalledWith(client);
    expect(notify.success).toHaveBeenCalledWith('Packet log cleared');
  });
});
