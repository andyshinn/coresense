import { describe, expect, it, vi } from 'vitest';
import { type ActionDeps, createNotificationActions } from '../../../src/main/notifications/actions';
import type { Channel, Contact, UiState } from '../../../src/shared/types';

const channel = (over: Partial<Channel> = {}): Channel => ({ key: 'ch:General', name: 'General', kind: 'public', ...over });
const contact = (over: Partial<Contact> = {}): Contact => ({
  key: 'c:aa',
  publicKeyHex: 'aa',
  name: 'Alice',
  kind: 'chat',
  ...over,
});

function harness(over: Partial<ActionDeps> = {}) {
  const channels: Channel[] = [channel()];
  const contacts: Contact[] = [contact()];
  let ui: UiState = { lastReadByKey: {} } as UiState;
  const deps: ActionDeps = {
    sendMessage: vi.fn(async () => ({ ok: true })),
    getChannels: () => channels,
    getContacts: () => contacts,
    upsertChannel: (c) => {
      const i = channels.findIndex((x) => x.key === c.key);
      channels[i] = c;
    },
    upsertContact: (c) => {
      const i = contacts.findIndex((x) => x.key === c.key);
      contacts[i] = c;
    },
    emitChannels: vi.fn(),
    emitContacts: vi.fn(),
    getUiState: () => ui,
    setUiState: (u) => {
      ui = u;
    },
    emitUiState: vi.fn(),
    now: () => 5000,
    ...over,
  };
  return { actions: createNotificationActions(deps), deps, channels, contacts, getUi: () => ui };
}

describe('notification actions', () => {
  it('reply delegates to sendMessage', async () => {
    const h = harness();
    await h.actions.reply('ch:General', 'hello');
    expect(h.deps.sendMessage).toHaveBeenCalledWith('ch:General', 'hello');
  });

  it('reply ignores empty/whitespace text', async () => {
    const h = harness();
    await h.actions.reply('ch:General', '   ');
    expect(h.deps.sendMessage).not.toHaveBeenCalled();
  });

  it('markRead advances lastReadByKey and emits uiState', () => {
    const h = harness();
    h.actions.markRead('ch:General');
    expect(h.getUi().lastReadByKey['ch:General']).toBe(5000);
    expect(h.deps.emitUiState).toHaveBeenCalledWith(h.getUi());
  });

  it('mute sets the channel muted flag and emits channels', () => {
    const h = harness();
    h.actions.mute('ch:General');
    expect(h.channels[0].muted).toBe(true);
    expect(h.deps.emitChannels).toHaveBeenCalled();
  });

  it('mute sets the contact muted flag and emits contacts', () => {
    const h = harness();
    h.actions.mute('c:aa');
    expect(h.contacts[0].muted).toBe(true);
    expect(h.deps.emitContacts).toHaveBeenCalled();
  });
});
