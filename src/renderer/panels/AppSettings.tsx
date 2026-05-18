import { useEffect, useRef, useState } from 'react';
import type {
  AppSettings as AppSettingsType,
  ContactGrouping,
  ThemePrefValue,
} from '../../shared/types';
import {
  NumberInput,
  PanelShell,
  Row,
  Section,
  Select,
  Toggle,
} from '../components/settings/Field';
import { MapKeySection } from '../components/settings/MapKeySection';
import { type ApiClient, api } from '../lib/api';
import { notify } from '../lib/notify';
import { useStore } from '../lib/store';

const SAVE_DEBOUNCE_MS = 400;
// After a successful PUT, wait this long with no further saves before toasting.
// Coalesces bursts of edits (e.g. flipping several toggles) into one toast.
const TOAST_QUIET_MS = 600;

const THEME_OPTIONS = [
  { value: 'auto', label: 'Auto (system)' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

const MESSAGE_STYLE_OPTIONS = [
  { value: 'rich', label: 'Rich (sender + meta)' },
  { value: 'compact', label: 'Compact (one line)' },
] as const;

const CONTACT_GROUPING_OPTIONS = [
  { value: 'nested', label: 'Nested (under Contacts)' },
  { value: 'top-level', label: 'Top-level sections' },
] as const;

const SEARCH_SORT_OPTIONS = [
  { value: 'recency', label: 'Recency (newest first)' },
  { value: 'relevance', label: 'Relevance (BM25)' },
] as const;

interface Props {
  client: ApiClient | null;
}

// App-level settings. Auto-saves a debounced PUT per user keystroke / toggle;
// proxy settings warn the user that bind/port changes don't take effect until
// the next app launch (the bridge isn't yet hot-restartable).
export function AppSettings({ client }: Props) {
  const settings = useStore((s) => s.appSettings);

  // Local edit buffer so we can re-render immediately while debouncing the
  // server write. The store updates from the server WS push afterwards.
  const [draft, setDraft] = useState<AppSettingsType>(settings);
  // Track the last server snapshot we adopted so we can tell a server push
  // (settings changed under us) from a local edit (draft changed by `update`).
  const lastServerRef = useRef<AppSettingsType>(settings);
  const lastDraftRef = useRef<AppSettingsType>(settings);
  useEffect(() => {
    if (settings === lastServerRef.current) return;
    lastServerRef.current = settings;
    // Only adopt the server value if the user hasn't diverged locally.
    if (lastDraftRef.current === draft && draft !== settings) {
      lastDraftRef.current = settings;
      setDraft(settings);
    }
  }, [settings, draft]);

  // Toast timer is reset every time a save succeeds, so a burst of edits
  // produces exactly one "Settings saved" toast after the user settles.
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // Debounced auto-save. Driven by `draft` only — `settings` updates via the
  // WS rebroadcast after a successful PUT, and the sync effect above resets
  // the draft when it does, so we won't re-PUT in a loop.
  useEffect(() => {
    if (!client) return;
    if (draft === settings) return;
    const handle = setTimeout(() => {
      void api
        .putAppSettings(client, draft)
        .then(() => {
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => {
            notify.success('Settings saved');
            toastTimerRef.current = null;
          }, TOAST_QUIET_MS);
        })
        .catch((err) => {
          notify.error(`Save failed: ${(err as Error).message}`, err);
        });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [draft, client, settings]);

  const update = (mutator: (s: AppSettingsType) => AppSettingsType) => {
    const next = mutator(lastDraftRef.current);
    lastDraftRef.current = next;
    setDraft(next);
  };

  return (
    <PanelShell title="App Settings" description="Local preferences — auto-saved.">
      <Section title="Appearance">
        <Row
          label="Theme"
          description="Auto follows your OS setting (Cmd-T cycles)."
          control={
            <Select
              value={draft.theme}
              options={THEME_OPTIONS}
              onChange={(theme) => update((s) => ({ ...s, theme: theme as ThemePrefValue }))}
            />
          }
        />
        <Row
          label="Message density"
          description="Compact shows one line per message; rich shows sender + RSSI/SNR/hops."
          control={
            <Select
              value={draft.messageStyle}
              options={MESSAGE_STYLE_OPTIONS}
              onChange={(style) => update((s) => ({ ...s, messageStyle: style }))}
            />
          }
        />
      </Section>

      <Section title="Composer">
        <Row
          label="Return sends, Shift-Return inserts newline"
          description="Off makes Return insert a newline and Cmd-Return send."
          control={
            <Toggle
              checked={draft.composer.returnToSend}
              onChange={(v) =>
                update((s) => ({ ...s, composer: { ...s.composer, returnToSend: v } }))
              }
            />
          }
        />
      </Section>

      <Section
        title="Notifications"
        description="Fired only when the app is unfocused or you're viewing a different conversation."
      >
        <Row
          label="Direct messages"
          control={
            <Toggle
              checked={draft.notifications.directMessage}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  notifications: { ...s.notifications, directMessage: v },
                }))
              }
            />
          }
        />
        <Row
          label="Channel mentions"
          description="@name in a channel."
          control={
            <Toggle
              checked={draft.notifications.channelMention}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  notifications: { ...s.notifications, channelMention: v },
                }))
              }
            />
          }
        />
        <Row
          label="All channel messages"
          description="Noisy on busy channels — off by default."
          control={
            <Toggle
              checked={draft.notifications.channelMessage}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  notifications: { ...s.notifications, channelMessage: v },
                }))
              }
            />
          }
        />
        <Row
          label="Repeater alerts"
          control={
            <Toggle
              checked={draft.notifications.repeaterAlert}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  notifications: { ...s.notifications, repeaterAlert: v },
                }))
              }
            />
          }
        />
        <Row
          label="Sensor alerts"
          control={
            <Toggle
              checked={draft.notifications.sensorAlert}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  notifications: { ...s.notifications, sensorAlert: v },
                }))
              }
            />
          }
        />
        <Row
          label="Play sound"
          control={
            <Toggle
              checked={draft.notifications.sound}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  notifications: { ...s.notifications, sound: v },
                }))
              }
            />
          }
        />
        <Row
          label="Suppress while focused"
          description="Don't notify if the app window is in the foreground."
          control={
            <Toggle
              checked={draft.notifications.suppressWhenFocused}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  notifications: { ...s.notifications, suppressWhenFocused: v },
                }))
              }
            />
          }
        />
        <Row
          label="Dock badge (macOS)"
          description="Unread count on the app icon."
          control={
            <Toggle
              checked={draft.notifications.dockBadge}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  notifications: { ...s.notifications, dockBadge: v },
                }))
              }
            />
          }
        />
      </Section>

      <Section title="Toasts" description="In-app status messages shown in the bottom-right.">
        <Row
          label="Enabled"
          control={
            <Toggle
              checked={draft.toasts.enabled}
              onChange={(v) => update((s) => ({ ...s, toasts: { ...s.toasts, enabled: v } }))}
            />
          }
        />
        <Row
          label="Duration (seconds)"
          description="How long each toast stays visible before auto-dismissing."
          control={
            <NumberInput
              value={draft.toasts.durationSec}
              min={1}
              max={60}
              disabled={!draft.toasts.enabled}
              onChange={(v) => update((s) => ({ ...s, toasts: { ...s.toasts, durationSec: v } }))}
            />
          }
        />
      </Section>

      <Section
        title="TCP / WS Proxy"
        description="Lets the official MeshCore mobile app (or another desktop client) share this radio over LAN."
      >
        <Row
          label="Enabled"
          control={
            <Toggle
              checked={draft.proxy.enabled}
              onChange={(v) => update((s) => ({ ...s, proxy: { ...s.proxy, enabled: v } }))}
            />
          }
        />
        <Row
          label="Bind to all interfaces (0.0.0.0)"
          description="Off binds to 127.0.0.1 only; on allows LAN clients to connect."
          warning={
            draft.proxy.bindAll
              ? 'Anyone on your network can connect to this radio without auth.'
              : undefined
          }
          control={
            <Toggle
              checked={draft.proxy.bindAll}
              disabled={!draft.proxy.enabled}
              onChange={(v) => update((s) => ({ ...s, proxy: { ...s.proxy, bindAll: v } }))}
            />
          }
        />
        <Row
          label="TCP port"
          description="Bridge serves both raw TCP and WS on this port."
          control={
            <NumberInput
              value={draft.proxy.port}
              min={1}
              max={65535}
              disabled={!draft.proxy.enabled}
              onChange={(v) => update((s) => ({ ...s, proxy: { ...s.proxy, port: v } }))}
            />
          }
        />
        <Row
          label="Advertise via mDNS"
          description="So clients on the LAN can find this radio by name without hard-coding the IP."
          control={
            <Toggle
              checked={draft.proxy.mdns}
              disabled={!draft.proxy.enabled}
              onChange={(v) => update((s) => ({ ...s, proxy: { ...s.proxy, mdns: v } }))}
            />
          }
        />
        <p className="px-2 pt-1 text-[10px] italic text-cs-text-dim">
          Bind / port / mDNS changes take effect on next launch. Hot-restart coming in a later
          phase.
        </p>
      </Section>

      <Section title="Behavior">
        <Row
          label="Pin unread to top"
          description="Sort unread channels and contacts above pinned items in the left nav."
          control={
            <Toggle
              checked={draft.pinUnreadToTop}
              onChange={(v) => update((s) => ({ ...s, pinUnreadToTop: v }))}
            />
          }
        />
        <Row
          label="Auto-reconnect on launch"
          description="Reconnect to the last device when the app starts."
          control={
            <Toggle
              checked={draft.autoReconnect}
              onChange={(v) => update((s) => ({ ...s, autoReconnect: v }))}
            />
          }
        />
        <Row
          label="Contact list grouping"
          description="Nested keeps one Contacts section with sub-groups; top-level promotes each kind to its own section."
          control={
            <Select
              value={draft.contactGrouping}
              options={CONTACT_GROUPING_OPTIONS}
              onChange={(grouping) =>
                update((s) => ({ ...s, contactGrouping: grouping as ContactGrouping }))
              }
            />
          }
        />
        <Row
          label="Hide channels not on radio"
          description="Off shows missing channels grayed-out with history preserved; on hides them entirely."
          control={
            <Toggle
              checked={draft.hideUnsyncedChannels}
              onChange={(v) => update((s) => ({ ...s, hideUnsyncedChannels: v }))}
            />
          }
        />
        <Row
          label="Default search sort"
          description="Initial sort for new search sessions. The Search panel can still toggle in-session; that choice also writes back here."
          control={
            <Select
              value={draft.search.defaultSort}
              options={SEARCH_SORT_OPTIONS}
              onChange={(sort) =>
                update((s) => ({
                  ...s,
                  search: { ...s.search, defaultSort: sort as 'recency' | 'relevance' },
                }))
              }
            />
          }
        />
        <Row
          label="Show sidebar search"
          description="Display a quick-filter field above Conversations. Cmd/Ctrl+F focuses it."
          control={
            <Toggle
              checked={draft.showLeftNavSearch}
              onChange={(v) => update((s) => ({ ...s, showLeftNavSearch: v }))}
            />
          }
        />
        <Row
          label="Collapse long lists"
          description="Cap each LeftNav branch at a limit and add a Show-more button for the rest."
          control={
            <Toggle
              checked={draft.leftNavCollapseLists.enabled}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  leftNavCollapseLists: { ...s.leftNavCollapseLists, enabled: v },
                }))
              }
            />
          }
        />
        <Row
          label="Items before Show more"
          description="Maximum rows shown under each branch before the Show-more button takes over."
          control={
            <NumberInput
              value={draft.leftNavCollapseLists.limit}
              min={1}
              max={500}
              disabled={!draft.leftNavCollapseLists.enabled}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  leftNavCollapseLists: { ...s.leftNavCollapseLists, limit: v },
                }))
              }
            />
          }
        />
      </Section>

      <MapKeySection client={client} />
    </PanelShell>
  );
}
