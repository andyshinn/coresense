import { type ChannelKey, type ContactKey, conversationKind } from './conversationKey';

// Every key the main pane can show: a conversation, a tool, or a Settings deep
// link. Conversation keys are built and parsed in ./conversationKey.

/** A conversation: a channel or a contact (DM). */
export type ConversationKey = ChannelKey | ContactKey;

/** Every tool destination, in command-palette order. */
export const TOOL_KEYS = [
  'tool:settings:app',
  'tool:settings:radio',
  // Legacy deep link: lands on the same tab as Radio Settings (see
  // panels/settings/routing.ts). Kept so recent/pinned keys still resolve,
  // and so it also stays listed as a palette alias ("Identity").
  'tool:settings:identity',
  'tool:search',
  'tool:unreads',
  'tool:packetlog',
  'tool:logs',
  'tool:map',
  'tool:contacts',
  'tool:macros',
  'tool:node',
] as const;

export type ToolKey = (typeof TOOL_KEYS)[number];

/** A Settings deep link, `tool:settings:<tab>`. panels/settings/routing.ts
 *  resolves the tab, including legacy aliases. */
export type SettingsKey = 'tool:settings' | `tool:settings:${string}`;

/** My Node's saved-telemetry view, the destination of "View all". A sub-view
 *  of `tool:node` rather than a tool of its own, so it isn't in TOOL_KEYS. */
export const NODE_TELEMETRY_KEY = 'tool:node:telemetry';
export type NodeTelemetryKey = typeof NODE_TELEMETRY_KEY;

/** What the main pane shows: UiState.activeKey, recents and history. */
export type ActiveKey = ConversationKey | ToolKey | SettingsKey | NodeTelemetryKey;

/** Tool keys that moved. My Node replaced both the Radio Connection panel
 *  (`tool:bleconnect`) and My radio (`tool:myradio`); a ui-state.json, recent
 *  or pin written before that still holds them. */
const RETIRED_KEYS: Readonly<Record<string, ActiveKey>> = {
  'tool:bleconnect': 'tool:node',
  'tool:myradio': 'tool:node',
};

/** The key a retired one moved to, or `key` itself. */
export function canonicalActiveKey(key: ActiveKey): ActiveKey {
  return RETIRED_KEYS[key] ?? key;
}

/** `canonicalActiveKey` over a list, dropping the duplicates it can create
 *  (a pin on both retired keys becomes one pin). First occurrence wins, so a
 *  recents list keeps its order. */
export function canonicalActiveKeys(keys: readonly ActiveKey[]): ActiveKey[] {
  const out: ActiveKey[] = [];
  for (const k of keys.map(canonicalActiveKey)) if (!out.includes(k)) out.push(k);
  return out;
}

/** True on My Node and its sub-views. */
export function isMyNodeKey(key: string): boolean {
  return key === 'tool:node' || key === NODE_TELEMETRY_KEY;
}

/** True iff `key` is a tool or Settings key rather than a conversation. */
export function isToolKey(key: string): key is ToolKey | SettingsKey {
  return key.startsWith('tool:');
}

/** True iff `key` is a Settings deep link. */
export function isSettingsKey(key: string): key is SettingsKey {
  return key === 'tool:settings' || key.startsWith('tool:settings:');
}

/** True iff `key` is a channel or contact key. For narrowing a key that
 *  arrives as a plain string (a message row, a search hit, a WS payload). */
export function isConversationKey(key: string): key is ConversationKey {
  return conversationKind(key) !== null;
}

/** True iff `key` has the shape of something the main pane can show. */
export function isActiveKey(key: string): key is ActiveKey {
  return isConversationKey(key) || isToolKey(key);
}
