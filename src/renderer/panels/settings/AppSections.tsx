import { Bell, Send, SlidersHorizontal, Sun, Wifi } from 'lucide-react';
import type {
  AppSettings as AppSettingsType,
  ContactGrouping,
  ThemePrefValue,
} from '../../../shared/types';
import { NumberInput, Row, Select, Toggle } from '../../components/settings/Field';
import { SettingsSection } from '../../components/settings/SettingsSection';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { useSettingsSection } from './useSectionDraft';

// The six Application-tab sections. They all edit slices of the single
// `appSettings` object and persist via PUT /api/settings/app. On Save a section
// merges only its own fields onto the freshest store value, so saving one
// section never clobbers another section's already-saved edit.

interface SectionProps {
  client: ApiClient | null;
}

const THEME_OPTIONS = [
  { value: 'auto', label: 'Auto (system)' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

const MESSAGE_STYLE_OPTIONS = [
  { value: 'rich', label: 'Rich (sender + meta)' },
  { value: 'compact', label: 'Compact (one line)' },
] as const;

const TIME_FORMAT_OPTIONS = [
  { value: 'auto', label: 'Auto (system locale)' },
  { value: '12h', label: '12-hour (2:05 PM)' },
  { value: '24h', label: '24-hour (14:05)' },
] as const;

const CONTACT_GROUPING_OPTIONS = [
  { value: 'nested', label: 'Nested (under Contacts)' },
  { value: 'top-level', label: 'Top-level sections' },
] as const;

const SEARCH_SORT_OPTIONS = [
  { value: 'recency', label: 'Recency (newest first)' },
  { value: 'relevance', label: 'Relevance (BM25)' },
] as const;

// Persist a partial AppSettings patch merged onto the freshest store value.
async function saveApp(
  client: ApiClient | null,
  patch: Partial<AppSettingsType>,
  message: string,
): Promise<void> {
  if (!client) throw new Error('No server connection');
  await api.putAppSettings(client, { ...useStore.getState().appSettings, ...patch });
  notify.success(message);
}

// ─── Appearance ──────────────────────────────────────────────────────
const eqAppearance = (a: AppSettingsType, b: AppSettingsType) =>
  a.theme === b.theme && a.messageStyle === b.messageStyle && a.timeFormat === b.timeFormat;

export function AppearanceSection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-appearance',
    saved,
    eq: eqAppearance,
    onSave: (d) =>
      saveApp(
        client,
        { theme: d.theme, messageStyle: d.messageStyle, timeFormat: d.timeFormat },
        'Appearance saved',
      ),
  });

  return (
    <SettingsSection
      id="app-appearance"
      icon={Sun}
      title="Appearance"
      description="Visual preferences for the app window."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Theme"
        description="Auto follows your OS setting (Cmd-T cycles)."
        changed={draft.theme !== saved.theme}
        control={
          <Select
            value={draft.theme}
            options={THEME_OPTIONS}
            onChange={(theme) => setDraft((s) => ({ ...s, theme: theme as ThemePrefValue }))}
          />
        }
      />
      <Row
        label="Message density"
        description="Compact shows one line per message; rich shows sender + RSSI/SNR/hops."
        changed={draft.messageStyle !== saved.messageStyle}
        control={
          <Select
            value={draft.messageStyle}
            options={MESSAGE_STYLE_OPTIONS}
            onChange={(style) => setDraft((s) => ({ ...s, messageStyle: style }))}
          />
        }
      />
      <Row
        label="Time format"
        description="Clock style for message and event timestamps. Auto follows your OS locale."
        changed={draft.timeFormat !== saved.timeFormat}
        control={
          <Select
            value={draft.timeFormat}
            options={TIME_FORMAT_OPTIONS}
            onChange={(tf) => setDraft((s) => ({ ...s, timeFormat: tf }))}
          />
        }
      />
    </SettingsSection>
  );
}

// ─── Composer ────────────────────────────────────────────────────────
const eqComposer = (a: AppSettingsType, b: AppSettingsType) =>
  a.composer.returnToSend === b.composer.returnToSend &&
  a.composer.autoFocus === b.composer.autoFocus;

