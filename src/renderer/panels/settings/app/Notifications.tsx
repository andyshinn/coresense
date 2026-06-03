import { Bell } from 'lucide-react';
import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import { Row, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { useStore } from '../../../lib/store';
import type { SectionProps } from '../radio/shared';
import { useSettingsSection } from '../useSectionDraft';
import { saveApp } from './shared';

const eqNotifications = (a: AppSettingsType, b: AppSettingsType) => {
  const x = a.notifications;
  const y = b.notifications;
  return (
    x.directMessage === y.directMessage &&
    x.channelMention === y.channelMention &&
    x.channelMessage === y.channelMessage &&
    x.repeaterAlert === y.repeaterAlert &&
    x.sensorAlert === y.sensorAlert &&
    x.discoveredContact === y.discoveredContact &&
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
        label="Discovered contacts"
        description="When a never-before-seen node is first heard."
        changed={n.discoveredContact !== s0.discoveredContact}
        control={
          <Toggle checked={n.discoveredContact} onChange={(v) => setN({ discoveredContact: v })} />
        }
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
