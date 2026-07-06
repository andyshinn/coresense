import { describe, expect, it } from 'vitest';
import { filterMacros, scopeCounts } from '@/panels/macros/lib/filterMacros';
import type { MacroTemplate } from '../../../../../src/shared/macros/types';

const mk = (over: Partial<MacroTemplate>): MacroTemplate => ({
  id: over.id ?? 'x',
  name: over.name ?? 'Macro',
  template: over.template ?? '{{ my_name }}',
  scope: over.scope ?? 'global',
  channelKey: over.channelKey,
  contactKey: over.contactKey,
  createdAt: over.createdAt ?? 0,
  updatedAt: over.updatedAt ?? 0,
});

const macros: MacroTemplate[] = [
  mk({ id: 'a', name: 'Signal report', template: '{{ snr }} snr', scope: 'global' }),
  mk({ id: 'b', name: 'Relay path', template: 'heard via {{ paths }}', scope: 'channel', channelKey: 'ch:testing' }),
  mk({ id: 'c', name: 'Repeater nudge', template: '{{ peer_name }} hop', scope: 'contact', contactKey: 'c:abc' }),
];

describe('filterMacros', () => {
  it('returns all macros for an empty query and the "all" scope', () => {
    expect(filterMacros(macros, '', 'all')).toHaveLength(3);
  });

  it('filters by scope', () => {
    expect(filterMacros(macros, '', 'channel').map((m) => m.id)).toEqual(['b']);
  });

  it('searches case-insensitively across name', () => {
    expect(filterMacros(macros, 'RELAY', 'all').map((m) => m.id)).toEqual(['b']);
  });

  it('searches the template body too', () => {
    expect(filterMacros(macros, 'paths', 'all').map((m) => m.id)).toEqual(['b']);
  });

  it('combines scope and search', () => {
    expect(filterMacros(macros, 'signal', 'channel')).toEqual([]);
    expect(filterMacros(macros, 'signal', 'global').map((m) => m.id)).toEqual(['a']);
  });
});

describe('scopeCounts', () => {
  it('counts macros per scope plus a total', () => {
    expect(scopeCounts(macros)).toEqual({ all: 3, global: 1, channel: 1, contact: 1 });
  });
});