export function ComposerSection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-composer',
    saved,
    eq: eqComposer,
    onSave: (d) => saveApp(client, { composer: d.composer }, 'Composer settings saved'),
  });

  return (
    <SettingsSection
      id="app-composer"
      icon={Send}
      title="Composer"
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Return sends, Shift-Return inserts newline"
        description="Off makes Return insert a newline and Cmd-Return send."
        changed={draft.composer.returnToSend !== saved.composer.returnToSend}
        control={
          <Toggle
            checked={draft.composer.returnToSend}
            onChange={(v) =>
              setDraft((s) => ({ ...s, composer: { ...s.composer, returnToSend: v } }))
            }
          />
        }
      />
      <Row
        label="Focus message field on navigate"
        description="Place the cursor in the message field when you open a channel or DM, so you can start typing right away."
        changed={draft.composer.autoFocus !== saved.composer.autoFocus}
        control={
          <Toggle
            checked={draft.composer.autoFocus}
            onChange={(v) => setDraft((s) => ({ ...s, composer: { ...s.composer, autoFocus: v } }))}
          />
        }
      />
    </SettingsSection>
  );
}

// ─── Notifications ───────────────────────────────────────────────────
const eqNotifications = (a: AppSettingsType, b: AppSettingsType) => {
  const x = a.notifications;
  const y = b.notifications;
  return (
    x.directMessage === y.directMessage &&
    x.channelMention === y.channelMention &&
    x.channelMessage === y.channelMessage &&
    x.repeaterAlert === y.repeaterAlert &&
    x.sensorAlert === y.sensorAlert &&
    x.sound === y.sound &&
    x.suppressWhenFocused === y.suppressWhenFocused &&
    x.dockBadge === y.dockBadge
  );
};

export function NotificationsSection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-notifications',
    saved,
    eq: eqNotifications,
    onSave: (d) =>
      saveApp(client, { notifications: d.notifications }, 'Notification settings saved'),
  });
  const n = draft.notifications;
  const s0 = saved.notifications;
  const setN = (patch: Partial<AppSettingsType['notifications']>) =>
    setDraft((s) => ({ ...s, notifications: { ...s.notifications, ...patch } }));

  return (
    <SettingsSection
      id="app-notifications"
      icon={Bell}
      title="Notifications"
      description="Fired only when the app is unfocused or you're viewing a different conversation."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Direct messages"
        changed={n.directMessage !== s0.directMessage}
        control={<Toggle checked={n.directMessage} onChange={(v) => setN({ directMessage: v })} />}
      />
      <Row
        label="Channel mentions"
        description="@name in a channel."
        changed={n.channelMention !== s0.channelMention}
        control={
          <Toggle checked={n.channelMention} onChange={(v) => setN({ channelMention: v })} />
        }
      />
      <Row
        label="All channel messages"
        description="Noisy on busy channels — off by default."
        changed={n.channelMessage !== s0.channelMessage}
        control={
          <Toggle checked={n.channelMessage} onChange={(v) => setN({ channelMessage: v })} />
        }
      />
      <Row
        label="Repeater alerts"
        changed={n.repeaterAlert !== s0.repeaterAlert}
        control={<Toggle checked={n.repeaterAlert} onChange={(v) => setN({ repeaterAlert: v })} />}
      />
      <Row
        label="Sensor alerts"
        changed={n.sensorAlert !== s0.sensorAlert}
        control={<Toggle checked={n.sensorAlert} onChange={(v) => setN({ sensorAlert: v })} />}
      />
      <Row
        label="Play sound"
        changed={n.sound !== s0.sound}
        control={<Toggle checked={n.sound} onChange={(v) => setN({ sound: v })} />}
      />
      <Row
        label="Suppress while focused"
        description="Don't notify if the app window is in the foreground."
        changed={n.suppressWhenFocused !== s0.suppressWhenFocused}
        control={
          <Toggle
            checked={n.suppressWhenFocused}
            onChange={(v) => setN({ suppressWhenFocused: v })}
          />
        }
      />
      <Row
        label="Dock badge (macOS)"
        description="Unread count on the app icon."
        changed={n.dockBadge !== s0.dockBadge}
        control={<Toggle checked={n.dockBadge} onChange={(v) => setN({ dockBadge: v })} />}
      />
    </SettingsSection>
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────
const eqToasts = (a: AppSettingsType, b: AppSettingsType) =>
  a.toasts.enabled === b.toasts.enabled && a.toasts.durationSec === b.toasts.durationSec;

export function ToastsSection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-toasts',
    saved,
    eq: eqToasts,
    onSave: (d) => saveApp(client, { toasts: d.toasts }, 'Toast settings saved'),
  });

  return (
    <SettingsSection
      id="app-toasts"
      icon={Bell}
      title="Toasts"
      description="In-app status messages shown in the bottom-right."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Enabled"
        changed={draft.toasts.enabled !== saved.toasts.enabled}
        control={
          <Toggle
            checked={draft.toasts.enabled}
            onChange={(v) => setDraft((s) => ({ ...s, toasts: { ...s.toasts, enabled: v } }))}
          />
        }
      />
      <Row
        label="Duration (seconds)"
        description="How long each toast stays visible before auto-dismissing."
        changed={draft.toasts.durationSec !== saved.toasts.durationSec}
        control={
          <NumberInput
            value={draft.toasts.durationSec}
            min={1}
            max={60}
            disabled={!draft.toasts.enabled}
            onChange={(v) => setDraft((s) => ({ ...s, toasts: { ...s.toasts, durationSec: v } }))}
          />
        }
      />
    </SettingsSection>
  );
}

