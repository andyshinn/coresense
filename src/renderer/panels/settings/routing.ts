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
  quickActions: 'quickActions',
};

export function tabFromActiveKey(key: string): SettingsTab | undefined {
  const suffix = key.split(':')[2];
  if (!suffix) return undefined;
  return LEGACY_SUFFIX_TO_TAB[suffix];
}

// The few deep links that land on one section rather than a tab's top: the
// telemetry policy moved to My radio, and its Settings section is now the
// link row there; Position is where My radio sends a library too old for
// sensor settings.
const LEGACY_SUFFIX_TO_SECTION: Record<string, string> = {
  position: 'radio-position',
  telemetry: 'radio-telemetry',
};

export function sectionFromActiveKey(key: string): string | undefined {
  const suffix = key.split(':')[2];
  return suffix ? LEGACY_SUFFIX_TO_SECTION[suffix] : undefined;
}
