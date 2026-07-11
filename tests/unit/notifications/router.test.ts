import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationCapabilities } from '../../../src/main/notifications/capabilities';
import type { NotificationSpec } from '../../../src/main/notifications/present';
import { createNotificationRouter, type RouterDeps } from '../../../src/main/notifications/router';
import type { AppSettings, Channel, Contact, Message, Owner, UiState } from '../../../src/shared/types';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/types';

const NOW = 1_000_000_000_000;

function harness(over: Partial<RouterDeps> = {}) {
  const shown: NotificationSpec[] = [];
  const cleared: string[] = [];
  const channels: Channel[] = [{ key: 'ch:General', name: 'General', kind: 'public' }];
  const contacts: Contact[] = [{ key: 'c:aa', publicKeyHex: 'aa', name: 'Alice', kind: 'chat' }];
  const owner: Owner = { name: 'me', publicKeyHex: 'ff', publicKeyShort: 'ff' };
  let ui: UiState = { activeKey: 'tool:packetlog', lastReadByKey: {} } as UiState;
  const settings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    notifications: { ...DEFAULT_APP_SETTINGS.notifications, channelMessage: true },
  };
  const deps: RouterDeps = {
    presenter: { isSupported: () => true, show: (s) => shown.push(s), clearGroup: (g) => cleared.push(g) },
    caps: notificationCapabilities('darwin'),
    now: () => NOW,
    isFocused: () => false,
    emitMenuAction: vi.fn(),
    actions: { reply: vi.fn(async () => {}), markRead: vi.fn(), mute: vi.fn() },
    setBadge: vi.fn(),
    config: { staleThresholdMs: 5 * 60_000, flushDelayMs: 1_000, rollupCap: 5 },
    getAppSettings: () => settings,
    getOwner: () => owner,
    getUiState: () => ui,
    getChannels: () => channels,
    getContacts: () => contacts,
    getMessagesForKey: () => [],
    isBlocked: () => false,
    ...over,
  };
  const router = createNotificationRouter(deps);
  return {
    router,
    shown,
    cleared,
    deps,
    setUi: (u: UiState) => {
      ui = u;
    },
  };
}

const chMsg = (over: Partial<Message>): Message => ({
  id: 'm1',
  key: 'ch:General',
  body: 'hi',
  ts: NOW,
  state: 'received',
  fromPublicKeyHex: 'name:Bob',
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('notification router', () => {
  it('fresh channel message → individual with sender subtitle (macOS) + deep-link click', () => {
    const h = harness();
    h.router.handleMessages('ch:General', [chMsg({})]);
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]).toMatchObject({ id: 'msg:m1', groupId: 'ch:General', title: 'General', subtitle: 'Bob', body: 'hi' });
    h.shown[0].onClick?.();
    expect(h.deps.emitMenuAction).toHaveBeenCalledWith({ kind: 'focusMessage', key: 'ch:General', messageId: 'm1' });
  });

  it('stale channel message → debounced summary, no individual', () => {
    const h = harness();
    h.router.handleMessages('ch:General', [chMsg({ id: 'm2', ts: NOW - 10 * 60_000 })]);
    expect(h.shown).toHaveLength(0);
    vi.advanceTimersByTime(1_000);
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]).toMatchObject({
      id: 'summary:ch:General',
      groupId: 'ch:General',
      title: 'General',
      body: '1 message from Bob',
    });
    h.shown[0].onClick?.();
    expect(h.deps.emitMenuAction).toHaveBeenCalledWith({ kind: 'focusFirstUnread', key: 'ch:General' });
  });

  it('summarizeBacklog=false → stale message fires individually', () => {
    const settings = {
      ...DEFAULT_APP_SETTINGS,
      notifications: { ...DEFAULT_APP_SETTINGS.notifications, channelMessage: true, summarizeBacklog: false },
    };
    const h = harness({ getAppSettings: () => settings });
    h.router.handleMessages('ch:General', [chMsg({ id: 'm3', ts: NOW - 10 * 60_000 })]);
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0].id).toBe('msg:m3');
  });

  it('dedups a re-emitted message id', () => {
    const h = harness();
    const m = chMsg({ id: 'dup' });
    h.router.handleMessages('ch:General', [m]);
    h.router.handleMessages('ch:General', [m]);
    expect(h.shown).toHaveLength(1);
  });

  it('clear-on-read clears the summary group when the conversation is opened', () => {
    const h = harness();
    h.router.handleMessages('ch:General', [chMsg({ id: 'm4', ts: NOW - 10 * 60_000 })]);
    vi.advanceTimersByTime(1_000);
    expect(h.shown).toHaveLength(1);
    const opened = { activeKey: 'ch:General', lastReadByKey: {} } as UiState;
    h.setUi(opened);
    h.router.handleUiState(opened);
    expect(h.cleared).toContain('ch:General');
  });

  it('wires reply and actions onto the spec', () => {
    const h = harness();
    h.router.handleMessages('ch:General', [chMsg({ id: 'm5' })]);
    const spec = h.shown[0];
    expect(spec.reply).toBe(true);
    expect(spec.actions).toEqual(['Mark as read', 'Mute']);
    spec.onReply?.('yo');
    expect(h.deps.actions.reply).toHaveBeenCalledWith('ch:General', 'yo');
    spec.onAction?.(0);
    expect(h.deps.actions.markRead).toHaveBeenCalledWith('ch:General');
    spec.onAction?.(1);
    expect(h.deps.actions.mute).toHaveBeenCalledWith('ch:General');
  });

  it('clears an individual notification group when its conversation is opened', () => {
    const h = harness();
    h.router.handleMessages('ch:General', [chMsg({ id: 'live1' })]);
    expect(h.shown).toHaveLength(1); // fresh → individual banner, groupId ch:General
    h.router.handleUiState({ activeKey: 'ch:General', lastReadByKey: {} } as UiState);
    expect(h.cleared).toContain('ch:General');
  });

  it('clears a conversation when its lastRead advances even if it is not the active key', () => {
    const h = harness();
    // Simulates the "Mark as read" action: lastReadByKey advances, activeKey unchanged.
    h.router.handleUiState({ activeKey: 'tool:packetlog', lastReadByKey: { 'ch:General': 5000 } } as unknown as UiState);
    expect(h.cleared).toContain('ch:General');
  });

  it('does not show a discovered-contact notification when notifications are unsupported', () => {
    const shown: NotificationSpec[] = [];
    const h = harness({
      presenter: { isSupported: () => false, show: (s) => shown.push(s), clearGroup: () => {} },
    });
    h.router.handleContactDiscovered({ key: 'c:zz', name: 'Zed', kind: 'chat' });
    expect(shown).toHaveLength(0);
  });

  it('suppresses the notification when the app is focused on that conversation', () => {
    const h = harness({ isFocused: () => true });
    h.setUi({ activeKey: 'ch:General', lastReadByKey: {} } as UiState);
    h.router.handleMessages('ch:General', [chMsg({ id: 'focused-msg' })]);
    expect(h.shown).toHaveLength(0);
  });

  it('is silent when the app is focused but on a different conversation', () => {
    const h = harness({ isFocused: () => true });
    h.setUi({ activeKey: 'c:aa', lastReadByKey: {} } as UiState);
    h.router.handleMessages('ch:General', [chMsg({ id: 'other-convo' })]);
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0].silent).toBe(true);
  });

  it('is not silent when the app is unfocused and sound is enabled', () => {
    const h = harness({ isFocused: () => false });
    h.router.handleMessages('ch:General', [chMsg({ id: 'loud-msg' })]);
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0].silent).toBe(false);
  });
});
