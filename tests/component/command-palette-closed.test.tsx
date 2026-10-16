import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/features/command-palette/items/goto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/features/command-palette/items/goto')>();
  return { buildGotoItems: vi.fn(actual.buildGotoItems) };
});

import { CommandPalette } from '../../src/renderer/features/command-palette';
import { buildGotoItems } from '../../src/renderer/features/command-palette/items/goto';
import { type LivePacket, useStore } from '../../src/renderer/lib/store';

const packet = (i: number) => ({ id: `p${i}`, ts: i, hex: '00', direction: 'rx' }) as unknown as LivePacket;

describe('CommandPalette while closed', () => {
  beforeEach(() => {
    vi.mocked(buildGotoItems).mockClear();
    useStore.setState({ paletteOpen: false, packets: [] });
  });

  it('builds no items and ignores incoming packets until it opens', () => {
    render(<CommandPalette cycleThemePref={() => {}} />);
    act(() => {
      useStore.setState({ packets: [packet(1)] });
      useStore.setState({ packets: [packet(1), packet(2)] });
    });
    expect(buildGotoItems).not.toHaveBeenCalled();

    act(() => useStore.getState().openPalette());
    expect(buildGotoItems).toHaveBeenCalled();
    expect(screen.getByText('2 packets')).toBeTruthy();
    expect(screen.getByText('Actions')).toBeTruthy();
  });
});
