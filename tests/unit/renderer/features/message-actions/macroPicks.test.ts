import { describe, expect, it } from 'vitest';
import { applicableMacros, topMacros } from '../../../../../src/renderer/features/message-actions/macroPicks';
import type { MacroTemplate } from '../../../../../src/shared/macros/types';
import type { UsageMap } from '../../../../../src/shared/types';

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;

function macro(over: Partial<MacroTemplate> & Pick<MacroTemplate, 'id'>): MacroTemplate {
  return {
    name: over.id,
    template: 'hi',
    scope: 'global',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('applicableMacros', () => {
  const macros = [
    macro({ id: 'g' }),
    macro({ id: 'ch-match', scope: 'channel', channelKey: 'ch:beef' }),
    macro({ id: 'ch-other', scope: 'channel', channelKey: 'ch:cafe' }),
    macro({ id: 'c-match', scope: 'contact', contactKey: 'c:a3f9' }),
    macro({ id: 'c-other', scope: 'contact', contactKey: 'c:0001' }),
  ];

  it('keeps global macros on any conversation', () => {
    expect(applicableMacros(macros, 'ch:beef').map((m) => m.id)).toContain('g');
    expect(applicableMacros(macros, 'c:a3f9').map((m) => m.id)).toContain('g');
  });

  it('admits only the channel macro whose key matches', () => {
    const ids = applicableMacros(macros, 'ch:beef').map((m) => m.id);
    expect(ids).toContain('ch-match');
    expect(ids).not.toContain('ch-other');
  });

  it('admits only the contact macro whose key matches', () => {
    const ids = applicableMacros(macros, 'c:a3f9').map((m) => m.id);
    expect(ids).toContain('c-match');
    expect(ids).not.toContain('c-other');
  });

  it('excludes scoped macros from an unrelated conversation entirely', () => {
    expect(applicableMacros(macros, 'ch:beef').map((m) => m.id)).toEqual(['g', 'ch-match']);
  });

  it('drops a scoped macro whose key is missing', () => {
    expect(applicableMacros([macro({ id: 'orphan', scope: 'channel' })], 'ch:beef')).toEqual([]);
  });
});

describe('topMacros', () => {
  const macros = [macro({ id: 'a' }), macro({ id: 'b' }), macro({ id: 'c' })];

  it('falls back to store order when nothing has been used', () => {
    expect(topMacros(macros, {}, NOW, 2).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('ranks used macros above unused ones, most-frecent first', () => {
    const usage: UsageMap = {
      c: { count: 5, lastUsedMs: NOW },
      b: { count: 1, lastUsedMs: NOW - 10 * DAY },
    };
    expect(topMacros(macros, usage, NOW, 2).map((m) => m.id)).toEqual(['c', 'b']);
  });

  it('ignores usage entries for macros that no longer exist', () => {
    const usage: UsageMap = { deleted: { count: 99, lastUsedMs: NOW } };
    expect(topMacros(macros, usage, NOW, 2).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const usage: UsageMap = { c: { count: 5, lastUsedMs: NOW } };
    topMacros(macros, usage, NOW, 3);
    expect(macros.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns fewer than n when there are fewer macros', () => {
    expect(topMacros([macro({ id: 'only' })], {}, NOW, 2)).toHaveLength(1);
  });
});
