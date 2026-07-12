import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/lib/store';
import { PacketLogSection } from '@/panels/settings/PacketLogSection';
import { DEFAULT_UI_STATE, PACKET_LOG_BOUNDS } from '../../src/shared/types';

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

  it('live-updates storedHistorySize in the store', () => {
    render(<PacketLogSection />);
    // Stored history is the second spinbutton rendered.
    const input = screen.getAllByRole('spinbutton')[1];
    fireEvent.change(input, { target: { value: '5000' } });
    expect(useStore.getState().ui.packetLog.storedHistorySize).toBe(5000);
  });

  it('clamps a storedHistorySize above the max bound', () => {
    render(<PacketLogSection />);
    const input = screen.getAllByRole('spinbutton')[1];
    fireEvent.change(input, { target: { value: String(PACKET_LOG_BOUNDS.storedHistorySize.max + 1_000_000) } });
    expect(useStore.getState().ui.packetLog.storedHistorySize).toBe(PACKET_LOG_BOUNDS.storedHistorySize.max);
  });
});
