import { describe, expect, it } from 'vitest';
import { uiStateSchema } from '../../../src/shared/api/schemas';
import {
  canonicalActiveKey,
  canonicalActiveKeys,
  isActiveKey,
  isConversationKey,
  isMyNodeKey,
  isSettingsKey,
  isToolKey,
  NODE_TELEMETRY_KEY,
} from '../../../src/shared/keys';
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

describe('retired tool keys', () => {
  it('maps the Radio Connection and My radio keys to My node', () => {
    expect(canonicalActiveKey('tool:bleconnect' as never)).toBe('tool:node');
    expect(canonicalActiveKey('tool:myradio' as never)).toBe('tool:node');
    expect(canonicalActiveKey('tool:map')).toBe('tool:map');
    expect(canonicalActiveKey(NODE_TELEMETRY_KEY)).toBe(NODE_TELEMETRY_KEY);
  });

  it('dedupes the list it maps, keeping the first occurrence’s place', () => {
    expect(canonicalActiveKeys(['ch:0', 'tool:myradio', 'tool:map', 'tool:bleconnect', 'tool:node'] as never)).toEqual([
      'ch:0',
      'tool:node',
      'tool:map',
    ]);
  });

  it('counts the telemetry sub-view as My node', () => {
    expect(isMyNodeKey('tool:node')).toBe(true);
    expect(isMyNodeKey(NODE_TELEMETRY_KEY)).toBe(true);
    expect(isMyNodeKey('tool:map')).toBe(false);
    expect(isActiveKey(NODE_TELEMETRY_KEY)).toBe(true);
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
