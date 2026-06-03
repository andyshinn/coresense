import { app, Notification } from 'electron';
import type { BlockMatchHints } from '../shared/blocking/match';
import { isMessageBlocked } from '../shared/blocking/match';
import { shouldFireDiscovered } from '../shared/notifications/discovered';
import type { ContactKind, Message } from '../shared/types';
import { blockingStore } from './blocking/store';
import { bus, emit } from './events/bus';
import { child } from './log';
import { stateHolder } from './state/holder';
import { getMainWindow, isMainWindowFocused } from './window/registry';

// Main-process notification router. Listens for incoming messages, applies
// the user's per-kind policy, and fires native OS notifications. Also keeps
// the macOS dock badge in sync with the per-conversation unread totals
// derived from messages + ui-state lastReadByKey.

const log = child('notify');
const isMac = process.platform === 'darwin';

// Recent message IDs we already notified on, so a re-emit of the same key's
// list (e.g. a state transition) doesn't double-fire.
const notifiedIds = new Set<string>();
const MAX_NOTIFIED_IDS = 500;

export function startNotifications(): void {
  bus.on('messages', onMessages);
  bus.on('contactDiscovered', onContactDiscovered);
  bus.on('appSettings', recomputeBadge);
  // Muting a channel/contact updates these lists; recompute so the dock badge
  // drops the now-muted conversation's unread count.
  bus.on('channels', recomputeBadge);
  bus.on('contacts', recomputeBadge);
  // The renderer pushes lastReadByKey + activeKey via PUT /api/ui-state,
  // which routes.ts emits as 'uiState'. Recompute the badge so reading a
  // conversation clears its share of the unread total.
  bus.on('uiState', recomputeBadge);
  bus.on('blockRules', recomputeBadge);
  recomputeBadge();
  log.debug('notification router started');
}

function onMessages(_key: string, list: Message[]): void {
  // Look at the last message — that's the new arrival. Older entries in the
  // list are history we've already considered.
  const last = list[list.length - 1];
  if (!last) {
    recomputeBadge();
    return;
  }
  maybeNotify(last);
  recomputeBadge();
}

function buildHintsForNotify(m: Message): BlockMatchHints {
  const holder = stateHolder();
  const originHop = m.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
  return {
    contactNameByPk: (pk) => holder.getContacts().find((c) => c.publicKeyHex === pk)?.name,
    originHopPk: originHop?.pk?.toLowerCase(),
  };
}

function maybeNotify(m: Message): void {
  if (m.state !== 'received') return;
  const rules = blockingStore().list();
  if (rules.length > 0) {
    const { blocked } = isMessageBlocked(
      m,
      buildHintsForNotify(m),
      rules,
      blockingStore().regexCacheRef(),
    );
    if (blocked) return;
  }
  if (notifiedIds.has(m.id)) return;
  notifiedIds.add(m.id);
  if (notifiedIds.size > MAX_NOTIFIED_IDS) {
    // Drop the oldest half. Set preserves insertion order so this works.
    const drop = Math.floor(MAX_NOTIFIED_IDS / 2);
    let i = 0;
    for (const id of notifiedIds) {
      if (i++ >= drop) break;
      notifiedIds.delete(id);
    }
  }

  const holder = stateHolder();
  const settings = holder.getAppSettings();
  const owner = holder.getOwner();
  const ui = holder.getUiState();

  // A muted conversation suppresses its notifications outright.
  if (isMutedKey(holder, m.key)) return;

  const policy = settings.notifications;
  const kind = classify(m, owner?.name);
  if (!policy[kind]) return;

  // Suppress when the user is already looking at this conversation in a
  // focused window — they can see the message arriving in the UI.
  if (policy.suppressWhenFocused && isMainWindowFocused() && ui.activeKey === m.key) {
    return;
  }

  const title = buildTitle(m, holder, kind);
  const body = m.body.length > 240 ? `${m.body.slice(0, 237)}…` : m.body;

  if (!Notification.isSupported()) {
    log.debug(`native notifications unavailable; skipping ${m.id}`);
    return;
  }
  const n = new Notification({
    title,
    body,
    silent: !policy.sound,
  });
  n.on('click', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    // Tell the renderer to switch active key. The handleMenuAction switch
    // already routes 'focusKey' to setActiveKey.
    emit.menuAction({ kind: 'focusKey', key: m.key });
  });
  n.show();
  log.debug(`notified kind=${kind} key=${m.key} id=${m.id}`);
}

