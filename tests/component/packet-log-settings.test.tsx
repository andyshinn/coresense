import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/lib/store';
import { PacketLogSection } from '@/panels/settings/PacketLogSection';
import { DEFAULT_UI_STATE } from '../../src/shared/types';

beforeEach(() => {
  useStore.setState({ ui: structuredClone(DEFAULT_UI_STATE), packets: [] });
});

describe('PacketLogSection', () => {
  it('live-updates liveBufferSize in the store', () => {
    render(<PacketLogSection />);
    // NumberInput doesn't forward an aria-label and Row's label isn't
    // programmatically associated with the control, so getByLabelText can't
    // target it — the Live buffer input is the first spinbutton rendered.
    const input = screen.getAllByRole('spinbutton')[0];
    fireEvent.change(input, { target: { value: '500' } });
    expect(useStore.getState().ui.packetLog.liveBufferSize).toBe(500);
  });
});