// ─── TCP / WS Proxy ──────────────────────────────────────────────────
const eqProxy = (a: AppSettingsType, b: AppSettingsType) => {
  const x = a.proxy;
  const y = b.proxy;
  return (
    x.enabled === y.enabled && x.bindAll === y.bindAll && x.port === y.port && x.mdns === y.mdns
  );
};

export function ProxySection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-proxy',
    saved,
    eq: eqProxy,
    onSave: (d) => saveApp(client, { proxy: d.proxy }, 'Proxy settings saved'),
  });
  const p = draft.proxy;
  const p0 = saved.proxy;
  const setP = (patch: Partial<AppSettingsType['proxy']>) =>
    setDraft((s) => ({ ...s, proxy: { ...s.proxy, ...patch } }));

  return (
    <SettingsSection
      id="app-proxy"
      icon={Wifi}
      title="TCP / WS Proxy"
      description="Lets the official MeshCore mobile app (or another desktop client) share this radio over LAN."
      footnote="Bind / port / mDNS changes take effect on next launch. Hot-restart coming in a later phase."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Enabled"
        changed={p.enabled !== p0.enabled}
        control={<Toggle checked={p.enabled} onChange={(v) => setP({ enabled: v })} />}
      />
      <Row
        label="Bind to all interfaces (0.0.0.0)"
        description="Off binds to 127.0.0.1 only; on allows LAN clients to connect."
        warning={
          p.bindAll ? 'Anyone on your network can connect to this radio without auth.' : undefined
        }
        changed={p.bindAll !== p0.bindAll}
        control={
          <Toggle
            checked={p.bindAll}
            disabled={!p.enabled}
            onChange={(v) => setP({ bindAll: v })}
          />
        }
      />
      <Row
        label="TCP port"
        description="Bridge serves both raw TCP and WS on this port."
        changed={p.port !== p0.port}
        control={
          <NumberInput
            value={p.port}
            min={1}
            max={65535}
            disabled={!p.enabled}
            onChange={(v) => setP({ port: v })}
          />
        }
      />
      <Row
        label="Advertise via mDNS"
        description="So clients on the LAN can find this radio by name without hard-coding the IP."
        changed={p.mdns !== p0.mdns}
        control={
          <Toggle checked={p.mdns} disabled={!p.enabled} onChange={(v) => setP({ mdns: v })} />
        }
      />
    </SettingsSection>
  );
}

// ─── Behavior ────────────────────────────────────────────────────────
const eqBehavior = (a: AppSettingsType, b: AppSettingsType) =>
  a.pinUnreadToTop === b.pinUnreadToTop &&
  a.autoReconnect === b.autoReconnect &&
  a.contactGrouping === b.contactGrouping &&
  a.hideUnsyncedChannels === b.hideUnsyncedChannels &&
  a.search.defaultSort === b.search.defaultSort &&
  a.showLeftNavSearch === b.showLeftNavSearch &&
  a.leftNavCollapseLists.enabled === b.leftNavCollapseLists.enabled &&
  a.leftNavCollapseLists.limit === b.leftNavCollapseLists.limit &&
  a.unreadsPreview.enabled === b.unreadsPreview.enabled &&
  a.unreadsPreview.limit === b.unreadsPreview.limit &&
  a.commandPalette.hintWeightPct === b.commandPalette.hintWeightPct;

