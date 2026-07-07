import { describe, expect, it, vi } from 'vitest';
import { createMenuActionHandler } from '../../src/renderer/app/menuActions';
import { useStore } from '../../src/renderer/lib/store';
import type { Message } from '../../src/shared/types';

const deps = () => ({
  baseUrl: 'http://x',
  apiKey: 'k',
  cycleThemePref: vi.fn(),
  toggleLeftNav: vi.fn(),
  toggleRightRail: vi.fn(),
  togglePin: vi.fn(),
  setActiveKey: vi.fn(),
});

const m = (id: string, ts: number): Message => ({
  id,
  key: 'ch:General',
  body: 'x',
  ts,
  state: 'received',
  fromPublicKeyHex: 'name:Bob',
});

describe('menu action jump', () => {
  it('focusMessage sets active key and pending jump to the message id', () => {
    const d = deps();
    createMenuActionHandler(d)({ kind: 'focusMessage', key: 'ch:General', messageId: 'm7' });
    expect(d.setActiveKey).toHaveBeenCalledWith('ch:General');
    expect(useStore.getState().pendingJumpMid).toBe('m7');
  });

  it('focusFirstUnread jumps to the first unread message', () => {
    const d = deps();
    useStore.getState().applyMessages('ch:General', [m('a', 10), m('b', 20), m('c', 30)]);
    useStore.getState().markRead('ch:General', 15);
    createMenuActionHandler(d)({ kind: 'focusFirstUnread', key: 'ch:General' });
    expect(d.setActiveKey).toHaveBeenCalledWith('ch:General');
    expect(useStore.getState().pendingJumpMid).toBe('b');
  });
});
