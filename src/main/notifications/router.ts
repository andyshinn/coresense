import type { AppSettings, Channel, Contact, ContactKind, MenuAction, Message, Owner, UiState } from '../../shared/types';
import type { NotificationActions } from './actions';
import { createAggregator, type StaleDescriptor } from './aggregator';
import type { Capabilities } from './capabilities';
import { MAX_NOTIFIED_IDS } from './config';
import { buildContent, channelSenderName, formatSummaryBody } from './format';
import { classify, passesPolicy } from './policy';
import type { NotificationPresenter, NotificationSpec } from './present';

const ACTION_LABELS = ['Mark as read', 'Mute'];

export interface RouterDeps {
  presenter: NotificationPresenter;
  caps: Capabilities;
  now(): number;
  isFocused(): boolean;
  emitMenuAction(a: MenuAction): void;
  actions: NotificationActions;
  setBadge(n: number): void;
  config: { staleThresholdMs: number; flushDelayMs: number; rollupCap: number };
  getAppSettings(): AppSettings;
  getOwner(): Owner | null;
  getUiState(): UiState;
  getChannels(): Channel[];
  getContacts(): Contact[];
  getMessagesForKey(key: string): Message[];
  isBlocked(m: Message): boolean;
  /** Optional diagnostic sink (wired to the main logger in production). */
  debug?(message: string): void;
}

export interface NotificationRouter {
  handleMessages(key: string, list: Message[]): void;
  handleUiState(ui: UiState): void;
  handleContactDiscovered(c: { key: string; name: string; kind: ContactKind }): void;
  recomputeBadge(): void;
}

