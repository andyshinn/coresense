import { describe, expect, test } from 'vitest';
import { TOOL_ITEMS } from '@/features/command-palette/items/tools';

describe('command palette Unreads entry', () => {
  test('TOOL_ITEMS includes a tool:unreads item so the pane stays reachable when the sidebar link is hidden', () => {
    const unreads = TOOL_ITEMS.find((t) => t.key === 'tool:unreads');
    expect(unreads).toBeDefined();
    expect(unreads?.label).toBe('Unreads');
  });
});
