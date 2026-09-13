import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { type LivePacket, useStore } from '@/lib/store';
import { PacketLogSection } from '@/panels/settings/PacketLogSection';
import { DEFAULT_UI_STATE, PACKET_LOG_BOUNDS } from '../../src/shared/types';

const packet = (i: number): LivePacket => ({
  id: `pkt-${i}`,
  timestamp: i,
  transportType: 'ble',
  kind: 'mesh',
  hex: '00',
  bytes: [0],
  payloadHex: '00',
  payloadBytes: [0],
});

beforeEach(() => {
  useStore.setState({ ui: structuredClone(DEFAULT_UI_STATE), packets: [] });
});

// NumberInput doesn't forward an aria-label and Row's label isn't
// programmatically associated with the control, so getByLabelText can't
// target it — Live buffer is the first spinbutton rendered, Stored history the second.
const liveInput = () => screen.getAllByRole('spinbutton')[0];
const storedInput = () => screen.getAllByRole('spinbutton')[1];
const saveButton = () => screen.getByText('Save');

describe('PacketLogSection', () => {
  it('does not commit half-typed values while the user is still typing', () => {
    const packets = Array.from({ length: 1000 }, (_, i) => packet(i));
    useStore.setState({ packets });
    render(<PacketLogSection />);

    // The first keystrokes of "5000" / "50000". Committing either would trim the
    // in-memory list to the 200 floor and hand main a 5-row prune target.
    fireEvent.change(liveInput(), { target: { value: '5' } });
    fireEvent.change(storedInput(), { target: { value: '5' } });

    const s = useStore.getState();
    expect(s.ui.packetLog).toEqual(DEFAULT_UI_STATE.packetLog);
    expect(s.packets).toHaveLength(1000);
    expect((liveInput() as HTMLInputElement).value).toBe('5');
  });

  it('commits both values on Save', () => {
    render(<PacketLogSection />);
    fireEvent.change(liveInput(), { target: { value: '500' } });
    fireEvent.change(storedInput(), { target: { value: '5000' } });
    fireEvent.click(saveButton());

    expect(useStore.getState().ui.packetLog).toEqual({ liveBufferSize: 500, storedHistorySize: 5000 });
  });

  it('clamps out-of-bounds values on Save', async () => {
    render(<PacketLogSection />);
    fireEvent.change(liveInput(), { target: { value: '5' } });
    fireEvent.change(storedInput(), { target: { value: String(PACKET_LOG_BOUNDS.storedHistorySize.max + 1_000_000) } });
    fireEvent.click(saveButton());

    expect(useStore.getState().ui.packetLog).toEqual({
      liveBufferSize: PACKET_LOG_BOUNDS.liveBufferSize.min,
      storedHistorySize: PACKET_LOG_BOUNDS.storedHistorySize.max,
    });
    // The inputs show what was applied, and the section is clean — not stuck
    // "Unsaved" against a clamped value the draft never held.
    expect((liveInput() as HTMLInputElement).value).toBe(String(PACKET_LOG_BOUNDS.liveBufferSize.min));
    expect((storedInput() as HTMLInputElement).value).toBe(String(PACKET_LOG_BOUNDS.storedHistorySize.max));
    expect(screen.queryByText('Unsaved')).toBeNull();
    // save() clears its `saving` flag a microtask after onSave resolves.
    expect(((await screen.findByText('Save')) as HTMLButtonElement).disabled).toBe(true);
  });
});