function onContactDiscovered(c: { key: string; name: string; kind: ContactKind }): void {
  const holder = stateHolder();
  const policy = holder.getAppSettings().notifications;
  if (!shouldFireDiscovered(policy, isMainWindowFocused())) return;
  if (!Notification.isSupported()) {
    log.debug('native notifications unavailable; skipping discovered contact');
    return;
  }
  const n = new Notification({
    title: 'New contact discovered',
    body: c.name,
    silent: !policy.sound,
  });
  n.on('click', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    emit.menuAction({ kind: 'focusKey', key: c.key });
  });
  n.show();
  log.debug(`notified discovered contact ${c.key.slice(0, 14)}`);
}

type Kind = 'directMessage' | 'channelMention' | 'channelMessage' | 'repeaterAlert' | 'sensorAlert';

function classify(m: Message, ownerName: string | undefined): Kind {
  if (m.key.startsWith('c:')) {
    const contact = stateHolder()
      .getContacts()
      .find((c) => c.key === m.key);
    if (contact?.kind === 'repeater') return 'repeaterAlert';
    if (contact?.kind === 'sensor') return 'sensorAlert';
    return 'directMessage';
  }
  if (m.key.startsWith('ch:')) {
    if (ownerName && mentionsOwner(m.body, ownerName)) return 'channelMention';
    return 'channelMessage';
  }
  return 'directMessage';
}

// Mention detection: matches @name, @[name], or the bare owner name on a
// word boundary. Case-insensitive.
function mentionsOwner(body: string, ownerName: string): boolean {
  const lower = body.toLowerCase();
  const target = ownerName.toLowerCase();
  if (lower.includes(`@${target}`)) return true;
  if (lower.includes(`@[${target}]`)) return true;
  const re = new RegExp(`\\b${escapeRegExp(target)}\\b`, 'i');
  return re.test(body);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTitle(m: Message, holder: ReturnType<typeof stateHolder>, kind: Kind): string {
  if (m.key.startsWith('ch:')) {
    const ch = holder.getChannels().find((c) => c.key === m.key);
    const label = ch?.name ?? m.key.slice(3);
    return kind === 'channelMention' ? `${label} • mention` : label;
  }
  const contact = holder.getContacts().find((c) => c.key === m.key);
  return contact?.name ?? m.key;
}

// Dock badge: count of unread messages across all conversations whose
// policy is currently enabled. Cleared on macOS to '' when zero so the
// badge disappears entirely (passing 0 keeps the bubble visible).
function recomputeBadge(): void {
  if (!isMac) return;
  const holder = stateHolder();
  const settings = holder.getAppSettings();
  if (!settings.notifications.dockBadge) {
    app.setBadgeCount(0);
    return;
  }
  const ui = holder.getUiState();
  const owner = holder.getOwner();
  const policy = settings.notifications;

  const rules = blockingStore().list();
  const cache = blockingStore().regexCacheRef();

  let total = 0;
  for (const key of allConversationKeys(holder)) {
    if (isMutedKey(holder, key)) continue;
    const lastRead = ui.lastReadByKey[key] ?? 0;
    const msgs = holder.getMessagesForKey(key);
    for (const m of msgs) {
      if (m.state !== 'received') continue;
      if (m.ts <= lastRead) continue;
      if (rules.length > 0) {
        const { blocked } = isMessageBlocked(m, buildHintsForNotify(m), rules, cache);
        if (blocked) continue;
      }
      const kind = classify(m, owner?.name);
      if (policy[kind]) total += 1;
    }
  }
  app.setBadgeCount(total);
}

// True when the channel or contact behind `key` is muted. Muted conversations
// contribute no dock-badge count and fire no native notifications.
function isMutedKey(holder: ReturnType<typeof stateHolder>, key: string): boolean {
  if (key.startsWith('ch:')) {
    return holder.getChannels().some((c) => c.key === key && c.muted);
  }
  return holder.getContacts().some((c) => c.key === key && c.muted);
}

function allConversationKeys(holder: ReturnType<typeof stateHolder>): string[] {
  const keys = new Set<string>();
  for (const ch of holder.getChannels()) keys.add(ch.key);
  for (const c of holder.getContacts()) keys.add(c.key);
  return [...keys];
}
