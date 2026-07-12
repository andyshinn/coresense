import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PacketDetailsRail } from '@/components/packet/PacketDetailsRail';
import type { LivePacket } from '@/lib/store';
import { useStore } from '@/lib/store';

const gt: LivePacket = {
  id: 'pkt-0',
  timestamp: Date.parse('2026-07-10T20:26:00Z'),
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [],
  payloadHex: '1501782abbcc00112233',
  payloadBytes: [],
  snr: 5,
  rssi: -84,
};

beforeEach(() => {
  useStore.setState({ packets: [gt], selectedPacketId: null, channels: [] });
});

describe('PacketDetailsRail', () => {
  it('shows the empty state with a Decode button when nothing is selected', () => {
    render(<PacketDetailsRail client={null} />);
    expect(screen.getByText(/Decode hex/i)).toBeTruthy();
  });

  it('renders the byte breakdown for a selected packet', () => {
    useStore.setState({ selectedPacketId: 'pkt-0' });
    render(<PacketDetailsRail client={null} />);
    expect(screen.getByText(/Packet Byte Breakdown/i)).toBeTruthy();
    expect(screen.getByText(/Group Text Payload Byte Breakdown/i)).toBeTruthy();
  });
});
