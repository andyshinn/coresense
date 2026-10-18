import { describe, expect, it } from 'vitest';
import { uiStateSchema } from '../../../src/shared/api/schemas';
import { isActiveKey, isConversationKey, isSettingsKey, isToolKey } from '../../../src/shared/keys';
import { DEFAULT_UI_STATE } from '../../../src/shared/types';

describe('key guards', () => {
  it('tells conversations, tools and settings deep links apart', () => {
    expect(isConversationKey('ch:General')).toBe(true);
    expect(isConversationKey('c:abcd')).toBe(true);
    expect(isConversationKey('tool:map')).toBe(false);
    expect(isToolKey('tool:map')).toBe(true);
    expect(isToolKey('ch:tool:map')).toBe(false);
    expect(isSettingsKey('tool:settings')).toBe(true);
    expect(isSettingsKey('tool:settings:radio')).toBe(true);
    expect(isSettingsKey('tool:settingsx')).toBe(false);
  });

  it('accepts only key-shaped strings as an active key', () => {
    for (const key of ['ch:x', 'c:ab', 'tool:packetlog', 'tool:settings:app']) expect(isActiveKey(key)).toBe(true);
    for (const key of ['', 'packetlog', 'nb:ab', 'site:c:aa']) expect(isActiveKey(key)).toBe(false);
  });
});

describe('UiState activeKey validation', () => {
  // A ui-state.json written by an older build can hold a tool key this build no
  // longer has; refusing it would fail every later save, so only the shape is
  // checked.
  it('accepts an unknown tool key', () => {
    expect(uiStateSchema.safeParse({ ...DEFAULT_UI_STATE, activeKey: 'tool:retired' }).success).toBe(true);
  });

  it('refuses a key that is not key-shaped', () => {
    expect(uiStateSchema.safeParse({ ...DEFAULT_UI_STATE, activeKey: 'General' }).success).toBe(false);
    expect(uiStateSchema.safeParse({ ...DEFAULT_UI_STATE, recentKeys: ['General'] }).success).toBe(false);
  });
});
