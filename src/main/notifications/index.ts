import { app } from 'electron';
import { isMessageBlocked } from '../../shared/blocking/match';
import { shouldFireDiscovered } from '../../shared/notifications/discovered';
import type { ContactKind, Message, UiState } from '../../shared/types';
import { blockingStore } from '../blocking/store';
import { bus, emit } from '../events/bus';
import { child } from '../log';
import { sendMessage } from '../messaging/sendMessage';
import { stateHolder } from '../state/holder';
import { getMainWindow, isMainWindowFocused } from '../window/registry';
import { createNotificationActions } from './actions';
import { subscribeBadgeRecompute } from './badge';
import { notificationCapabilities } from './capabilities';
import { ROLLUP_CAP, STALE_THRESHOLD_MS, SUMMARY_FLUSH_MS } from './config';
import { electronPresenter } from './present';
import { createNotificationRouter } from './router';

const log = child('notify');

function isBlockedNow(m: Message): boolean {
  const rules = blockingStore().list();
  if (rules.length === 0) return false;
  const holder = stateHolder();
  const originHop = m.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
  const { blocked } = isMessageBlocked(
    m,
    {
      contactNameByPk: (pk) => holder.getContacts().find((c) => c.publicKeyHex === pk)?.name,
      originHopPk: originHop?.pk?.toLowerCase(),
    },
    rules,
    blockingStore().regexCacheRef(),
  );
  return blocked;
}

export function startNotifications(): void {
  const platform = process.platform;
  const caps = notificationCapabilities(platform);
  const isMac = platform === 'darwin';

  const presenter = electronPresenter({
    caps,
    focusWindow: () => {
      const win = getMainWindow();
      if (!win) {
        log.debug('focusWindow: no main window registered');
        return;
      }
      if (win.isMinimized()) win.restore();
      win.focus();
    },
    debug: (message) => log.debug(message),
  });

  const actions = createNotificationActions({
    sendMessage,
    getChannels: () => stateHolder().getChannels(),
    getContacts: () => stateHolder().getContacts(),
    upsertChannel: (c) => stateHolder().upsertChannel(c),
    upsertContact: (c) => stateHolder().upsertContact(c),
    emitChannels: () => emit.channels(stateHolder().getChannels()),
    emitContacts: () => emit.contacts(stateHolder().getContacts()),
    getUiState: () => stateHolder().getUiState(),
    setUiState: (u) => stateHolder().setUiState(u),
    emitUiState: (u) => emit.uiState(u),
    now: () => Date.now(),
  });

  const router = createNotificationRouter({
    presenter,
    caps,
    now: () => Date.now(),
    isFocused: isMainWindowFocused,
    emitMenuAction: (a) => emit.menuAction(a),
    actions,
    setBadge: (n) => {
      if (isMac) app.setBadgeCount(n);
    },
    config: { staleThresholdMs: STALE_THRESHOLD_MS, flushDelayMs: SUMMARY_FLUSH_MS, rollupCap: ROLLUP_CAP },
    getAppSettings: () => stateHolder().getAppSettings(),
    getOwner: () => stateHolder().getOwner(),
    getUiState: () => stateHolder().getUiState(),
    getChannels: () => stateHolder().getChannels(),
    getContacts: () => stateHolder().getContacts(),
    getMessagesForKey: (key) => stateHolder().getMessagesForKey(key),
    isBlocked: isBlockedNow,
    debug: (message) => log.debug(message),
  });

  bus.on('messages', (key: string, list: Message[]) => router.handleMessages(key, list));
  bus.on('contactDiscovered', (c: { key: string; name: string; kind: ContactKind }) => {
    if (!shouldFireDiscovered(stateHolder().getAppSettings().notifications, isMainWindowFocused())) return;
    router.handleContactDiscovered(c);
  });
  bus.on('uiState', (u: UiState) => {
    log.debug(`uiState activeKey=${u.activeKey}`);
    router.handleUiState(u);
    // Opening a conversation clears its unread count, so the badge has to drop
    // right away — this one is a direct user action, not a sync burst.
    router.recomputeBadge();
  });
  // Deliberately not routed through router.handleMessages: that only ever
  // processes the tail of a list, so a re-push after deleting the newest
  // message could raise a fresh banner for an older one. Uncoalesced for the
  // same reason as uiState — deleting a message is a direct user action.
  bus.on('messagesDeleted', () => router.recomputeBadge());
  // The rest are list-shaped events; `contacts` alone fires once per contact
  // during a sync, so they go through a coalescer.
  subscribeBadgeRecompute(router);
  router.recomputeBadge();
  log.debug('notification router started');
}
