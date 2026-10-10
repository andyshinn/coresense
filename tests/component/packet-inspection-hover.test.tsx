import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PacketDecoderDialog } from '@/components/packet/PacketDecoderDialog';
import { PacketDetailsRail } from '@/components/packet/PacketDetailsRail';
import type { LivePacket } from '@/lib/store';
import { useStore } from '@/lib/store';
import { ADVERT_HEX } from '../support/packetFixtures';

// Field keys (pk0, pl0, …) repeat across packets, so a hover left over from one
// breakdown would spotlight the wrong field in the next. Each breakdown view
// owns its hover state and is keyed per packet/decode, which must clear it.

const fieldCards = () => screen.getAllByLabelText(/ field, Bytes? \d/);
const dimmedCount = () => fieldCards().filter((el) => el.style.opacity === '0.55').length;

const pkt = (id: string, payloadHex: string): LivePacket => ({
  id,
  timestamp: Date.parse('2026-07-10T20:26:00Z'),
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [],
  payloadHex,
  payloadBytes: [],
  snr: 5,
  rssi: -84,
});

beforeEach(() => {
  useStore.setState({ channels: [], contacts: [], owner: null });
});

describe('breakdown hover reset', () => {
  it('a fresh decode in the dialog starts with no field spotlighted', () => {
    useStore.getState().setDecoderOpen(true);
    render(<PacketDecoderDialog />);
    fireEvent.change(screen.getByPlaceholderText(/paste/i), { target: { value: '1501782abbcc00112233' } });
    const decode = screen.getByRole('button', { name: /^decode$/i });
    fireEvent.click(decode);

    fireEvent.mouseEnter(fieldCards()[0]);
    expect(dimmedCount()).toBeGreaterThan(0);

    fireEvent.click(decode);
    expect(dimmedCount()).toBe(0);
  });

  it('selecting another packet in the rail starts with no field spotlighted', () => {
    const a = pkt('pkt-a', '1501782abbcc00112233');
    const b = pkt('pkt-b', ADVERT_HEX);
    useStore.setState({ packets: [a, b], selectedPacketId: 'pkt-a' });
    render(<PacketDetailsRail client={null} />);

    fireEvent.mouseEnter(fieldCards()[0]);
    expect(dimmedCount()).toBeGreaterThan(0);

    act(() => useStore.setState({ selectedPacketId: 'pkt-b' }));
    expect(dimmedCount()).toBe(0);
  });
});