export function createNotificationRouter(deps: RouterDeps): NotificationRouter {
  const debug = deps.debug ?? (() => {});
  const notifiedIds = new Set<string>();
  const summaryKeys = new Set<string>();
  // Snapshot of lastReadByKey from the previous uiState push, so handleUiState
  // can detect which conversations were just marked read (their marker advanced)
  // and clear their notifications — even when they aren't the active key.
  let lastReadSnapshot: Record<string, number> = {};

  const aggregator = createAggregator({
    now: deps.now,
    config: deps.config,
    callbacks: {
      onIndividual: presentIndividual,
      onSummaries: presentSummaries,
      onGlobalSummary: presentGlobalSummary,
    },
  });

  function channelName(key: string): string {
    return deps.getChannels().find((c) => c.key === key)?.name ?? key.slice(3);
  }
  function contactName(key: string): string {
    return deps.getContacts().find((c) => c.key === key)?.name ?? key;
  }
  function contactKindOf(key: string): ContactKind | undefined {
    return deps.getContacts().find((c) => c.key === key)?.kind;
  }
  function isMuted(key: string): boolean {
    if (key.startsWith('ch:')) return deps.getChannels().some((c) => c.key === key && c.muted);
    return deps.getContacts().some((c) => c.key === key && c.muted);
  }
  // Silent when the user turned sound off, or when the app is already focused —
  // a notification for another conversation shouldn't be loud while you're
  // sitting in the app.
  function isSilent(): boolean {
    return !deps.getAppSettings().notifications.sound || deps.isFocused();
  }
  function clearConversation(key: string): void {
    // Removes both the individual banners and the summary for this conversation
    // (all share groupId = key), and resets our per-conversation aggregation
    // state so a later stale burst starts a fresh count.
    deps.presenter.clearGroup(key);
    aggregator.clear(key);
    summaryKeys.delete(key);
  }

  function conversationSpecExtras(
    key: string,
  ): Pick<NotificationSpec, 'reply' | 'replyPlaceholder' | 'actions' | 'onReply' | 'onAction'> {
    return {
      reply: deps.caps.reply ? true : undefined,
      replyPlaceholder: deps.caps.reply ? 'Reply…' : undefined,
      actions: deps.caps.actions ? ACTION_LABELS : undefined,
      onReply: (text) => void deps.actions.reply(key, text),
      onAction: (index) => (index === 0 ? deps.actions.markRead(key) : deps.actions.mute(key)),
    };
  }

  function presentIndividual(m: Message): void {
    const isChannel = m.key.startsWith('ch:');
    const ownerName = deps.getOwner()?.name;
    const kind = classify(m, ownerName, contactKindOf(m.key));
    const content = buildContent({
      isChannel,
      displayName: isChannel ? channelName(m.key) : contactName(m.key),
      senderName: isChannel ? channelSenderName(m.fromPublicKeyHex) : '',
      mention: kind === 'channelMention',
      body: m.body,
      caps: deps.caps,
    });
    deps.presenter.show({
      id: `msg:${m.id}`,
      groupId: m.key,
      title: content.title,
      subtitle: content.subtitle,
      body: content.body,
      silent: isSilent(),
      onClick: () => {
        debug(`click->focusMessage key=${m.key} messageId=${m.id}`);
        deps.emitMenuAction({ kind: 'focusMessage', key: m.key, messageId: m.id });
      },
      ...conversationSpecExtras(m.key),
    });
  }

  function presentSummaries(summaries: StaleDescriptor[]): void {
    const silent = isSilent();
    for (const d of summaries) {
      summaryKeys.add(d.key);
      const isChannel = d.key.startsWith('ch:');
      deps.presenter.show({
        id: `summary:${d.key}`,
        groupId: d.key,
        title: isChannel ? channelName(d.key) : contactName(d.key),
        body: formatSummaryBody(d.count, d.senders),
        silent,
        onClick: () => {
          debug(`click->focusFirstUnread key=${d.key}`);
          deps.emitMenuAction({ kind: 'focusFirstUnread', key: d.key });
        },
        ...conversationSpecExtras(d.key),
      });
    }
  }

  function presentGlobalSummary(info: { total: number; conversationCount: number; lastKey: string }): void {
    summaryKeys.add(info.lastKey);
    deps.presenter.show({
      id: 'summary:__all__',
      groupId: info.lastKey,
      title: 'CoreSense',
      body: `${info.total} messages across ${info.conversationCount} conversations`,
      silent: isSilent(),
      onClick: () => {
        debug(`click->focusFirstUnread (global) key=${info.lastKey}`);
        deps.emitMenuAction({ kind: 'focusFirstUnread', key: info.lastKey });
      },
    });
  }

  function processMessage(m: Message): void {
    if (notifiedIds.has(m.id)) return;
    notifiedIds.add(m.id);
    if (notifiedIds.size > MAX_NOTIFIED_IDS) {
      const drop = Math.floor(MAX_NOTIFIED_IDS / 2);
      let i = 0;
      for (const id of notifiedIds) {
        if (i++ >= drop) break;
        notifiedIds.delete(id);
      }
    }
    const notifications = deps.getAppSettings().notifications;
    const ui = deps.getUiState();
    const appFocused = deps.isFocused();
    const muted = isMuted(m.key);
    const blocked = deps.isBlocked(m);
    const { show, kind } = passesPolicy({
      msg: m,
      notifications,
      ownerName: deps.getOwner()?.name,
      contactKind: contactKindOf(m.key),
      muted,
      blocked,
      focused: appFocused && ui.activeKey === m.key,
    });
    debug(
      `decide id=${m.id} key=${m.key} state=${m.state} kind=${kind} show=${show} ` +
        `appFocused=${appFocused} activeKey=${ui.activeKey} suppressWhenFocused=${notifications.suppressWhenFocused} ` +
        `muted=${muted} blocked=${blocked} sound=${notifications.sound}`,
    );
    if (!show) return;
    if (!deps.presenter.isSupported()) return;
    if (notifications.summarizeBacklog) {
      aggregator.ingest(m, m.key.startsWith('ch:') ? channelSenderName(m.fromPublicKeyHex) : '');
    } else {
      presentIndividual(m);
    }
  }

  return {
    handleMessages(_key, list) {
      const last = list[list.length - 1];
      if (last) processMessage(last);
      this.recomputeBadge();
    },
    handleUiState(ui) {
      // Opening a conversation clears its outstanding notifications (individual
      // banners + summary) — design §5.6.
      clearConversation(ui.activeKey);
      // Marking a conversation read (e.g. the "Mark as read" action button)
      // advances its lastReadByKey without changing activeKey; clear those too.
      for (const [key, ts] of Object.entries(ui.lastReadByKey)) {
        if (ts > (lastReadSnapshot[key] ?? 0)) clearConversation(key);
      }
      lastReadSnapshot = ui.lastReadByKey;
    },
    handleContactDiscovered(c) {
      if (!deps.presenter.isSupported()) return;
      // shouldFireDiscovered is applied by index.ts before this is called.
      deps.presenter.show({
        id: `discovered:${c.key}`,
        groupId: 'discovered',
        title: 'New contact discovered',
        body: c.name,
        silent: !deps.getAppSettings().notifications.sound,
        onClick: () => deps.emitMenuAction({ kind: 'focusKey', key: c.key }),
      });
    },
    recomputeBadge() {
      const settings = deps.getAppSettings();
      if (!settings.notifications.dockBadge) {
        deps.setBadge(0);
        return;
      }
      const ui = deps.getUiState();
      const ownerName = deps.getOwner()?.name;
      const keys = new Set<string>();
      for (const ch of deps.getChannels()) keys.add(ch.key);
      for (const c of deps.getContacts()) keys.add(c.key);
      let total = 0;
      for (const key of keys) {
        if (isMuted(key)) continue;
        const lastRead = ui.lastReadByKey[key] ?? 0;
        for (const m of deps.getMessagesForKey(key)) {
          if (m.state !== 'received') continue;
          if (m.ts <= lastRead) continue;
          if (deps.isBlocked(m)) continue;
          const kind = classify(m, ownerName, contactKindOf(key));
          if (settings.notifications[kind]) total += 1;
        }
      }
      deps.setBadge(total);
    },
  };
}
