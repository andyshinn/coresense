import { describe, expect, it, vi } from 'vitest';
import { buildGotoItems } from '../../../../../src/renderer/features/command-palette/items/goto';
import type { Channel, Contact, Message } from '../../../../../src/shared/types';

const ch = (name: string, over: Partial<Channel> = {}) => ({ key: `ch:${name}`, name, ...over }) as Channel;
const dm = (pk: string, over: Partial<Contact> = {}) =>
  ({ key: `c:${pk}`, publicKeyHex: pk, name: pk, kind: 'chat', ...over }) as Contact;
const msg = (key: string, id: string, ts: number, over: Partial<Message> = {}): Message => ({
  id,
  key,
  body: 'x',
  ts,
  state: 'received',
  fromPublicKeyHex: 'name:Bob',
  ...over,
});

function unreadItem(args: {
  channels: Channel[];
  contacts?: Contact[];
  messagesByKey: Record<string, Message[]>;
  lastReadByKey?: Record<string, number>;
  activeKey?: string;
  setActiveKey?: (key: string) => void;
}) {
  return buildGotoItems({
    contacts: [],
    lastReadByKey: {},
    activeKey: '',
    setActiveKey: () => {},
    close: () => {},
    ...args,
  }).find((i) => i.id === 'goto:unread');
}

describe('command palette: jump to unread', () => {
  it('does not count our own sends or blocked messages', () => {
    const item = unreadItem({
      channels: [ch('General')],
      messagesByKey: {
        'ch:General': [
          msg('ch:General', 'a', 10),
          msg('ch:General', 'mine', 20, { state: 'sent', fromPublicKeyHex: undefined }),
          msg('ch:General', 'blk', 30, { meta: { blocked: true } }),
        ],
      },
    });
    expect(item?.label).toBe('Jump to unread (1)');
  });

  it('offers nothing when the only unread messages are our own', () => {
    const item = unreadItem({
      channels: [ch('General')],
      messagesByKey: { 'ch:General': [msg('ch:General', 'mine', 20, { state: 'sent' })] },
    });
    expect(item).toBeUndefined();
  });

  it('targets the newest unread conversation, like keyboard next-unread', () => {
    const setActiveKey = vi.fn();
    const item = unreadItem({
      channels: [ch('Old'), ch('Muted', { muted: true })],
      contacts: [dm('aa')],
      messagesByKey: {
        'ch:Old': [msg('ch:Old', 'o', 10)],
        'ch:Muted': [msg('ch:Muted', 'm', 99)],
        'c:aa': [msg('c:aa', 'd', 50)],
      },
      setActiveKey,
    });
    expect(item?.label).toBe('Jump to unread (2)');
    item?.run();
    expect(setActiveKey).toHaveBeenCalledWith('c:aa');
  });

  it('skips the active conversation as a target but still counts it', () => {
    const setActiveKey = vi.fn();
    const item = unreadItem({
      channels: [ch('Old')],
      contacts: [dm('aa')],
      messagesByKey: { 'ch:Old': [msg('ch:Old', 'o', 10)], 'c:aa': [msg('c:aa', 'd', 50)] },
      activeKey: 'c:aa',
      setActiveKey,
    });
    expect(item?.label).toBe('Jump to unread (2)');
    item?.run();
    expect(setActiveKey).toHaveBeenCalledWith('ch:Old');
  });
});
