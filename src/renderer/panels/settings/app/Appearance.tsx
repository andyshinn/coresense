import { Sun } from 'lucide-react';
import type { AppSettings as AppSettingsType, ThemePrefValue } from '../../../../shared/types';
import { Row, Select } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { useStore } from '../../../lib/store';
import type { SectionProps } from '../radio/shared';
import { useSettingsSection } from '../useSectionDraft';
import { saveApp } from './shared';

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

const eqAppearance = (a: AppSettingsType, b: AppSettingsType) =>
  a.theme === b.theme &&
  a.messageStyle === b.messageStyle &&
  a.unreadsStyle === b.unreadsStyle &&
  a.timeFormat === b.timeFormat;

export function AppearanceSection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-appearance',
    saved,
    eq: eqAppearance,
    onSave: (d) =>
      saveApp(
        client,
        {
          theme: d.theme,
          messageStyle: d.messageStyle,
          unreadsStyle: d.unreadsStyle,
          timeFormat: d.timeFormat,
        },
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
        description="Conversation messages. Compact shows one line (sender + body); rich shows avatar, sender, and a meta row. Both show hops + path hash."
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
        label="Unread density"
        description="Unreads triage previews — set independently from the conversation density above."
        changed={draft.unreadsStyle !== saved.unreadsStyle}
        control={
          <Select
            value={draft.unreadsStyle}
            options={MESSAGE_STYLE_OPTIONS}
            onChange={(style) => setDraft((s) => ({ ...s, unreadsStyle: style }))}
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
