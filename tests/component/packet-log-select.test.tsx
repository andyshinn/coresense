import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PacketLog } from '@/components/PacketLog';
import type { LivePacket } from '@/lib/store';
import { useStore } from '@/lib/store';

const pkt = (id: string, over: Partial<LivePacket> = {}): LivePacket => ({
  id,
  timestamp: Date.parse('2026-07-10T20:26:00Z'),
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [],
  payloadHex: '0a00cbe31122aabbccdd',
  payloadBytes: [],
  snr: 5,
  rssi: -70,
  ...over,
});

beforeEach(() => {
  useStore.setState({ selectedPacketId: null });
  useStore.getState().setPacketLogFilter({ source: 'both' });
});

describe('PacketLog list', () => {
  it('renders a row per packet and selects on click', () => {
    render(<PacketLog packets={[pkt('pkt-0'), pkt('pkt-1', { kind: 'companion', codeName: 'PUSH_ADVERT' })]} />);
    const rows = screen.getAllByTestId('packet-row');
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]);
    expect(useStore.getState().selectedPacketId).toBe('pkt-0');
  });

  it('filters to RF only when source=rf', () => {
    useStore.getState().setPacketLogFilter({ source: 'rf' });
    render(<PacketLog packets={[pkt('pkt-0'), pkt('pkt-1', { kind: 'companion', codeName: 'PUSH_ADVERT' })]} />);
    expect(screen.getAllByTestId('packet-row')).toHaveLength(1);
  });

  it('shows a humanized type name for a GroupText mesh packet', () => {
    render(<PacketLog packets={[pkt('pkt-0', { payloadHex: '1501782abbcc00112233' })]} />);
    expect(screen.getByText('Group Text')).toBeTruthy();
  });

  it('does not show a mesh-decode error in DETAILS for a companion row', () => {
    render(<PacketLog packets={[pkt('pkt-1', { kind: 'companion', codeName: 'PUSH_ADVERT', payloadHex: 'deadbeef' })]} />);
    expect(screen.queryByText(/too short|invalid|error/i)).toBeNull();
  });
});
