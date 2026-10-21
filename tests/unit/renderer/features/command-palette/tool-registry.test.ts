import { describe, expect, it } from 'vitest';
import { TOOL_ITEMS } from '../../../../../src/renderer/features/command-palette/items/tools';
import { TOOLS } from '../../../../../src/renderer/shell/leftnav/constants';

// Both lists derive from src/renderer/lib/tools.ts; pin what each surface shows.
describe('tool registry', () => {
  it('gives the palette every tool, with full labels, in palette order', () => {
    expect(TOOL_ITEMS.map((t) => [t.key, t.label])).toEqual([
      ['tool:settings:app', 'App Settings'],
      ['tool:settings:radio', 'Radio Settings'],
      ['tool:settings:identity', 'Identity'],
      ['tool:search', 'Search Messages'],
      ['tool:unreads', 'Unreads'],
      ['tool:packetlog', 'Packet Log'],
      ['tool:logs', 'Logs'],
      ['tool:map', 'Map'],
      ['tool:contacts', 'Contact Management'],
      ['tool:macros', 'Macros'],
      ['tool:myradio', 'My radio'],
      ['tool:bleconnect', 'BLE Connect'],
    ]);
  });

  it('gives the left nav its subset with compact labels, in nav order', () => {
    expect(TOOLS.map((t) => [t.key, t.label])).toEqual([
      ['tool:search', 'Search'],
      ['tool:packetlog', 'Packet Log'],
      ['tool:contacts', 'Contact Management'],
      ['tool:map', 'Map'],
      ['tool:macros', 'Macros'],
      ['tool:settings:app', 'Settings'],
    ]);
  });
});
