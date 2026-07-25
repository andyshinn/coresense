import { describe, expect, test } from 'vitest';
import { TOOL_ITEMS } from '@/features/command-palette/items/tools';

describe('command palette Macros entry', () => {
  test('TOOL_ITEMS includes a tool:macros item so the Macros tool is reachable from the palette', () => {
    const macros = TOOL_ITEMS.find((t) => t.key === 'tool:macros');
    expect(macros).toBeDefined();
    expect(macros?.label).toBe('Macros');
  });
});