export function BehaviorSection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-behavior',
    saved,
    eq: eqBehavior,
    onSave: (d) =>
      saveApp(
        client,
        {
          pinUnreadToTop: d.pinUnreadToTop,
          autoReconnect: d.autoReconnect,
          contactGrouping: d.contactGrouping,
          hideUnsyncedChannels: d.hideUnsyncedChannels,
          search: d.search,
          showLeftNavSearch: d.showLeftNavSearch,
          leftNavCollapseLists: d.leftNavCollapseLists,
          unreadsPreview: d.unreadsPreview,
          commandPalette: d.commandPalette,
        },
        'Behavior settings saved',
      ),
  });

  return (
    <SettingsSection
      id="app-behavior"
      icon={SlidersHorizontal}
      title="Behavior"
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Pin unread to top"
        description="Sort unread channels and contacts above pinned items in the left nav."
        changed={draft.pinUnreadToTop !== saved.pinUnreadToTop}
        control={
          <Toggle
            checked={draft.pinUnreadToTop}
            onChange={(v) => setDraft((s) => ({ ...s, pinUnreadToTop: v }))}
          />
        }
      />
      <Row
        label="Auto-reconnect on launch"
        description="Reconnect to the last device when the app starts."
        changed={draft.autoReconnect !== saved.autoReconnect}
        control={
          <Toggle
            checked={draft.autoReconnect}
            onChange={(v) => setDraft((s) => ({ ...s, autoReconnect: v }))}
          />
        }
      />
      <Row
        label="Contact list grouping"
        description="Nested keeps one Contacts section with sub-groups; top-level promotes each kind to its own section."
        changed={draft.contactGrouping !== saved.contactGrouping}
        control={
          <Select
            value={draft.contactGrouping}
            options={CONTACT_GROUPING_OPTIONS}
            onChange={(grouping) =>
              setDraft((s) => ({ ...s, contactGrouping: grouping as ContactGrouping }))
            }
          />
        }
      />
      <Row
        label="Hide channels not on radio"
        description="Off shows missing channels grayed-out with history preserved; on hides them entirely."
        changed={draft.hideUnsyncedChannels !== saved.hideUnsyncedChannels}
        control={
          <Toggle
            checked={draft.hideUnsyncedChannels}
            onChange={(v) => setDraft((s) => ({ ...s, hideUnsyncedChannels: v }))}
          />
        }
      />
      <Row
        label="Default search sort"
        description="Initial sort for new search sessions. The Search panel can still toggle in-session; that choice also writes back here."
        changed={draft.search.defaultSort !== saved.search.defaultSort}
        control={
          <Select
            value={draft.search.defaultSort}
            options={SEARCH_SORT_OPTIONS}
            onChange={(sort) =>
              setDraft((s) => ({
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
        changed={draft.showLeftNavSearch !== saved.showLeftNavSearch}
        control={
          <Toggle
            checked={draft.showLeftNavSearch}
            onChange={(v) => setDraft((s) => ({ ...s, showLeftNavSearch: v }))}
          />
        }
      />
      <Row
        label="Collapse long lists"
        description="Cap each LeftNav branch at a limit and add a Show-more button for the rest."
        changed={draft.leftNavCollapseLists.enabled !== saved.leftNavCollapseLists.enabled}
        control={
          <Toggle
            checked={draft.leftNavCollapseLists.enabled}
            onChange={(v) =>
              setDraft((s) => ({
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
        changed={draft.leftNavCollapseLists.limit !== saved.leftNavCollapseLists.limit}
        control={
          <NumberInput
            value={draft.leftNavCollapseLists.limit}
            min={1}
            max={500}
            disabled={!draft.leftNavCollapseLists.enabled}
            onChange={(v) =>
              setDraft((s) => ({
                ...s,
                leftNavCollapseLists: { ...s.leftNavCollapseLists, limit: v },
              }))
            }
          />
        }
      />
      <Row
        label="Limit Unreads previews"
        description="Cap how many unread messages each conversation card shows in the Unreads panel; the rest collapse behind a + N earlier line."
        changed={draft.unreadsPreview.enabled !== saved.unreadsPreview.enabled}
        control={
          <Toggle
            checked={draft.unreadsPreview.enabled}
            onChange={(v) =>
              setDraft((s) => ({
                ...s,
                unreadsPreview: { ...s.unreadsPreview, enabled: v },
              }))
            }
          />
        }
      />
      <Row
        label="Messages per conversation"
        description="Maximum unread messages shown per card before the rest collapse. Turn the cap off above to show every unread message."
        changed={draft.unreadsPreview.limit !== saved.unreadsPreview.limit}
        control={
          <NumberInput
            value={draft.unreadsPreview.limit}
            min={1}
            max={1000}
            disabled={!draft.unreadsPreview.enabled}
            onChange={(v) =>
              setDraft((s) => ({
                ...s,
                unreadsPreview: { ...s.unreadsPreview, limit: v },
              }))
            }
          />
        }
      />
      <Row
        label="Command palette: description weight"
        description="How strongly the palette ranks a query that matches an item's description instead of its name. 100% ranks them equally; 0% searches names only."
        changed={draft.commandPalette.hintWeightPct !== saved.commandPalette.hintWeightPct}
        control={
          <NumberInput
            value={draft.commandPalette.hintWeightPct}
            min={0}
            max={100}
            step={5}
            suffix="%"
            onChange={(v) =>
              setDraft((s) => ({
                ...s,
                commandPalette: { ...s.commandPalette, hintWeightPct: v },
              }))
            }
          />
        }
      />
    </SettingsSection>
  );
}
