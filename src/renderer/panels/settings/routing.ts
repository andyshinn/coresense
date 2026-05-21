import type { SettingsTab } from '../../lib/store';

// Map the LeftNav's legacy "tool:settings:<suffix>" deep links onto the new
// three-tab model so older menu items and pinned keys still resolve. Kept in a
// standalone module so MainPane can decode the tab without eagerly importing
// the lazy-loaded SettingsPanel chunk.
const LEGACY_SUFFIX_TO_TAB: Record<string, SettingsTab> = {
  app: 'app',
  identity: 'radio',
  radio: 'radio',
  'identity-key': 'radio',
  bluetooth: 'radio',
  contact: 'radio',
  message: 'radio',
  notification: 'app',
  position: 'radio',
  telemetry: 'radio',
  extra: 'extra',
  info: 'radio',
};

export function tabFromActiveKey(key: string): SettingsTab | undefined {
  const suffix = key.split(':')[2];
  if (!suffix) return undefined;
  return LEGACY_SUFFIX_TO_TAB[suffix];
}
